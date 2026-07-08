'use strict';

/**
 * Market MCP tools for Roki — quotes, portfolio, watchlist, suggestions.
 * Read-only; never places orders (see robinhood-mcp.js).
 */

const MARKET_NPC_KEYS = new Set(['roki']);

const MARKET_TOOL_DEFINITIONS = [
  {
    name: 'get_market_quote',
    description: 'Live stock quote(s) from Robinhood when connected, else free feed.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ticker symbols, e.g. ["NVDA","AAPL"]',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'get_market_portfolio',
    description: 'Agentic Robinhood account value, cash, and buying power (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'market_watch',
    description: 'Full observation: watchlist quotes, movers, portfolio, buying power.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_trade_suggestions',
    description: 'Pending trade ideas Roki recorded (suggestions only — not orders).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'get_watchlist',
    description: 'Symbols Roki is tracking.',
    inputSchema: { type: 'object', properties: {} },
  },
];

let _robinhoodMcp = null;

function configure(deps = {}) {
  if (deps.robinhoodMcp) _robinhoodMcp = deps.robinhoodMcp;
}

function rh() {
  if (!_robinhoodMcp) _robinhoodMcp = require('./robinhood-mcp.js');
  return _robinhoodMcp;
}

function isMarketNpc(npcKey) {
  return MARKET_NPC_KEYS.has(String(npcKey || '').toLowerCase());
}

function toolsForNpc(npcKey) {
  return isMarketNpc(npcKey) ? [...MARKET_TOOL_DEFINITIONS] : [];
}

async function callTool(npcKey, name, args) {
  if (!isMarketNpc(npcKey)) {
    return { ok: false, error: 'market tools only available for Roki' };
  }
  const m = rh();
  switch (name) {
    case 'get_market_quote': {
      const symbols = (args?.symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
      if (!symbols.length) return { ok: false, error: 'symbols required' };
      const quotes = await m.getQuote(symbols);
      return { ok: true, quotes, robinhoodConnected: m.isAuthenticated() };
    }
    case 'get_market_portfolio': {
      if (!m.isAuthenticated()) {
        return { ok: false, error: 'Robinhood not connected', robinhoodConnected: false };
      }
      const portfolio = await m.getPortfolio();
      return { ok: true, portfolio, robinhoodConnected: true };
    }
    case 'market_watch': {
      const data = await m.runMarketObservation();
      return { ok: true, ...data };
    }
    case 'list_trade_suggestions': {
      const limit = Math.max(1, Math.min(50, Number(args?.limit) || 20));
      const all = m.loadSuggestions();
      const pending = all.filter((s) => s.status !== 'dismissed').slice(0, limit);
      return { ok: true, suggestions: pending, total: all.length };
    }
    case 'get_watchlist':
      return { ok: true, symbols: m.loadWatchlist() };
    default:
      return { ok: false, error: `unknown market tool: ${name}` };
  }
}

module.exports = {
  configure,
  isMarketNpc,
  toolsForNpc,
  callTool,
  MARKET_TOOL_DEFINITIONS,
};
