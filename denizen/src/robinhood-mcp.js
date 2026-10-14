'use strict';
/**
 * Robinhood MCP Client — market data + optional live equity orders.
 *
 * Endpoint:   https://agent.robinhood.com/mcp/trading
 * Protocol:   MCP Streamable HTTP (POST JSON-RPC + GET SSE, Mcp-Session-Id)
 * Auth:       OAuth 2.0 Authorization Code + PKCE (public client, no secret)
 *             Dynamic client registration — no developer portal needed.
 *
 * ── First-time setup (one-time, 30 seconds) ────────────────────────────────
 *   1. Visit http://localhost:8080/api/market/auth/connect  in your browser
 *   2. Log in to Robinhood and tap "Allow"
 *   3. You're redirected back — Roki / Grok market tools activate
 *
 * ── Auth internals ─────────────────────────────────────────────────────────
 *   Registration: POST https://agent.robinhood.com/oauth/trading/register
 *     → returns client_id (no client_secret — public client)
 *   Authorization: https://robinhood.com/oauth  (PKCE S256)
 *   Token exchange: POST https://api.robinhood.com/oauth2/token/
 *
 * ── DESIGN RULE ────────────────────────────────────────────────────────────
 *   Default: read-only. createSuggestion() records ideas; paper fills stay
 *   on Roki's fake ledger. Live place_equity_order is OFF unless
 *   ROBINHOOD_LIVE_TRADING=1 (or true/yes/on) and Denizen MCP exposes the
 *   place tool to market NPCs (Roki / Grok).
 */

const https  = require('node:https');
const http   = require('node:http');
const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');
const marketData = require('./market-data'); // free no-key quote feed (Yahoo/Stooq)
const denizenDb = require('./denizen-db');

const ROOT              = path.resolve(__dirname, '..');
const OAUTH_FILE        = path.join(ROOT, 'data', 'robinhood-oauth.json');
const WATCHLIST_FILE    = path.join(ROOT, 'data', 'roki-watchlist.json');
const SUGGESTIONS_FILE  = path.join(ROOT, 'data', 'trade-suggestions.json');

// OAuth constants (from endpoint discovery)
const MCP_HOST          = 'agent.robinhood.com';
const MCP_PATH          = '/mcp/trading';
const AUTH_ENDPOINT     = 'https://robinhood.com/oauth';
const TOKEN_ENDPOINT    = 'https://api.robinhood.com/oauth2/token/';
const REGISTER_ENDPOINT = 'https://agent.robinhood.com/oauth/trading/register';
const SCOPE             = 'internal';
const DEFAULT_DENIZEN_BASE_URL = `http://localhost:${process.env.PORT || 8080}`;

function getRedirectUri() {
  if (process.env.ROBINHOOD_REDIRECT_URI) {
    return process.env.ROBINHOOD_REDIRECT_URI.replace(/\/$/, '');
  }
  const base = process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL;
  if (base) return `${String(base).replace(/\/$/, '')}/api/market/auth/callback`;
  return `http://localhost:${process.env.PORT || 8080}/api/market/auth/callback`;
}
const MCP_TIMEOUT_MS    = 15000;

// Default watchlist for Roki
const DEFAULT_WATCHLIST = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN'];

let _idCounter      = 1;
let _sessionId      = null;          // Mcp-Session-Id from server
let _initialized    = false;
let _pendingVerifier = null;         // PKCE verifier held during auth flow

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadOAuth() {
  try { return JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf-8')); } catch (_) { return {}; }
}
function saveOAuth(data) {
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE, JSON.stringify({ ...loadOAuth(), ...data, updatedAt: new Date().toISOString() }, null, 2));
}

function getToken()    { return process.env.ROBINHOOD_API_TOKEN || loadOAuth().access_token  || null; }
function getRefresh()  { return loadOAuth().refresh_token  || null; }
function getClientId() { return loadOAuth().client_id      || null; }

function isAuthenticated() { return !!getToken(); }

