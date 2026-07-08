'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeFields, buildMergeContext, sendCrmEmail } = require('../src/crm/denizen-crm-email');
const { enrollContact, daysBetween } = require('../src/crm/denizen-crm-sequences');

describe('denizen-crm-email', () => {
  it('merges template fields', () => {
    const out = mergeFields('Hi {{name}} at {{company}} — {{deal.title}}', {
      name: 'Sam',
      company: 'Acme',
      dealTitle: 'Big deal',
    });
    assert.match(out, /Sam/);
    assert.match(out, /Acme/);
    assert.match(out, /Big deal/);
  });

  it('builds context from contact and deal', () => {
    const state = {
      contacts: [{ id: 1, name: 'Sam', company: 'Acme', email: 'sam@test.local' }],
      deals: [{ id: 2, title: 'Contract', contact: 'Sam', value: 12000 }],
    };
    const ctx = buildMergeContext(state, { contactId: 1, senderName: 'You' });
    assert.equal(ctx.name, 'Sam');
    assert.equal(ctx.dealTitle, 'Contract');
    assert.match(ctx.dealValue, /12/);
  });

  it('mailto fallback when no resend key', async () => {
    const state = {
      contacts: [{ id: 1, name: 'Sam', company: 'Acme', email: 'sam@test.local' }],
      emailLog: [],
      auditLog: [],
    };
    const result = await sendCrmEmail(state, {
      contactId: 1,
      subject: 'Hello',
      body: 'Test body',
      senderName: 'Tester',
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'mailto');
    assert.ok(result.mailto?.startsWith('mailto:'));
    assert.equal(result.state.emailLog.length, 1);
    assert.equal(result.state.emailLog[0].status, 'mailto');
  });
});

describe('denizen-crm-sequences', () => {
  it('enrolls a contact', () => {
    const state = {
      sequences: [{ id: 1, name: 'Welcome', active: true, enrolledCount: 0, completedCount: 0, steps: [] }],
      contacts: [{ id: 5, name: 'Sam', email: 'sam@test.local' }],
      sequenceEnrollments: [],
    };
    const result = enrollContact(state, 1, 5);
    assert.equal(result.ok, true);
    assert.equal(result.state.sequenceEnrollments.length, 1);
    assert.equal(result.state.sequences[0].enrolledCount, 1);
  });

  it('computes days between dates', () => {
    const days = daysBetween('2026-01-01T00:00:00.000Z', new Date('2026-01-04T12:00:00.000Z'));
    assert.equal(days, 3);
  });
});
