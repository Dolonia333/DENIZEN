'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findSubmission, findContact, removeContactFromState } = require('../src/denizen-crm-skills');
const { operateCrm } = require('../src/denizen-crm-operate');

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

  it('finds a contact by contact_id even when the email is new', () => {
    const state = {
      contacts: [{ id: 1789607186330, name: 'Benjamin Ballard', email: '', company: 'RM Cyber' }],
    };
    const found = findContact(state, { contact_id: '1789607186330', email: 'ben@rm.example' });
    assert.equal(found?.id, 1789607186330);
    assert.equal(found?.name, 'Benjamin Ballard');
  });

  it('deletes a contact by the listed id', () => {
    const state = {
      contacts: [
        { id: 1789607186333, name: 'CRM recommendation' },
        { id: 1789607186330, name: 'Benjamin Ballard' },
      ],
      companies: [{ id: 1, name: 'RM Cyber', linkedContacts: [1789607186333] }],
    };
    const removed = removeContactFromState(state, { contact_id: 1789607186333 });
    assert.equal(removed.removed.name, 'CRM recommendation');
    assert.equal(removed.state.contacts.length, 1);
    assert.deepEqual(removed.state.companies[0].linkedContacts, []);
  });

  it('crm_operate rejects an unknown action before touching the workspace', async () => {
    const result = await operateCrm('org', { action: 'not-a-real-action' });
    assert.equal(result.ok, false);
    assert.ok(result.actions.includes('update-contact'));
    assert.ok(result.actions.includes('sync-business-context'));
  });
});