/** Opt-in live order placement via Robinhood MCP place_equity_order. */
function isLiveTradingEnabled() {
  const v = String(process.env.ROBINHOOD_LIVE_TRADING || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getAuthConnectUrl(baseUrl = DEFAULT_DENIZEN_BASE_URL) {
  const normalizedBase = String(baseUrl || DEFAULT_DENIZEN_BASE_URL).replace(/\/$/, '');
  return `${normalizedBase}/api/market/auth/connect`;
}

// ─── Dynamic client registration ─────────────────────────────────────────────

/**
 * Register Denizen as a Robinhood OAuth client (once).
 * Robinhood uses open dynamic registration — no developer account needed.
 * Returns the client_id.
 */
function registerClient() {
  const redirectUri = getRedirectUri();
  const saved = loadOAuth();
  if (saved.client_id && saved.registered_redirect_uri === redirectUri) {
    return Promise.resolve(saved.client_id);
  }

  return httpsPost('agent.robinhood.com', '/oauth/trading/register', {
    client_name: 'Denizen',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: SCOPE,
    token_endpoint_auth_method: 'none',
  }).then(data => {
    const clientId = data.client_id;
    saveOAuth({
      client_id: clientId,
      registered_redirect_uri: redirectUri,
      pending_state: null,
      access_token: null,
      refresh_token: null,
    });
    return clientId;
  });
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generatePKCE() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── OAuth flow ───────────────────────────────────────────────────────────────

/**
 * Build the authorization URL. Call this to start the login flow.
 * Stores the PKCE verifier in memory for the callback.
 * @returns {Promise<string>} URL to redirect the user to
 */
async function buildAuthUrl() {
  const clientId = await registerClient();
  const { verifier, challenge } = generatePKCE();
  _pendingVerifier = verifier;

  const state = crypto.randomBytes(8).toString('hex');
  saveOAuth({ pending_state: state, pkce_verifier: verifier });

  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          getRedirectUri(),
    response_type:         'code',
    scope:                 SCOPE,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens. Called from the OAuth callback.
 * @param {string} code   — the authorization code from the redirect
 * @param {string} state  — state param (checked against pending_state)
 */
async function handleCallback(code, state) {
  const saved = loadOAuth();
  if (state && saved.pending_state && state !== saved.pending_state) {
    throw new Error('OAuth state mismatch — possible CSRF');
  }

  const verifier = _pendingVerifier || saved.pkce_verifier;
  if (!verifier) throw new Error('No PKCE verifier found — restart the auth flow');

  const clientId = getClientId();
  if (!clientId) throw new Error('No client_id — registration may have failed');

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     clientId,
    redirect_uri:  getRedirectUri(),
    code_verifier: verifier,
  }).toString();

  const data = await httpsPostForm('api.robinhood.com', '/oauth2/token/', body);

  saveOAuth({
    access_token:  data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in:    data.expires_in    || null,
    token_type:    data.token_type    || 'Bearer',
    authorized_at: new Date().toISOString(),
    pending_state: null,
    pkce_verifier: null,
  });

  _pendingVerifier = null;
  _initialized     = false; // force re-initialize with new token
  return data;
}

/**
 * Refresh the access token using the stored refresh_token.
 */
async function refreshToken() {
  const refreshTok = getRefresh();
  if (!refreshTok) throw new Error('No refresh token stored — user must re-authenticate');

  const clientId = getClientId();
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshTok,
    client_id:     clientId,
  }).toString();

  const data = await httpsPostForm('api.robinhood.com', '/oauth2/token/', body);
  saveOAuth({
    access_token:  data.access_token,
    refresh_token: data.refresh_token || refreshTok,
    expires_in:    data.expires_in,
    refreshed_at:  new Date().toISOString(),
  });
  return data.access_token;
}

// ─── Low-level HTTP helpers ───────────────────────────────────────────────────

