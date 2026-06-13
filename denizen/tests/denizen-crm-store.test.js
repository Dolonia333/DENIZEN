'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const crmStore = require('../src/denizen-crm-store');

describe('denizen-crm-store', () => {
  it('sanitizeState keeps known CRM keys only', () => {
    const out = crmStore.sanitizeState({
      contacts: [{ id: 1 }],
      deals: [],
      companies: [{ id: 1, name: 'Co' }],
      goals: [],
      sequences: [{ id: 1, name: 'Seq' }],
      hacker: 'nope',
      notes: 'bad',
    });
    assert.deepEqual(out.contacts, [{ id: 1 }]);
    assert.deepEqual(out.deals, []);
    assert.deepEqual(out.companies, [{ id: 1, name: 'Co' }]);
    assert.deepEqual(out.sequences, [{ id: 1, name: 'Seq' }]);
    assert.equal(out.hacker, undefined);
    assert.equal(out.notes, undefined);
  });

  it('hasWorkspaceData detects non-empty arrays', () => {
    assert.equal(crmStore.hasWorkspaceData({}), false);
    assert.equal(crmStore.hasWorkspaceData({ contacts: [] }), false);
    assert.equal(crmStore.hasWorkspaceData({ contacts: [{ id: 1 }] }), true);
  });
});
