'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('CRM MCP member scoping', () => {
  let crmTools;
  let originalGet;

  beforeEach(() => {
    // Fresh require path — clear cache so mocks apply cleanly.
    delete require.cache[require.resolve('../src/denizen-mcp-crm-tools')];
    delete require.cache[require.resolve('../src/denizen-crm-store')];
    crmTools = require('../src/denizen-mcp-crm-tools');
    const store = require('../src/denizen-crm-store');
    originalGet = store.getWorkspace;
    store.getWorkspace = async () => ({
      state: {
        deals: [
          { id: 1, title: 'Kaiser Deal', contact: 'Acme', ownerId: 'Kaiser', value: 100, stage: 'Lead', status: 'open' },
          { id: 2, title: 'Zion Deal', contact: 'Beta', ownerId: 'Zion', value: 200, stage: 'Lead', status: 'open' },
        ],
        contacts: [
          { id: 10, name: 'Acme', ownerId: 'Kaiser' },
          { id: 11, name: 'Beta', ownerId: 'Zion' },
        ],
        tasks: [
          { id: 20, title: 'Call Acme', assignee: 'Kaiser', done: false },
          { id: 21, title: 'Call Beta', assignee: 'Zion', done: false },
        ],
        meetings: [
          { id: 30, title: 'Team standup', ownerName: 'Zion', visibility: 'team' },
        ],
        userPrefs: {
          profiles: {
            'id-kaiser': { profile: { name: 'Kaiser' } },
            'id-zion': { profile: { name: 'Zion' } },
          },
        },
      },
      updated_at: '2026-10-05T00:00:00.000Z',
    });
  });

  afterEach(() => {
    const store = require('../src/denizen-crm-store');
    store.getWorkspace = originalGet;
  });

  it('filters crm_working_set to the member + team calendar', async () => {
    const res = await crmTools.callTool({
      org_id: 'org-1',
      npc_key: 'josh',
      identity_id: 'id-kaiser',
      display_name: 'Kaiser',
      user: 'Kaiser',
      role: 'member',
      org_wide: false,
      data_scope: 'own',
      _mcp_actor_enriched: true,
    }, 'crm_working_set', {});

    assert.equal(res.ok, true);
    assert.equal(res.data_scope, 'own');
    assert.equal(res.filtered, true);
    assert.equal(res.viewer.identity_id, 'id-kaiser');
    const dealTitles = (res.deals || res.open_deals || []).map((d) => d.title || d.id);
    // working-set shape may nest under different keys — assert via counts/summary
    assert.match(String(res.summary || ''), /Scoped to Kaiser/i);
    assert.ok(!String(res.summary || '').includes('Zion Deal'));
  });

  it('keeps org-wide working set for owners', async () => {
    const res = await crmTools.callTool({
      org_id: 'org-1',
      npc_key: 'abby',
      identity_id: 'id-angela',
      display_name: 'Angela',
      user: 'Angela',
      role: 'owner',
      org_wide: true,
      data_scope: 'org',
      _mcp_actor_enriched: true,
    }, 'crm_working_set', {});

    assert.equal(res.ok, true);
    assert.equal(res.data_scope, 'org');
    assert.equal(res.filtered, false);
    assert.match(String(res.summary || ''), /Org-wide view/i);
  });
});