function httpsPost(hostname, pathname, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path: pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          resolve(json);
        } catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(MCP_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function httpsPostForm(hostname, pathname, formBody) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path: pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody),
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          resolve(json);
        } catch (e) { reject(new Error(`Token parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(MCP_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.write(formBody);
    req.end();
  });
}

// ─── MCP JSON-RPC transport ───────────────────────────────────────────────────

/**
 * Send a JSON-RPC request to the MCP endpoint.
 * Handles 401 → token refresh → retry (once).
 */
async function mcpRequest(method, params = {}, retrying = false) {
  const token = getToken();
  if (!token) {
    throw new Error('Robinhood: not authenticated. Visit http://localhost:8080/api/market/auth/connect to log in.');
  }

  const body = JSON.stringify({ jsonrpc: '2.0', id: _idCounter++, method, params });

  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(body),
      'Accept': 'application/json, text/event-stream',
      'User-Agent': 'Denizen/1.0 (Robinhood MCP)',
    };
    if (_sessionId) headers['Mcp-Session-Id'] = _sessionId;

    const req = https.request({
      hostname: MCP_HOST, port: 443, path: MCP_PATH, method: 'POST', headers,
    }, (res) => {
      // Capture session ID if server sends one
      if (res.headers['mcp-session-id']) _sessionId = res.headers['mcp-session-id'];

      if (res.statusCode === 401 && !retrying) {
        // Try refresh then retry once
        res.resume();
        refreshToken()
          .then(() => mcpRequest(method, params, true))
          .then(resolve)
          .catch(reject);
        return;
      }

      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          // Handle SSE response (text/event-stream) — extract first JSON data line
          if (res.headers['content-type']?.includes('text/event-stream')) {
            const dataLine = data.split('\n').find(l => l.startsWith('data:'));
            if (dataLine) {
              const json = JSON.parse(dataLine.slice(5).trim());
              if (json.error) return reject(new Error(`MCP error [${json.error.code}]: ${json.error.message}`));
              return resolve(json.result);
            }
          }
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(`MCP error [${json.error.code}]: ${json.error.message}`));
          resolve(json.result);
        } catch (e) {
          reject(new Error(`MCP parse error: ${e.message} (${data.slice(0, 200)})`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(MCP_TIMEOUT_MS, () => req.destroy(new Error('Robinhood MCP timeout')));
    req.write(body);
    req.end();
  });
}

function callTool(toolName, toolArgs = {}) {
  return mcpRequest('tools/call', { name: toolName, arguments: toolArgs });
}

function unwrapToolResult(result) {
  if (!result) return null;
  if (result.data) return result;
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

async function getDefaultAccountNumber() {
  const payload = unwrapToolResult(await callTool('get_accounts', {}));
  const accounts = payload?.data?.accounts || [];
  const pick = accounts.find((a) => a.is_default && a.agentic_allowed !== false)
    || accounts.find((a) => a.agentic_allowed !== false)
    || accounts[0];
  if (!pick?.account_number) throw new Error('No Robinhood brokerage account found');
  return pick.account_number;
}

function normalizeEquityQuote(entry) {
  const quote = entry?.quote || entry || {};
  const close = entry?.close || {};
  const price = Number(quote.last_non_reg_trade_price || quote.last_trade_price || close.price || 0);
  const prev = Number(quote.adjusted_previous_close || quote.previous_close || close.price || 0);
  const change = prev ? price - prev : null;
  return {
    symbol: quote.symbol || close.symbol,
    price,
    previousClose: prev,
    change: change == null ? null : Number(change.toFixed(4)),
    changePercent: change == null || !prev ? null : Number(((change / prev) * 100).toFixed(2)),
    bid: Number(quote.bid_price || 0) || null,
    ask: Number(quote.ask_price || 0) || null,
    marketTime: quote.venue_last_non_reg_trade_time || quote.venue_last_trade_time || null,
    source: 'robinhood',
  };
}

// ─── MCP session init ─────────────────────────────────────────────────────────

async function initialize() {
  if (_initialized) return true;
  try {
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:   { roots: {}, sampling: {} },
      clientInfo:     { name: 'Denizen', version: '1.0.0' },
    });
    _initialized = true;
  } catch (_) {
    // Some endpoints don't require initialize — proceed anyway
    _initialized = true;
  }
  return true;
}

async function listTools() {
  await initialize();
  return mcpRequest('tools/list', {});
}

// ─── Market data API ──────────────────────────────────────────────────────────

/**
 * Get quotes. Quotes are public data, so we always have a working source:
 *   - If Robinhood is authenticated, try its MCP first (richest, account-aware).
 *   - Otherwise (or on failure) fall back to the free Yahoo/Stooq feed.
 * This means Roki works TODAY even while Robinhood agentic access is waitlisted.
 *
 * @returns {object[]} normalized quotes, each with a `source` field.
 */
async function getQuote(symbols) {
  const syms = Array.isArray(symbols) ? symbols : [symbols];
  if (isAuthenticated()) {
    try {
      await initialize();
      const rh = unwrapToolResult(await callTool('get_equity_quotes', { symbols: syms }));
      const items = rh?.data?.results || [];
      if (items.length) return items.map(normalizeEquityQuote);
    } catch (_) {
      // fall through to free feed
    }
  }
  return marketData.getQuotes(syms);
}

/** Map UI range tabs → Robinhood historicals window. */
const CHART_RANGE_SPEC = {
  '1D':  { lookbackMs: 5 * 864e5, interval: '5minute', bounds: 'extended', sessionOnly: true },
  '1W':  { lookbackMs: 7 * 864e5, interval: '10minute', bounds: 'extended' },
  '1M':  { lookbackMs: 35 * 864e5, interval: 'day', bounds: 'regular' },
  '3M':  { lookbackMs: 100 * 864e5, interval: 'day', bounds: 'regular' },
  'YTD': { ytd: true, interval: 'day', bounds: 'regular' },
  '1Y':  { lookbackMs: 370 * 864e5, interval: 'day', bounds: 'regular' },
  '5Y':  { lookbackMs: 5 * 365 * 864e5, interval: 'week', bounds: 'regular' },
  'ALL': { lookbackMs: 20 * 365 * 864e5, interval: 'month', bounds: 'regular' },
};

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function normalizeRhBars(bars) {
  const out = [];
  for (const b of bars || []) {
    if (b?.interpolated === true) continue;
    const close = Number(b.close_price ?? b.close);
    if (!Number.isFinite(close)) continue;
    const t = Date.parse(b.begins_at || b.starts_at || b.timestamp || '');
    if (!Number.isFinite(t)) continue;
    out.push({
      t,
      c: round4(close),
      o: Number.isFinite(Number(b.open_price ?? b.open)) ? round4(b.open_price ?? b.open) : null,
      h: Number.isFinite(Number(b.high_price ?? b.high)) ? round4(b.high_price ?? b.high) : null,
      l: Number.isFinite(Number(b.low_price ?? b.low)) ? round4(b.low_price ?? b.low) : null,
      v: Number.isFinite(Number(b.volume)) ? Number(b.volume) : null,
      session: b.session || null,
    });
  }
  return out;
}

function filterLastSession(points) {
  if (!points.length) return points;
  // Prefer regular-session bars for 1D look; fall back to all if needed.
  const reg = points.filter((p) => !p.session || p.session === 'reg');
  const pool = reg.length >= 2 ? reg : points;
  const lastDay = new Date(pool[pool.length - 1].t).toISOString().slice(0, 10);
  return pool.filter((p) => new Date(p.t).toISOString().slice(0, 10) === lastDay);
}

/**
 * Live Robinhood OHLCV chart (falls back to Yahoo if unauthenticated / empty).
 * @param {string} symbol
 * @param {string} [rangeKey]
 */
async function getChart(symbol, rangeKey = '1D') {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) throw new Error('symbol required');
  const key = String(rangeKey || '1D').toUpperCase();
  const spec = CHART_RANGE_SPEC[key] || CHART_RANGE_SPEC['1D'];

  if (isAuthenticated()) {
    try {
      await initialize();
      const end = new Date();
      let start;
      if (spec.ytd) {
        start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1, 0, 0, 0));
      } else {
        start = new Date(end.getTime() - (spec.lookbackMs || 5 * 864e5));
      }
      const args = {
        symbols: [sym],
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        interval: spec.interval,
        bounds: spec.bounds || 'regular',
        adjustment_type: 'split',
      };
      const raw = unwrapToolResult(await callTool('get_equity_historicals', args));
      let points = normalizeRhBars(raw?.data?.results?.[0]?.bars || raw?.results?.[0]?.bars);
      if (spec.sessionOnly) points = filterLastSession(points);

      let quote = null;
      try {
        const quotes = await getQuote([sym]);
        quote = Array.isArray(quotes) ? quotes.find((q) => q.symbol === sym) : null;
      } catch (_) {}

      if (points.length >= 2 || quote?.price != null) {
        const first = points[0];
        const last = points[points.length - 1];
        const price = quote?.price ?? last?.c ?? null;
        // 1D change vs previous close when available; else open→last of series
        let change = null;
        let changePercent = null;
        if (key === '1D' && quote?.previousClose != null && price != null) {
          change = round4(price - quote.previousClose);
          changePercent = quote.previousClose
            ? round4((change / quote.previousClose) * 100)
            : null;
        } else if (first && last) {
          const basis = first.o != null ? first.o : first.c;
          change = round4(last.c - basis);
          changePercent = basis ? round4((change / basis) * 100) : null;
        } else if (quote?.change != null) {
          change = quote.change;
          changePercent = quote.changePercent;
        }
        return {
          symbol: sym,
          name: sym,
          currency: 'USD',
          range: key,
          interval: raw?.data?.results?.[0]?.interval || spec.interval,
          price,
          previousClose: quote?.previousClose ?? null,
          change,
          changePercent,
          points,
          source: 'robinhood',
          bid: quote?.bid ?? null,
          ask: quote?.ask ?? null,
          marketTime: quote?.marketTime || null,
        };
      }
    } catch (_) {
      // fall through to Yahoo
    }
  }

  const fallback = await marketData.getChart(sym, key);
  return { ...fallback, source: fallback.source || 'yahoo' };
}

async function getPortfolio() {
  await initialize();
  const accountNumber = await getDefaultAccountNumber();
  return unwrapToolResult(await callTool('get_portfolio', { account_number: accountNumber }));
}

async function getPositions() {
  await initialize();
  const accountNumber = await getDefaultAccountNumber();
  return unwrapToolResult(await callTool('get_equity_positions', { account_number: accountNumber }));
}

async function getOrderHistory(limit = 20) {
  await initialize();
  const accountNumber = await getDefaultAccountNumber();
  return unwrapToolResult(await callTool('get_equity_orders', { account_number: accountNumber, limit }));
}

/**
 * Normalize Denizen / MCP args into Robinhood place_equity_order / review_equity_order payload.
 * Accepts quantity or notional (amount / notional_usd).
 */
async function buildEquityOrderArgs(params = {}) {
  const symbol = String(params.symbol || '').trim().toUpperCase();
  const side = String(params.side || params.action || '').trim().toLowerCase();
  if (!symbol) throw new Error('symbol required');
  if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy|sell');

  const orderType = String(params.order_type || params.orderType || 'market').trim().toLowerCase() || 'market';
  const args = { symbol, side, order_type: orderType };

  const qty = Number(params.quantity ?? params.qty);
  if (Number.isFinite(qty) && qty > 0) args.quantity = qty;

  const amount = Number(params.amount ?? params.notional ?? params.notional_usd ?? params.notionalUsd);
  if (Number.isFinite(amount) && amount > 0) args.amount = amount;

  if (args.quantity == null && args.amount == null) {
    throw new Error('quantity or amount (notional USD) required');
  }

  const limitPrice = Number(params.limit_price ?? params.limitPrice);
  if (Number.isFinite(limitPrice) && limitPrice > 0) args.limit_price = limitPrice;

  const tif = String(params.time_in_force || params.timeInForce || '').trim().toLowerCase();
  if (tif) args.time_in_force = tif;

  const accountNumber = params.account_number || params.accountNumber || await getDefaultAccountNumber();
  if (accountNumber) args.account_number = accountNumber;

  return args;
}

/**
 * Simulate an equity order (Robinhood review_equity_order) — no fill.
 */
async function reviewEquityOrder(params = {}) {
  if (!isAuthenticated()) {
    throw new Error('Robinhood: not authenticated. Visit /api/market/auth/connect to log in.');
  }
  await initialize();
  const args = await buildEquityOrderArgs(params);
  return unwrapToolResult(await callTool('review_equity_order', args));
}

/**
 * Place a live equity order via Robinhood MCP place_equity_order.
 * Requires ROBINHOOD_LIVE_TRADING=1. Moves real money in the Agentic account.
 */
async function placeEquityOrder(params = {}) {
  if (!isLiveTradingEnabled()) {
    throw new Error(
      'Live Robinhood trading is disabled. Set ROBINHOOD_LIVE_TRADING=1 to allow place_equity_order.',
    );
  }
  if (!isAuthenticated()) {
    throw new Error('Robinhood: not authenticated. Visit /api/market/auth/connect to log in.');
  }
  await initialize();
  const args = await buildEquityOrderArgs(params);
  return unwrapToolResult(await callTool('place_equity_order', args));
}

/**
 * Full market observation cycle for Roki's think loop.
 * Returns { watchlist, quotes, portfolio, movers, at, error? }
 */
async function runMarketObservation() {
  try {
    await seedDefaultWatchlistInDbIfEmpty({ npcKey: 'roki' });
  } catch (_) {
    /* non-fatal */
  }

  const watchlist = loadWatchlist();
  let quotes = [], portfolio = null, error = null;

  // Quotes always work (free feed fallback inside getQuote).
  try {
    quotes = await getQuote(watchlist);
  } catch (err) { error = err.message; }

  // Portfolio is Robinhood-only — null until agentic access is granted.
  if (isAuthenticated()) {
    try { portfolio = await getPortfolio(); } catch (_) {}
  }

  const items = Array.isArray(quotes) ? quotes : (quotes?.quotes || []);
  const movers = [...items]
    .filter(q => q.changePercent != null)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 3);

  const quoteSource = items[0]?.source || 'none';
  let buyingPower = null;
  const bpRaw = portfolio?.data?.buying_power?.buying_power ?? portfolio?.buying_power?.buying_power;
  if (bpRaw != null && Number.isFinite(Number(bpRaw))) buyingPower = Number(bpRaw);

  return {
    watchlist,
    quotes: items,
    portfolio,
    buyingPower,
    movers,
    quoteSource,                       // 'yahoo' | 'stooq' | 'robinhood' | 'none'
    robinhoodConnected: isAuthenticated(),
    at: new Date().toISOString(),
    error,
  };
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

function loadWatchlist() {
  try {
    const d = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
    return Array.isArray(d.symbols) ? d.symbols : DEFAULT_WATCHLIST;
  } catch (_) { return DEFAULT_WATCHLIST; }
}

function saveWatchlist(symbols) {
  fs.mkdirSync(path.dirname(WATCHLIST_FILE), { recursive: true });
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify({ symbols, updatedAt: new Date().toISOString() }, null, 2));
}

function addToWatchlist(symbol) {
  const list = loadWatchlist();
  const sym = symbol.toUpperCase().trim();
  if (!list.includes(sym)) {
    list.push(sym);
    saveWatchlist(list);
    try {
      denizenDb.syncWatchlistSymbol(sym, { npcKey: 'roki' });
    } catch (_) {
      /* non-fatal */
    }
  }
  return list;
}

function removeFromWatchlist(symbol) {
  const sym = symbol.toUpperCase().trim();
  const list = loadWatchlist().filter(s => s !== sym);
  saveWatchlist(list);
  try {
    denizenDb.syncWatchlistSymbol(sym, { npcKey: 'roki', remove: true });
  } catch (_) {
    /* non-fatal */
  }
  return list;
}

async function seedDefaultWatchlistInDbIfEmpty(opts = {}) {
  if (!denizenDb?.enabled || !denizenDb?.orgId || typeof denizenDb.getWatchlist !== 'function') {
    return { ok: false, seeded: false, reason: 'db_not_ready' };
  }

  const npcKey = opts.npcKey || 'roki';
  const existing = await denizenDb.getWatchlist({ npcKey, limit: 200 }).catch(() => []);
  if (Array.isArray(existing) && existing.length > 0) {
    return { ok: true, seeded: false, existingCount: existing.length };
  }

  const addedAt = new Date().toISOString();
  for (const symbol of DEFAULT_WATCHLIST) {
    denizenDb.syncWatchlistSymbol(symbol, { npcKey, addedAt });
  }
  if (typeof denizenDb._drain === 'function') {
    await denizenDb._drain().catch(() => {});
  }

  return { ok: true, seeded: true, symbols: [...DEFAULT_WATCHLIST] };
}

// ─── Trade suggestions (DISPLAY ONLY — no execution) ─────────────────────────

function loadSuggestions() {
  try { return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf-8')); } catch (_) { return []; }
}

/**
 * Record a trade suggestion from Roki.
 *
 * THIS DOES NOT PLACE AN ORDER. It writes a suggestion the user can choose
 * to act on in the Robinhood app themselves.
 */
function createSuggestion(params) {
  const suggestions = loadSuggestions();
  let rationale = String(params.rationale || '').slice(0, 600);
  const bp = params.buyingPower ?? params.buying_power;
  if (bp != null && !/\$\d/.test(rationale)) {
    const budget = Number(bp);
    if (Number.isFinite(budget) && budget > 0) {
      rationale = `${rationale} (Sized for ~$${budget.toFixed(2)} buying power.)`.trim();
    }
  }
  const entry = {
    id:           `sug_${Date.now()}_${(Math.random() * 0xffff | 0).toString(16)}`,
    at:           new Date().toISOString(),
    npc:          params.npc      || 'Roki',
    symbol:       (params.symbol  || '').toUpperCase(),
    action:       params.action   || 'watch',
    quantity:     params.quantity || null,
    rationale,
    currentPrice: params.currentPrice || null,
    targetPrice:  params.targetPrice  || null,
    status:       'suggested',
    _note:        isLiveTradingEnabled()
      ? 'Suggestion recorded. Live orders require place_equity_order + ROBINHOOD_LIVE_TRADING=1.'
      : 'SUGGESTION ONLY unless ROBINHOOD_LIVE_TRADING=1 and place_equity_order is used.',
  };
  suggestions.unshift(entry);
  if (suggestions.length > 200) suggestions.splice(200);
  fs.mkdirSync(path.dirname(SUGGESTIONS_FILE), { recursive: true });
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
  try {
    const npcKey = String(params.npc_key || params.npc || 'roki')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || 'roki';
    denizenDb.upsertTradeSuggestion({
      symbol: entry.symbol,
      action: entry.action,
      rationale: entry.rationale,
      status: 'pending',
      createdAt: entry.at,
      npc_key: npcKey,
    });
  } catch (_) {
    /* non-fatal */
  }
  return entry;
}

function dismissSuggestion(id) {
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === id);
  if (entry) {
    entry.status = 'dismissed';
    entry.dismissedAt = new Date().toISOString();
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
    try {
      denizenDb.upsertTradeSuggestion({
        symbol: entry.symbol,
        action: entry.action,
        rationale: entry.rationale,
        status: 'dismissed',
        createdAt: entry.at,
        npc_key: 'roki',
      });
    } catch (_) {
      /* non-fatal */
    }
  }
  return entry;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Auth flow
  isAuthenticated,
  isLiveTradingEnabled,
  getAuthConnectUrl,
  buildAuthUrl,
  handleCallback,
  refreshToken,
  getClientId,
  getRedirectUri,
  registerClient,
  // Watchlist
  loadWatchlist, saveWatchlist, addToWatchlist, removeFromWatchlist,
  seedDefaultWatchlistInDbIfEmpty,
  DEFAULT_WATCHLIST,
  // Suggestions (paper / ideas; live needs placeEquityOrder)
  loadSuggestions, createSuggestion, dismissSuggestion,
  // Market data
  initialize, listTools,
  getQuote, getPortfolio, getPositions, getOrderHistory,
  getChart,
  runMarketObservation,
  // Live trading (gated)
  buildEquityOrderArgs,
  reviewEquityOrder,
  placeEquityOrder,
  // Low-level
  callTool,
};
