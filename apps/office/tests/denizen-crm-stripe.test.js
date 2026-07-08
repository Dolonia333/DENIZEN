'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const crmStripe = require('../src/denizen-crm-stripe');

describe('denizen-crm-stripe', () => {
  it('quoteAmountCents enforces minimum 50 cents', () => {
    assert.equal(crmStripe.quoteAmountCents({ monthlyTotal: 0, onetimeTotal: 0 }), 50);
    assert.equal(crmStripe.quoteAmountCents({ monthlyTotal: 99, onetimeTotal: 1 }), 10000);
  });

  it('stripeConfigured reflects env', () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(crmStripe.stripeConfigured(), false);
    process.env.STRIPE_SECRET_KEY = prev;
  });
});
