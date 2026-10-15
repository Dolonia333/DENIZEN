'use strict';
/**
 * Robinhood MCP Client — read-only market data for Roki's stock watcher.
 *
 * Endpoint:   https://agent.robinhood.com/mcp/trading
 * Protocol:   MCP Streamable HTTP (POST JSON-RPC + GET SSE, Mcp-Session-Id)
 * Auth:       OAuth 2.0 Authorization Code + PKCE (public client, no secret)
 *             Dynamic client registration — no developer portal needed.
 *
 * ── First-time setup (one-time, 30 seconds) ────────────────────────────────
 *   1. Visit http://localhost:8080/api/market/auth/connect  in your browser
 *   2. Log in to Robinhood and tap "Allow"
 *   3. You're redirected back — Roki activates automatically
 *
 * ── Auth internals ─────────────────────────────────────────────────────────
 *   Registration: POST https://agent.robinhood.com/oauth/trading/register
 *     → returns client_id (no client_secret — public client)
 *   Authorization: https://robinhood.com/oauth  (PKCE S256)
 *   Token exchange: POST https://api.robinhood.com/oauth2/token/
 *
 * ── ORDERS ─────────────────────────────────────────────────────────────────
 *   Quotes, portfolio, and suggestions stay available to Roki.
 *   Live equity orders go only to an account with agentic_allowed === true,
 *   and only when Grok calls placeEquityOrder / the place_equity_order MCP tool.
 *   The tool name and arguments come from this connection's tools/list.
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

  let data;
  try {
    data = await httpsPostForm('api.robinhood.com', '/oauth2/token/', body);
  } catch (err) {
    if (/invalid_grant|HTTP 401/.test(err?.message || '')) {
      throw new Error('Robinhood login expired. Open /api/market/auth/connect and allow the AI trading account again.');
    }
    throw err;
  }
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

function accountsFromPayload(payload) {
  if (Array.isArray(payload?.data?.accounts)) return payload.data.accounts;
  if (Array.isArray(payload?.accounts)) return payload.accounts;
  return [];
}

function selectAgenticAccount(accounts, accountNumber) {
  const agentic = (Array.isArray(accounts) ? accounts : [])
    .filter((a) => a && a.agentic_allowed === true && a.account_number);
  if (!agentic.length) {
    const err = new Error('No agentic Robinhood account on this connection. The AI trading account has to be the one this MCP session is allowed to use.');
    err.code = 'no_agentic_account';
    throw err;
  }
  if (accountNumber) {
    const hit = agentic.find((a) => String(a.account_number) === String(accountNumber));
    if (!hit) {
      const err = new Error('That account is not the agentic trading account.');
      err.code = 'account_not_agentic';
      throw err;
    }
    return hit;
  }
  return agentic.find((a) => a.is_default) || agentic[0];
}

function orderArgsFromSchema(schema, input) {
  const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const keys = Object.keys(props);
  const loose = !keys.length || schema?.additionalProperties !== false;
  const out = {};
  const set = (candidates, value) => {
    if (value == null || value === '') return;
    const key = candidates.find((k) => keys.includes(k));
    if (key) out[key] = value;
    else if (loose) out[candidates[0]] = value;
  };
  set(['symbol', 'ticker'], input.symbol);
  set(['side', 'action'], input.side);
  set(['order_type', 'type'], input.orderType);
  set(['quantity', 'qty', 'shares'], input.quantity);
  set(['amount', 'notional_usd', 'dollar_amount', 'notional'], input.amount);
  set(['limit_price', 'price'], input.limitPrice);
  set(['time_in_force', 'tif'], input.timeInForce);
  set(['account_number', 'account'], input.accountNumber);
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.includes('order_type') && out.order_type == null && out.type == null) {
    if (!keys.length || keys.includes('order_type')) out.order_type = input.orderType || 'market';
  }
  return out;
}

function reviewBlockReason(review) {
  if (!review || typeof review !== 'object') return null;
  if (review.ok === false) return review.error || 'Robinhood review rejected the order';
  const data = review.data && typeof review.data === 'object' ? review.data : review;
  if (data.ok === false) return data.error || data.reason || 'Robinhood review rejected the order';
  if (data.can_place === false || data.allowed === false || data.blocked === true) {
    return data.reason || data.message || 'Robinhood review blocked the order';
  }
  return null;
}

function copyReviewId(schema, review, args) {
  const data = review?.data && typeof review.data === 'object' ? review.data : (review || {});
  const id = data.order_id || data.review_id || data.id || data.ref_id || null;
  if (!id) return args;
  const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const keys = Object.keys(props);
  const slot = ['review_id', 'order_id', 'ref_id'].find((k) => !keys.length || keys.includes(k));
  if (slot && args[slot] == null) args[slot] = id;
  return args;
}

function findPlaceTool(tools) {
  const list = Array.isArray(tools) ? tools : [];
  return list.find((t) => t?.name === 'place_equity_order')
    || list.find((t) => /place/i.test(t?.name || '') && /order/i.test(t.name) && !/cancel|review/i.test(t.name))
    || null;
}

/**
 * Place an equity order on the connected agentic (AI trading) account.
 * Discovers place/review tools from this session's tools/list.
 * @param {object} input symbol, side, quantity|amount, optional orderType, limitPrice, timeInForce, accountNumber
 * @param {object} [hooks] test seams: callTool, tools
 */
