'use strict';
/**
 * Robinhood MCP Client — read-only market data for Roki's stock watcher.
 *
 * Connects to: https://agent.robinhood.com/mcp/trading
 * Protocol:    MCP over HTTP (JSON-RPC 2.0, POST)
 * Auth:        Bearer token — set ROBINHOOD_API_TOKEN in .env, or POST
 *              a token to /api/market/auth/token from the browser.
 *
 * DESIGN RULE: This module NEVER places orders. The `placeTrade()` method
 * records a human-readable suggestion to data/trade-suggestions.json and
 * returns it — the user must act on it in the Robinhood app themselves.
 *
 * Setup (once):
 *   1. Log in at https://robinhood.com → Account → API → create a key
 *   2. Add ROBINHOOD_API_TOKEN=<key> to denizen/.env
 *   3. Restart the server — Roki will start watching immediately.
 *
 * OR paste the token in-game: tell any NPC "set Roki's market token" and
 * the player chat handler will route to POST /api/market/auth/token.
 */

const https = require('node:https');
const fs    = require('node:fs');
const path  = require('node:path');

const ROOT          = path.resolve(__dirname, '..');
const TOKEN_FILE    = path.join(ROOT, 'data', 'robinhood-oauth.json');
const WATCHLIST_FILE = path.join(ROOT, 'data', 'roki-watchlist.json');
const SUGGESTIONS_FILE = path.join(ROOT, 'data', 'trade-suggestions.json');

const MCP_HOST   = 'agent.robinhood.com';
const MCP_PATH   = '/mcp/trading';
const MCP_TIMEOUT_MS = 15000;

// Default watchlist if none saved
const DEFAULT_WATCHLIST = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN'];

let _idCounter = 1;

// ─── Token management ────────────────────────────────────────────────────────

function loadToken() {
  // Env var takes priority
  if (process.env.ROBINHOOD_API_TOKEN) return process.env.ROBINHOOD_API_TOKEN;
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    return data.access_token || data.token || null;
  } catch (_) {
    return null;
  }
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token, savedAt: new Date().toISOString() }, null, 2));
}

function isAuthenticated() {
  return !!loadToken();
}

// ─── Watchlist persistence ───────────────────────────────────────────────────

function loadWatchlist() {
  try {
    const d = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
    return Array.isArray(d.symbols) ? d.symbols : DEFAULT_WATCHLIST;
  } catch (_) {
    return DEFAULT_WATCHLIST;
  }
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
  }
  return list;
}

function removeFromWatchlist(symbol) {
  const list = loadWatchlist().filter(s => s !== symbol.toUpperCase().trim());
  saveWatchlist(list);
  return list;
}

// ─── Trade suggestions (read-only output — NO order execution) ───────────────

function loadSuggestions() {
  try {
    return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf-8'));
  } catch (_) {
    return [];
  }
}

/**
 * Record a trade suggestion from Roki.
 *
 * THIS DOES NOT PLACE AN ORDER. It writes a human-readable suggestion that
 * the user can choose to act on in the Robinhood app themselves.
 *
 * @param {object} params
 *   { npc, symbol, action, quantity, rationale, currentPrice, targetPrice }
 */
function createSuggestion(params) {
  const suggestions = loadSuggestions();
  const entry = {
    id: `sug_${Date.now()}_${(Math.random() * 0xffff | 0).toString(16)}`,
    at: new Date().toISOString(),
    npc: params.npc || 'Roki',
    symbol: (params.symbol || '').toUpperCase(),
    action: params.action || 'watch', // 'buy' | 'sell' | 'watch'
    quantity: params.quantity || null,
    rationale: (params.rationale || '').slice(0, 600),
    currentPrice: params.currentPrice || null,
    targetPrice: params.targetPrice || null,
    status: 'suggested', // 'suggested' | 'dismissed' — user acts in Robinhood app
    // Explicit reminder for operators reading raw JSON
    _note: 'This is a SUGGESTION only. Denizen never executes trades. Act in the Robinhood app.',
  };
  suggestions.unshift(entry);
  // Keep last 200 suggestions
  if (suggestions.length > 200) suggestions.splice(200);
  fs.mkdirSync(path.dirname(SUGGESTIONS_FILE), { recursive: true });
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
  return entry;
}

function dismissSuggestion(id) {
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === id);
  if (entry) {
    entry.status = 'dismissed';
    entry.dismissedAt = new Date().toISOString();
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
  }
  return entry;
}

