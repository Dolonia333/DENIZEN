'use strict';

/**
 * Market MCP tools.
 * Roki: quotes, portfolio, watchlist, suggestions.
 * Grok: those reads plus place_equity_order on the agentic Robinhood account.
 */

const READ_NPC_KEYS = new Set(['roki', 'grok']);
const TRADE_NPC_KEYS = new Set(['grok']);

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

const PLACE_EQUITY_ORDER = {
  name: 'place_equity_order',
  description: 'Place a live equity order on the connected Robinhood AI trading account. Grok only. Requires symbol, side (buy or sell), and quantity or dollar amount.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker, e.g. NVDA' },
      side: { type: 'string', enum: ['buy', 'sell'] },
      quantity: { type: 'number', description: 'Share count. Use this or amount.' },
      amount: { type: 'number', description: 'Dollar notional. Use this or quantity.' },
      order_type: { type: 'string', description: 'market (default) or limit' },
      limit_price: { type: 'number' },
      time_in_force: { type: 'string' },
    },
    required: ['symbol', 'side'],
  },
};

let _robinhoodMcp = null;

function configure(deps = {}) {
  if (deps.robinhoodMcp) _robinhoodMcp = deps.robinhoodMcp;
}

function rh() {
  if (!_robinhoodMcp) _robinhoodMcp = require('./robinhood-mcp.js');
  return _robinhoodMcp;
}

function isMarketNpc(npcKey) {
  return READ_NPC_KEYS.has(String(npcKey || '').toLowerCase());
}

function toolsForNpc(npcKey) {
  const key = String(npcKey || '').toLowerCase();
  if (!READ_NPC_KEYS.has(key)) return [];
  const tools = [...MARKET_TOOL_DEFINITIONS];
  if (TRADE_NPC_KEYS.has(key)) tools.push(PLACE_EQUITY_ORDER);
  return tools;
}

async function callTool(npcKey, name, args) {
  const key = String(npcKey || '').toLowerCase();
  if (!READ_NPC_KEYS.has(key)) {
    return { ok: false, error: 'market tools only available for Roki and Grok' };
  }
  if (name === 'place_equity_order' && !TRADE_NPC_KEYS.has(key)) {
    return { ok: false, error: 'live Robinhood orders are only available to Grok' };
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
    case 'place_equity_order': {
      if (!m.isAuthenticated()) {
        return { ok: false, error: 'Robinhood not connected', robinhoodConnected: false };
      }
      try {
        const placed = await m.placeEquityOrder({
          symbol: args?.symbol,
          side: args?.side,
          quantity: args?.quantity,
          amount: args?.amount,
          orderType: args?.order_type || args?.orderType,
          limitPrice: args?.limit_price ?? args?.limitPrice,
          timeInForce: args?.time_in_force || args?.timeInForce,
          accountNumber: args?.account_number || args?.accountNumber,
        });
        return { ok: true, ...placed, robinhoodConnected: true };
      } catch (err) {
        return { ok: false, error: err.message, code: err.code || null, robinhoodConnected: true };
      }
    }
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
