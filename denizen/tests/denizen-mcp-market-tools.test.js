#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const marketTools = require('../src/denizen-mcp-market-tools.js');

describe('denizen-mcp-market-tools', () => {
  it('exposes read tools to roki and live orders only to grok', () => {
    assert.equal(marketTools.toolsForNpc('roki').length, 5);
    assert.equal(marketTools.toolsForNpc('roki').some((t) => t.name === 'place_equity_order'), false);
    assert.equal(marketTools.toolsForNpc('grok').some((t) => t.name === 'place_equity_order'), true);
    assert.equal(marketTools.toolsForNpc('rob').length, 0);
  });

  it('refuses live orders from roki', async () => {
    const res = await marketTools.callTool('roki', 'place_equity_order', {
      symbol: 'AAPL', side: 'buy', quantity: 1,
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /Grok/);
  });

  it('get_watchlist returns symbols', async () => {
    const res = await marketTools.callTool('roki', 'get_watchlist', {});
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.symbols));
  });
});