// ─── MCP HTTP transport ───────────────────────────────────────────────────────

/**
 * Send a single JSON-RPC request to the Robinhood MCP endpoint.
 * Returns the `result` field, or throws on error.
 */
function mcpRequest(method, params = {}) {
  const token = loadToken();
  if (!token) {
    return Promise.reject(new Error('Robinhood: not authenticated — set ROBINHOOD_API_TOKEN in .env'));
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: _idCounter++,
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: MCP_HOST,
      port: 443,
      path: MCP_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Denizen/1.0 (Robinhood MCP client)',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            return reject(new Error(`MCP error [${json.error.code}]: ${json.error.message}`));
          }
          resolve(json.result);
        } catch (e) {
          reject(new Error(`Robinhood MCP parse error: ${e.message} (raw: ${data.slice(0, 200)})`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(MCP_TIMEOUT_MS, () => {
      req.destroy(new Error('Robinhood MCP timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Call a specific MCP tool by name.
 * Robinhood MCP uses the standard MCP tools/call interface.
 */
function callTool(toolName, toolArgs = {}) {
  return mcpRequest('tools/call', { name: toolName, arguments: toolArgs });
}

// ─── High-level market data API ───────────────────────────────────────────────

/**
 * Initialize an MCP session (required before other calls in some MCP servers).
 * Safe to call multiple times — no-ops after first success.
 */
let _initialized = false;
async function initialize() {
  if (_initialized) return true;
  try {
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: {}, sampling: {} },
      clientInfo: { name: 'Denizen', version: '1.0.0' },
    });
    _initialized = true;
    return true;
  } catch (err) {
    // Some MCP servers don't require initialize — continue anyway
    _initialized = true;
    return false;
  }
}

/**
 * List available tools from the Robinhood MCP.
 */
async function listTools() {
  await initialize();
  return mcpRequest('tools/list', {});
}

/**
 * Get a live quote for one or more symbols.
 * @param {string|string[]} symbols — e.g. 'NVDA' or ['NVDA','TSLA']
 * @returns {object} { symbol, price, change, changePercent, ... }
 */
async function getQuote(symbols) {
  await initialize();
  const syms = Array.isArray(symbols) ? symbols : [symbols];
  return callTool('get_quote', { symbols: syms });
}

/**
 * Get a summary of the authenticated account's portfolio.
 * @returns {object} { totalValue, dayChange, ... }
 */
async function getPortfolio() {
  await initialize();
  return callTool('get_portfolio', {});
}

/**
 * Get all current positions.
 * @returns {object[]} [ { symbol, quantity, averageCost, currentPrice, ... } ]
 */
async function getPositions() {
  await initialize();
  return callTool('get_positions', {});
}

/**
 * Get order history.
 * @param {number} limit — max orders to return
 */
async function getOrderHistory(limit = 20) {
  await initialize();
  return callTool('get_orders', { limit });
}

/**
 * Run a full market observation cycle for Roki.
 *
 * 1. Gets quotes for the watchlist
 * 2. Gets portfolio summary (if auth available)
 * 3. Returns a structured observation Roki's brain can use for commentary
 *
 * @returns {object} { watchlist: [...], portfolio: {...}|null, at: ISO, movers: [...] }
 */
async function runMarketObservation() {
  const watchlist = loadWatchlist();
  let quotes = null;
  let portfolio = null;
  let error = null;

  try {
    await initialize();
    quotes = await getQuote(watchlist);
  } catch (err) {
    error = err.message;
  }

  try {
    portfolio = await getPortfolio();
  } catch (_) {
    // Portfolio optional — might not be connected
  }

  // Sort by biggest % change to surface notable movers
  const items = Array.isArray(quotes) ? quotes : (quotes?.quotes || []);
  const movers = [...items]
    .filter(q => q.changePercent != null)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 3);

  return {
    watchlist,
    quotes: items,
    portfolio,
    movers,
    at: new Date().toISOString(),
    error,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Auth
  isAuthenticated,
  loadToken,
  saveToken,
  // Watchlist
  loadWatchlist,
  saveWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  // Suggestions (display-only, NO order execution)
  loadSuggestions,
  createSuggestion,
  dismissSuggestion,
  // Market data
  initialize,
  listTools,
  getQuote,
  getPortfolio,
  getPositions,
  getOrderHistory,
  runMarketObservation,
  // Low-level
  callTool,
};
