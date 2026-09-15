'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('agency MCP tools', () => {
  it('exposes working set / link / handoff', () => {
    const agency = require('../src/denizen-mcp-agency-tools');
    assert.equal(agency.AGENCY_TOOL_DEFINITIONS.length, 3);
    assert.ok(agency.isAgencyTool('agency_working_set'));
    assert.ok(agency.isAgencyTool('agency_link_deal_task'));
    assert.ok(agency.isAgencyTool('agency_handoff_won_deal'));
  });

  it('collects bidirectional links', () => {
    const agency = require('../src/denizen-mcp-agency-tools');
    const links = agency.collectLinks(
      {
        deals: [
          { id: 7, title: 'Acme', stage: 'Closed Won', studioTaskIds: ['t1'] },
          { id: 8, title: 'Orphan', stage: 'Qualified' },
        ],
      },
      {
        tasks: [
          { id: 't1', title: 'Kickoff', status: 'todo', dealId: 7 },
          { id: 't2', title: 'Only board link', status: 'todo', deal_id: 8 },
        ],
      },
    );
    assert.equal(links.length, 2);
    const acme = links.find((l) => l.deal_id === '7');
    assert.ok(acme.studio_task_ids.includes('t1'));
    const orphan = links.find((l) => l.deal_id === '8');
    assert.ok(orphan.studio_task_ids.includes('t2'));
  });
});

describe('CRM first-class write tools', () => {
  it('registers upsert/move/complete/note tools', () => {
    const crm = require('../src/denizen-mcp-crm-tools');
    const names = crm.CRM_TOOL_DEFINITIONS.map((t) => t.name);
    for (const n of [
      'crm_upsert_contact',
      'crm_upsert_deal',
      'crm_move_deal',
      'crm_upsert_task',
      'crm_complete_task',
      'crm_add_note',
    ]) {
      assert.ok(names.includes(n), n);
      assert.ok(crm.isCrmTool(n));
    }
  });
});

describe('agency + CRM write scopes', () => {
  it('maps agency and CRM writes to scopes', () => {
    const scopes = require('../src/denizen-mcp-scopes');
    assert.equal(scopes.requiredScope('agency_working_set'), 'read');
    assert.equal(scopes.requiredScope('agency_link_deal_task'), 'crm_write');
    assert.equal(scopes.requiredScope('agency_handoff_won_deal'), 'crm_write');
    assert.equal(scopes.requiredScope('crm_upsert_deal'), 'crm_write');
    assert.equal(scopes.requiredScope('crm_complete_task'), 'crm_write');
    assert.equal(scopes.requiredScope('crm_add_note'), 'crm_write');
  });
});

describe('board task CRM link fields', () => {
  it('summarizes deal_id and contact_id', () => {
    const mutations = require('../src/denizen-studio-board-mutations');
    const s = mutations.summarizeTask({
      id: 't1',
      title: 'Work',
      status: 'todo',
      dealId: 42,
      contactId: 9,
    });
    assert.equal(s.deal_id, 42);
    assert.equal(s.contact_id, 9);
  });
});

describe('CRM deal studio_task_ids summary', () => {
  it('includes studio_task_ids on deal summaries', () => {
    const ws = require('../src/denizen-crm-working-set');
    const board = ws.buildWorkingSet({
      deals: [{
        id: 1,
        title: 'Live',
        stage: 'Qualified',
        value: 1000,
        contact: 'Pat',
        studioTaskIds: ['a', 'b'],
      }],
      contacts: [],
      tasks: [],
      companies: [],
    });
    assert.deepEqual(board.pipelineDeals[0].studio_task_ids, ['a', 'b']);
  });
});
