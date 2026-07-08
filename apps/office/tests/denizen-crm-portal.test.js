'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const portal = require('../src/denizen-crm-portal');

describe('denizen-crm-portal', () => {
  it('isTokenExpired respects grace period after validUntil', () => {
    const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal(portal.isTokenExpired(future), false);

    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    assert.equal(portal.isTokenExpired(past), true);
  });

  it('publicQuotePayload strips internal fields and exposes signatures', () => {
    const quote = {
      id: 7,
      clientName: 'Jane',
      company: 'Acme',
      recommendedPackage: 'Pro',
      lineItems: [{ id: 1, name: 'Plan', price: 99, unit: '/mo' }],
      monthlyTotal: 99,
      onetimeTotal: 0,
      validUntil: '2026-12-31',
      status: 'sent',
      portalToken: 'tok_test',
      portalViewedAt: null,
      portalSignedAt: null,
      portalSignatures: [{ id: 'sig_1', signerName: 'Jane', signedAt: '2026-06-01T00:00:00Z' }],
      internalField: 'hidden',
    };
    const payload = portal.publicQuotePayload(quote, { companyName: 'Meridian' });
    assert.equal(payload.clientName, 'Jane');
    assert.equal(payload.portalToken, 'tok_test');
    assert.equal(payload.signatures.length, 1);
    assert.equal(payload.branding.companyName, 'Meridian');
    assert.equal(payload.internalField, undefined);
  });

  it('publicQuotePayload returns null for missing quote', () => {
    assert.equal(portal.publicQuotePayload(null), null);
  });
});
