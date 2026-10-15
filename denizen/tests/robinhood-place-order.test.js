'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rh = require('../src/robinhood-mcp');

const PLACE = {
  name: 'place_equity_order',
  inputSchema: {
    type: 'object',
    required: ['symbol', 'side', 'order_type'],
    additionalProperties: false,
    properties: {
      symbol: { type: 'string' },
      side: { type: 'string' },
      order_type: { type: 'string' },
      quantity: { type: 'number' },
      amount: { type: 'number' },
      account_number: { type: 'string' },
    },
  },
};

const REVIEW = {
  name: 'review_equity_order',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      symbol: { type: 'string' },
      side: { type: 'string' },
      quantity: { type: 'number' },
    },
  },
};

describe('agentic account selection', () => {
  it('refuses a connection with no agentic account', () => {
    assert.throws(
      () => rh.selectAgenticAccount([{ account_number: '1', agentic_allowed: false }]),
      /agentic/,
    );
  });

  it('picks the agentic account and ignores a regular brokerage', () => {
    const picked = rh.selectAgenticAccount([
      { account_number: 'REG', agentic_allowed: false, is_default: true },
      { account_number: 'AI99', agentic_allowed: true },
    ]);
    assert.equal(picked.account_number, 'AI99');
  });
});

describe('placeEquityOrder', () => {
  it('reviews then places on the agentic account', async () => {
    const calls = [];
    const result = await rh.placeEquityOrder({
      symbol: 'nvda',
      side: 'buy',
      quantity: 2,
    }, {
      tools: [REVIEW, PLACE],
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === 'get_accounts') {
          return { content: [{ type: 'text', text: JSON.stringify({ data: { accounts: [
            { account_number: 'REG', agentic_allowed: false },
            { account_number: 'AI4242', agentic_allowed: true },
          ] } }) }] };
        }
        if (name === 'review_equity_order') return { content: [{ type: 'text', text: '{"ok":true}' }] };
        if (name === 'place_equity_order') return { content: [{ type: 'text', text: '{"id":"ord_1"}' }] };
        throw new Error(`unexpected ${name}`);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.accountLast4, '4242');
    assert.deepEqual(calls.map((c) => c.name), ['get_accounts', 'review_equity_order', 'place_equity_order']);
    const placed = calls[2].args;
    assert.equal(placed.symbol, 'NVDA');
    assert.equal(placed.side, 'buy');
    assert.equal(placed.quantity, 2);
    assert.equal(placed.order_type, 'market');
    assert.equal(placed.account_number, 'AI4242');
  });

  it('does not place when review blocks', async () => {
    const calls = [];
    await assert.rejects(
      () => rh.placeEquityOrder({ symbol: 'AAPL', side: 'buy', amount: 25 }, {
        tools: [REVIEW, PLACE],
        callTool: async (name, args) => {
          calls.push(name);
          if (name === 'get_accounts') {
            return { data: { accounts: [{ account_number: 'AI1', agentic_allowed: true }] } };
          }
          return { can_place: false, reason: 'market closed' };
        },
      }),
      /market closed/,
    );
    assert.deepEqual(calls, ['get_accounts', 'review_equity_order']);
  });
});
