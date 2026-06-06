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
 * ── DESIGN RULE ────────────────────────────────────────────────────────────
 *   This module NEVER places orders. placeTrade() does not exist.
 *   createSuggestion() records a human-readable idea to trade-suggestions.json.
 *   The user acts on suggestions in the Robinhood app themselves.
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
const REDIRECT_URI      = 'http://localhost:8080/api/market/auth/callback';
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

// ─── Dynamic client registration ─────────────────────────────────────────────

/**
 * Register Denizen as a Robinhood OAuth client (once).
 * Robinhood uses open dynamic registration — no developer account needed.
 * Returns the client_id.
 */
function registerClient() {
  const existing = getClientId();
  if (existing) return Promise.resolve(existing);

  return httpsPost('agent.robinhood.com', '/oauth/trading/register', {
    client_name: 'Denizen',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: SCOPE,
    token_endpoint_auth_method: 'none',
  }).then(data => {
    const clientId = data.client_id;
    saveOAuth({ client_id: clientId });
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
  saveOAuth({ pending_state: state });

  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          REDIRECT_URI,
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

  const verifier = _pendingVerifier;
  if (!verifier) throw new Error('No PKCE verifier found — restart the auth flow');

  const clientId = getClientId();
  if (!clientId) throw new Error('No client_id — registration may have failed');

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     clientId,
    redirect_uri:  REDIRECT_URI,
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
      const rh = await callTool('get_quote', { symbols: syms });
      const items = Array.isArray(rh) ? rh : (rh?.quotes || null);
      if (items && items.length) return items.map(q => ({ ...q, source: q.source || 'robinhood' }));
    } catch (_) {
      // fall through to free feed
    }
  }
  return marketData.getQuotes(syms);
}

async function getPortfolio() {
  await initialize();
  return callTool('get_portfolio', {});
}

async function getPositions() {
  await initialize();
  return callTool('get_positions', {});
}

async function getOrderHistory(limit = 20) {
  await initialize();
  return callTool('get_orders', { limit });
}

/**
 * Full market observation cycle for Roki's think loop.
 * Returns { watchlist, quotes, portfolio, movers, at, error? }
 */
async function runMarketObservation() {
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

  return {
    watchlist,
    quotes: items,
    portfolio,
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
  const entry = {
    id:           `sug_${Date.now()}_${(Math.random() * 0xffff | 0).toString(16)}`,
    at:           new Date().toISOString(),
    npc:          params.npc      || 'Roki',
    symbol:       (params.symbol  || '').toUpperCase(),
    action:       params.action   || 'watch',
    quantity:     params.quantity || null,
    rationale:    (params.rationale || '').slice(0, 600),
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
  buildAuthUrl,
  handleCallback,
  refreshToken,
  getClientId,
  registerClient,
  // Watchlist
  loadWatchlist, saveWatchlist, addToWatchlist, removeFromWatchlist,
  // Suggestions (no execution)
  loadSuggestions, createSuggestion, dismissSuggestion,
  // Market data
  initialize, listTools,
  getQuote, getPortfolio, getPositions, getOrderHistory,
  runMarketObservation,
  // Low-level
  callTool,
};
