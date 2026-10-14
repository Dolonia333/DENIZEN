'use strict';

/**
 * Market MCP tools for Roki + Grok — quotes, portfolio, watchlist, suggestions,
 * and optional live Robinhood equity orders (ROBINHOOD_LIVE_TRADING=1).
 */

const MARKET_NPC_KEYS = new Set(['roki', 'grok']);

const MARKET_READ_TOOL_DEFINITIONS = [
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
    name: 'get_market_positions',
    description: 'Open equity positions in the connected Robinhood Agentic account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_equity_orders',
    description: 'Recent equity order history from Robinhood.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max orders (default 20)' },
      },
    },
  },
  {
    name: 'market_watch',
    description: 'Full observation: watchlist quotes, movers, portfolio, buying power.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_trade_suggestions',
    description: 'Pending trade ideas recorded by market NPCs (suggestions — not fills).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'get_watchlist',
    description: 'Symbols on the shared Roki/Grok market watchlist.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'review_equity_order',
    description:
      'Simulate a Robinhood equity order and return pre-trade warnings (does not place).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker, e.g. AAPL' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy or sell' },
        quantity: { type: 'number', description: 'Share quantity (fractional OK when supported)' },
        amount: { type: 'number', description: 'Notional USD (alternative to quantity)' },
        order_type: { type: 'string', description: 'market | limit (default market)' },
        limit_price: { type: 'number', description: 'Required for limit orders' },
        time_in_force: { type: 'string', description: 'e.g. gfd, gtc' },
      },
      required: ['symbol', 'side'],
    },
  },
];

const MARKET_TRADE_TOOL_DEFINITIONS = [
  {
    name: 'place_equity_order',
    description:
      'Place a LIVE Robinhood equity order (real money). Requires ROBINHOOD_LIVE_TRADING=1, '
      + 'OAuth, and MCP trade scope. Set confirm=true. Prefer review_equity_order first.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker, e.g. AAPL' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy or sell' },
        quantity: { type: 'number', description: 'Share quantity' },
        amount: { type: 'number', description: 'Notional USD (alternative to quantity)' },
        order_type: { type: 'string', description: 'market | limit (default market)' },
        limit_price: { type: 'number', description: 'Required for limit orders' },
        time_in_force: { type: 'string', description: 'e.g. gfd, gtc' },
        confirm: {
          type: 'boolean',
          description: 'Must be true to acknowledge a live order',
        },
      },
      required: ['symbol', 'side', 'confirm'],
    },
  },
];

const MARKET_TOOL_DEFINITIONS = [...MARKET_READ_TOOL_DEFINITIONS, ...MARKET_TRADE_TOOL_DEFINITIONS];

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
  if (!isMarketNpc(npcKey)) return [];
  return [...MARKET_TOOL_DEFINITIONS];
}

function truthyConfirm(v) {
  return v === true || v === 1 || String(v).toLowerCase() === 'true';
}

async function callTool(npcKey, name, args) {
  if (!isMarketNpc(npcKey)) {
    return { ok: false, error: 'market tools only available for Roki and Grok' };
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
    case 'get_market_positions': {
      if (!m.isAuthenticated()) {
        return { ok: false, error: 'Robinhood not connected', robinhoodConnected: false };
      }
      const positions = await m.getPositions();
      return { ok: true, positions, robinhoodConnected: true };
    }
    case 'get_equity_orders': {
      if (!m.isAuthenticated()) {
        return { ok: false, error: 'Robinhood not connected', robinhoodConnected: false };
      }
      const limit = Math.max(1, Math.min(100, Number(args?.limit) || 20));
      const orders = await m.getOrderHistory(limit);
      return { ok: true, orders, robinhoodConnected: true };
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
    case 'review_equity_order': {
      try {
        const review = await m.reviewEquityOrder(args || {});
        return {
          ok: true,
          review,
          robinhoodConnected: true,
          liveTradingEnabled: !!m.isLiveTradingEnabled?.(),
        };
      } catch (err) {
        return {
          ok: false,
          error: err?.message || String(err),
          robinhoodConnected: m.isAuthenticated(),
          liveTradingEnabled: !!m.isLiveTradingEnabled?.(),
        };
      }
    }
    case 'place_equity_order': {
      if (!m.isLiveTradingEnabled?.()) {
        return {
          ok: false,
          error: 'Live Robinhood trading disabled. Set ROBINHOOD_LIVE_TRADING=1 on the Denizen host.',
          liveTradingEnabled: false,
          robinhoodConnected: m.isAuthenticated(),
        };
      }
      if (!truthyConfirm(args?.confirm)) {
        return {
          ok: false,
          error: 'confirm=true required for live place_equity_order',
          liveTradingEnabled: true,
        };
      }
      try {
        const order = await m.placeEquityOrder(args || {});
        try {
          m.createSuggestion?.({
            npc: String(npcKey || 'grok').replace(/^\w/, (c) => c.toUpperCase()),
            npc_key: npcKey,
            symbol: args?.symbol,
            action: args?.side || args?.action,
            quantity: args?.quantity ?? args?.qty ?? null,
            rationale: `LIVE ORDER via Denizen MCP place_equity_order (${npcKey})`,
            currentPrice: args?.limit_price || null,
          });
        } catch (_) { /* non-fatal audit suggestion */ }
        return {
          ok: true,
          order,
          live: true,
          npc: npcKey,
          robinhoodConnected: true,
          liveTradingEnabled: true,
        };
      } catch (err) {
        return {
          ok: false,
          error: err?.message || String(err),
          liveTradingEnabled: true,
          robinhoodConnected: m.isAuthenticated(),
        };
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
  MARKET_NPC_KEYS,
  MARKET_TOOL_DEFINITIONS,
  MARKET_READ_TOOL_DEFINITIONS,
  MARKET_TRADE_TOOL_DEFINITIONS,
};
