#!/usr/bin/env node
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('robinhood-mcp live trading gate', () => {
  const prev = process.env.ROBINHOOD_LIVE_TRADING;
  const modPath = path.join(__dirname, '..', 'src', 'robinhood-mcp.js');

  afterEach(() => {
    if (prev === undefined) delete process.env.ROBINHOOD_LIVE_TRADING;
    else process.env.ROBINHOOD_LIVE_TRADING = prev;
    delete require.cache[require.resolve(modPath)];
  });

  function load() {
    delete require.cache[require.resolve(modPath)];
    return require(modPath);
  }

  it('isLiveTradingEnabled reads ROBINHOOD_LIVE_TRADING', () => {
    delete process.env.ROBINHOOD_LIVE_TRADING;
    assert.equal(load().isLiveTradingEnabled(), false);
    process.env.ROBINHOOD_LIVE_TRADING = '1';
    assert.equal(load().isLiveTradingEnabled(), true);
    process.env.ROBINHOOD_LIVE_TRADING = 'true';
    assert.equal(load().isLiveTradingEnabled(), true);
    process.env.ROBINHOOD_LIVE_TRADING = 'no';
    assert.equal(load().isLiveTradingEnabled(), false);
  });

  it('placeEquityOrder throws when live trading disabled', async () => {
    delete process.env.ROBINHOOD_LIVE_TRADING;
    const rh = load();
    await assert.rejects(
      () => rh.placeEquityOrder({ symbol: 'AAPL', side: 'buy', quantity: 1 }),
      /ROBINHOOD_LIVE_TRADING/,
    );
  });
});

describe('denizen-mcp-scopes trade', () => {
  const mcpScopes = require('../src/denizen-mcp-scopes.js');

  it('maps place_equity_order to trade scope', () => {
    assert.equal(mcpScopes.requiredScope('place_equity_order'), 'trade');
    assert.equal(mcpScopes.requiredScope('review_equity_order'), 'read');
    assert.ok(mcpScopes.ALL_SCOPES.includes('trade'));
    assert.ok(mcpScopes.SCOPE_PRESETS.full.includes('trade'));
    assert.equal(mcpScopes.SCOPE_PRESETS.standard.includes('trade'), false);
  });

  it('denies place_equity_order on read-only tokens', () => {
    assert.equal(mcpScopes.toolAllowed({ scopes: ['read'] }, 'place_equity_order'), false);
    assert.equal(mcpScopes.toolAllowed({ scopes: ['read', 'trade'] }, 'place_equity_order'), true);
    assert.equal(mcpScopes.toolAllowed({ scopes: ['read'] }, 'review_equity_order'), true);
  });
});
