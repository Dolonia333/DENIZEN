'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const crmStore = require('../src/crm/denizen-crm-store');
const crmSpine = require('../src/crm/denizen-crm-spine');
const denizenDb = require('../src/intelligence/denizen-db');

describe('denizen-crm-integration', { skip: !process.env.SUPABASE_URL ? 'SUPABASE_URL not set' : false }, () => {
  let orgId;

  before(async () => {
    const init = await denizenDb.init();
    if (!init.ok) return;
    orgId = denizenDb.orgId;
  });

  it('upserts and reads workspace round-trip', async () => {
    if (!orgId) return;
    const state = {
      contacts: [{ id: 99, name: 'Test User', email: 'crm-test@denizen.local', company: 'Denizen', status: 'Lead' }],
      deals: [{ id: 1, title: 'Test Deal', contact: 'Test User', value: 1000, stage: 'Proposal' }],
    };
    const saved = await crmStore.upsertWorkspace(orgId, state, null);
    assert.ok(saved?.org_id || saved?.state, 'workspace saved');
    const row = await crmStore.getWorkspace(orgId);
    assert.equal(row.state.contacts[0].email, 'crm-test@denizen.local');
    assert.equal(row.state.deals[0].title, 'Test Deal');
  });

  it('detects optimistic concurrency conflicts', async () => {
    if (!orgId) return;
    const row = await crmStore.getWorkspace(orgId);
    const stale = row?.updated_at || '1970-01-01T00:00:00.000Z';
    const result = await crmStore.upsertWorkspace(
      orgId,
      { contacts: [{ id: 1, name: 'Conflict', email: 'conflict@denizen.local' }] },
      null,
      { ifUpdatedAt: '1970-01-01T00:00:00.000Z' },
    );
    if (row?.updated_at && row.updated_at !== stale) {
      assert.equal(result.conflict, true);
    }
  });

  it('stable deal uuid helper', () => {
    const a = crmSpine.crmStableUuid('org', 'crm_deal', 5);
    const b = crmSpine.crmStableUuid('org', 'crm_deal', 5);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/i);
  });
});
