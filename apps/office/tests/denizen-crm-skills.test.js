'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findSubmission, findContact } = require('../src/crm/denizen-crm-skills');

describe('denizen-crm-skills helpers', () => {
  it('findSubmission picks by company', () => {
    const state = {
      submissions: [{ id: 1, company: 'CloudForge', clientName: 'Raj', status: 'new' }],
    };
    assert.equal(findSubmission(state, { company: 'CloudForge' })?.id, 1);
  });

  it('findContact picks by email', () => {
    const state = {
      contacts: [{ id: 2, name: 'Jane', email: 'jane@acme.com' }],
    };
    assert.equal(findContact(state, { email: 'jane@acme.com' })?.id, 2);
  });
});
