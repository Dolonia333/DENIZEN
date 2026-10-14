#!/usr/bin/env node
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const marketTools = require('../src/denizen-mcp-market-tools.js');

describe('denizen-mcp-market-tools', () => {
  afterEach(() => {
    marketTools.configure({
      robinhoodMcp: {
        isAuthenticated: () => false,
        isLiveTradingEnabled: () => false,
        getQuote: async () => [],
        loadWatchlist: () => [],
        loadSuggestions: () => [],
      },
    });
  });

  it('exposes market tools for roki and grok', () => {
    assert.ok(marketTools.toolsForNpc('roki').length >= 5);
    assert.ok(marketTools.toolsForNpc('grok').length >= 5);
    assert.equal(marketTools.toolsForNpc('rob').length, 0);
    assert.ok(marketTools.toolsForNpc('grok').some((t) => t.name === 'place_equity_order'));
    assert.ok(marketTools.toolsForNpc('grok').some((t) => t.name === 'review_equity_order'));
    assert.equal(marketTools.isMarketNpc('Grok'), true);
  });

  it('get_watchlist returns symbols', async () => {
    marketTools.configure({
      robinhoodMcp: {
        isAuthenticated: () => false,
        isLiveTradingEnabled: () => false,
        loadWatchlist: () => ['NVDA', 'AAPL'],
      },
    });
    const res = await marketTools.callTool('roki', 'get_watchlist', {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.symbols, ['NVDA', 'AAPL']);
  });

  it('blocks place_equity_order when live trading env is off', async () => {
    let placed = 0;
    marketTools.configure({
      robinhoodMcp: {
        isAuthenticated: () => true,
        isLiveTradingEnabled: () => false,
        placeEquityOrder: async () => { placed += 1; return { ok: true }; },
        createSuggestion: () => ({}),
      },
    });
    const res = await marketTools.callTool('grok', 'place_equity_order', {
      symbol: 'AAPL',
      side: 'buy',
      amount: 25,
      confirm: true,
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /ROBINHOOD_LIVE_TRADING/);
    assert.equal(placed, 0);
  });

  it('requires confirm=true before placing', async () => {
    let placed = 0;
    marketTools.configure({
      robinhoodMcp: {
        isAuthenticated: () => true,
        isLiveTradingEnabled: () => true,
        placeEquityOrder: async () => { placed += 1; return { order_id: 'x' }; },
        createSuggestion: () => ({}),
      },
    });
    const denied = await marketTools.callTool('grok', 'place_equity_order', {
      symbol: 'AAPL',
      side: 'buy',
      amount: 25,
    });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /confirm=true/);
    assert.equal(placed, 0);
  });

  it('places live order for grok when enabled and confirmed', async () => {
    const calls = [];
    marketTools.configure({
      robinhoodMcp: {
        isAuthenticated: () => true,
        isLiveTradingEnabled: () => true,
        placeEquityOrder: async (args) => {
          calls.push(args);
          return { data: { id: 'ord_1' } };
        },
        createSuggestion: () => ({ id: 'sug_1' }),
      },
    });
    const res = await marketTools.callTool('grok', 'place_equity_order', {
      symbol: 'aapl',
      side: 'buy',
      amount: 25,
      confirm: true,
    });
    assert.equal(res.ok, true);
    assert.equal(res.live, true);
    assert.equal(res.npc, 'grok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].symbol, 'aapl');
  });

  it('rejects market tools for non-market NPCs', async () => {
    const res = await marketTools.callTool('lucy', 'get_market_quote', { symbols: ['AAPL'] });
    assert.equal(res.ok, false);
    assert.match(res.error, /Roki and Grok/);
  });
});