async function placeEquityOrder(input = {}, hooks = {}) {
  const invoke = hooks.callTool || callTool;
  if (!hooks.callTool) {
    if (!isAuthenticated()) {
      throw new Error('Robinhood: not authenticated. Visit /api/market/auth/connect to log in.');
    }
    await initialize();
  }

  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = String(input.side || input.action || '').trim().toLowerCase();
  if (!symbol) throw new Error('symbol required');
  if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy or sell');
  const quantity = input.quantity != null && input.quantity !== '' ? Number(input.quantity) : null;
  const amountRaw = input.amount != null && input.amount !== ''
    ? input.amount
    : input.notional_usd;
  const amount = amountRaw != null && amountRaw !== '' ? Number(amountRaw) : null;
  if (!(quantity > 0) && !(amount > 0)) throw new Error('quantity or amount (dollars) required');
  const orderType = String(input.orderType || input.order_type || 'market').toLowerCase();
  const limitPrice = input.limitPrice != null ? Number(input.limitPrice)
    : (input.limit_price != null ? Number(input.limit_price) : null);

  const listed = hooks.tools
    ? { tools: hooks.tools }
    : await (hooks.listTools || listTools)();
  const tools = listed?.tools || [];
  const place = findPlaceTool(tools);
  if (!place) {
    const err = new Error('This Robinhood connection has no equity order tool. Enable the AI trading account on this MCP session.');
    err.code = 'no_order_tool';
    throw err;
  }

  const accountsPayload = unwrapToolResult(await invoke('get_accounts', {}));
  const account = selectAgenticAccount(accountsFromPayload(accountsPayload), input.accountNumber || input.account_number);
  const shaped = {
    symbol,
    side,
    orderType,
    quantity: quantity > 0 ? quantity : null,
    amount: amount > 0 ? amount : null,
    limitPrice: Number.isFinite(limitPrice) ? limitPrice : null,
    timeInForce: input.timeInForce || input.time_in_force || null,
    accountNumber: account.account_number,
  };

  const reviewTool = tools.find((t) => t?.name === 'review_equity_order');
  let review = null;
  if (reviewTool) {
    review = unwrapToolResult(await invoke(
      reviewTool.name,
      orderArgsFromSchema(reviewTool.inputSchema, shaped),
    ));
    const block = reviewBlockReason(review);
    if (block) {
      const err = new Error(block);
      err.code = 'review_blocked';
      err.review = review;
      throw err;
    }
  }

  const placeArgs = orderArgsFromSchema(place.inputSchema, shaped);
  copyReviewId(place.inputSchema, review, placeArgs);
  const order = unwrapToolResult(await invoke(place.name, placeArgs));
  const record = {
    at: new Date().toISOString(),
    symbol,
    side,
    quantity: shaped.quantity,
    amount: shaped.amount,
    orderType,
    accountLast4: String(account.account_number).slice(-4),
    tool: place.name,
  };
  if (!hooks.callTool) {
    try {
      const ledgerPath = path.join(ROOT, 'data', 'grok-live-orders.json');
      const prev = fs.existsSync(ledgerPath)
        ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
        : [];
      const rows = Array.isArray(prev) ? prev : [];
      rows.unshift(record);
      fs.writeFileSync(ledgerPath, JSON.stringify(rows.slice(0, 100), null, 2));
    } catch (_) { /* ledger must not undo a filled order */ }
  }

  return {
    ok: true,
    symbol,
    side,
    accountLast4: record.accountLast4,
    tool: place.name,
    review,
    order,
  };
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
    _note:        'SUGGESTION ONLY. Denizen never executes trades.',
  };
  suggestions.unshift(entry);
  if (suggestions.length > 200) suggestions.splice(200);
  fs.mkdirSync(path.dirname(SUGGESTIONS_FILE), { recursive: true });
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
  try {
    denizenDb.upsertTradeSuggestion({
      symbol: entry.symbol,
      action: entry.action,
      rationale: entry.rationale,
      status: 'pending',
      createdAt: entry.at,
      npc_key: 'roki',
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
  // Suggestions (no execution)
  loadSuggestions, createSuggestion, dismissSuggestion,
  // Market data
  initialize, listTools,
  getQuote, getPortfolio, getPositions, getOrderHistory,
  placeEquityOrder,
  selectAgenticAccount,
  orderArgsFromSchema,
  accountsFromPayload,
  getChart,
  runMarketObservation,
  // Low-level
  callTool,
};
