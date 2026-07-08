#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const marketTools = require('../src/mcp/denizen-mcp-market-tools.js');

describe('denizen-mcp-market-tools', () => {
  it('exposes market tools only for roki', () => {
    assert.equal(marketTools.toolsForNpc('roki').length, 5);
    assert.equal(marketTools.toolsForNpc('rob').length, 0);
  });

  it('get_watchlist returns symbols', async () => {
    const res = await marketTools.callTool('roki', 'get_watchlist', {});
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.symbols));
  });
});
