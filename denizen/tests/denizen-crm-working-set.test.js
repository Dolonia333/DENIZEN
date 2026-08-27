'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../src/denizen-crm-working-set');
const mcpCrm = require('../src/denizen-mcp-crm-tools');
const { inferCrmAction } = require('../src/denizen-crm-npc-personas');
const { getOperatorHint, ALL_CRM_SKILLS } = require('../src/denizen-crm-operator');

describe('denizen-crm-working-set', () => {
  it('excludes watchlist from open pipeline and keeps $ honest', () => {
    const board = ws.buildWorkingSet({
      deals: [
        { id: 1, title: 'Live', stage: 'Partnership Development', value: 0, contact: 'Ballard' },
        { id: 2, title: 'RFP', stage: 'Watch / Research', status: 'watchlist', tags: ['federal-rfp'], value: 0 },
        { id: 3, title: 'Seed', stage: 'Lost / Disqualified', status: 'disqualified', value: 45000 },
      ],
      contacts: [{ id: 1, name: 'Ballard', email: 'a@b.com', status: 'Partner' }],
      tasks: [{ id: 1, title: 'Email Ballard', due: '2099-01-01', done: false }],
      companies: [],
      today: '2026-08-27',
    });
    assert.equal(board.counts.open_pipeline, 1);
    assert.equal(board.counts.open_pipeline_value, 0);
    assert.equal(board.counts.watchlist, 1);
    assert.equal(board.empty, false);
  });

  it('marks empty workspace clearly', () => {
    const board = ws.buildWorkingSet({ deals: [], contacts: [], tasks: [], companies: [] });
    assert.equal(board.empty, true);
    assert.ok(board.next_steps[0].toLowerCase().includes('empty'));
  });

  it('playbook lists MCP read-first tools', () => {
    const p = ws.playbookResource();
    assert.ok(p.mcp.read_first.includes('crm_working_set'));
    assert.ok(p.checklist.length >= 4);
  });
});

describe('mcp crm tools + routing', () => {
  it('exposes crm_working_set as first-class tool', () => {
    assert.ok(mcpCrm.isCrmTool('crm_working_set'));
    assert.ok(mcpCrm.hasCrmAccess('_team'));
    const def = mcpCrm.CRM_TOOL_DEFINITIONS.find((t) => t.name === 'crm_working_set');
    assert.match(def.description, /READ-ONLY/i);
  });

  it('infers working-set skill', () => {
    assert.equal(inferCrmAction('show me the CRM working set')?.skill, 'crm-working-set');
    assert.equal(inferCrmAction('give me a CRM pipeline brief')?.skill, 'crm-pipeline-brief');
  });

  it('operator catalog includes capture + working-set', () => {
    assert.ok(ALL_CRM_SKILLS.includes('crm-working-set'));
    assert.ok(ALL_CRM_SKILLS.includes('crm-capture'));
    assert.match(getOperatorHint(), /crm-working-set|working set/i);
  });
});
