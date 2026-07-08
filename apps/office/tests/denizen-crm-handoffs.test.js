'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { intakeQualifiedHandoff, findOverdueTasks } = require('../src/crm/denizen-crm-handoffs');
const { applyServerAutomations } = require('../src/crm/denizen-crm-automations');
const { proposeActions, mergeWorkspaceStates } = require('../src/crm/denizen-crm-assist');

describe('denizen-crm-handoffs', () => {
  it('creates contact and deal on qualified intake', () => {
    const { state, changed } = intakeQualifiedHandoff({}, {
      id: 1,
      clientName: 'Priya',
      clientEmail: 'priya@test.local',
      company: 'Nexus',
      status: 'qualified',
    });
    assert.equal(changed, true);
    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
  });

  it('finds overdue tasks', () => {
    const overdue = findOverdueTasks({
      tasks: [{ id: 1, title: 'Late', done: false, due: '2020-01-01' }],
    });
    assert.equal(overdue.length, 1);
  });
});

describe('denizen-crm-automations', () => {
  it('creates task when deal moves to won', async () => {
    const prev = { deals: [{ id: 1, title: 'A', stage: 'Proposal' }], automations: [{ id: 1, active: true, trigger: 'deal_won', action: 'create_task', actionDetail: 'Celebrate' }], tasks: [] };
    const next = { ...prev, deals: [{ id: 1, title: 'A', stage: 'Closed Won' }] };
    const { changed, state } = await applyServerAutomations(next, prev);
    assert.equal(changed, true);
    assert.equal(state.tasks.length, 1);
  });
});

describe('denizen-crm-assist extras', () => {
  it('proposes focus actions', () => {
    const summary = {
      overdueTaskCount: 1,
      atRiskCount: 1,
      topTasks: [{ title: 'Call', due: '2020-01-01', overdue: true }],
      atRiskDeals: [{ title: 'Big', contact: 'Acme' }],
      topDeals: [{ title: 'Big', contact: 'Acme' }],
      newSubmissionCount: 0,
    };
    const actions = proposeActions('what should I focus on today', summary);
    assert.ok(actions.length >= 1);
  });

  it('mergeWorkspaceStates prefers non-empty client arrays', () => {
    const merged = mergeWorkspaceStates({ contacts: [] }, { contacts: [{ id: 1 }] });
    assert.equal(merged.contacts.length, 1);
  });
});
