'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyServerAutomations, evaluateConditions } = require('../src/denizen-crm-automations');

describe('denizen-crm-automations', () => {
  it('deal_created creates task and logs run', async () => {
    const prev = { deals: [], tasks: [], contacts: [], automations: [] };
    const next = {
      deals: [{ id: 1, title: 'New deal', contact: 'Ada', stage: 'Lead', value: 5000 }],
      tasks: [],
      contacts: [{ id: 1, name: 'Ada', email: 'ada@test.com' }],
      automations: [{
        id: 9, name: 'On create', active: true, trigger: 'deal_created', action: 'create_task',
        actionDetail: 'Qualify', conditions: '',
      }],
      automationRuns: [],
    };
    const { changed, state } = await applyServerAutomations(next, prev);
    assert.equal(changed, true);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.automationRuns.length, 1);
    assert.equal(state.automations[0].runCount, 1);
  });

  it('task_overdue dedupes by key', async () => {
    const state = {
      tasks: [{ id: 1, title: 'Late', due: '2000-01-01', done: false }],
      deals: [],
      contacts: [],
      automations: [{
        id: 2, name: 'Overdue', active: true, trigger: 'task_overdue', action: 'notify',
        actionDetail: 'Ping', conditions: '',
      }],
      automationRuns: [{
        id: 1, automationId: 2, dedupeKey: 'task_overdue:2:1:2000-01-01', at: new Date().toISOString(),
      }],
    };
    const { changed } = await applyServerAutomations(state, state);
    assert.equal(changed, false);
  });

  describe('evaluateConditions', () => {
    it('empty condition always fires', () => {
      assert.equal(evaluateConditions('', {}), true);
    });

    it('non-empty unrecognized condition no longer silently fires', () => {
      // Was the bug: any unparseable string returned true. Now it must be false.
      assert.equal(evaluateConditions('lorem ipsum nonsense', { deal: {} }), false);
    });

    it('numeric field comparison', () => {
      assert.equal(evaluateConditions('deal.value >= 10000', { deal: { value: 25000 } }), true);
      assert.equal(evaluateConditions('deal.value >= 10000', { deal: { value: 500 } }), false);
    });

    it('stage equality and keyword shortcuts', () => {
      assert.equal(evaluateConditions('stage:Proposal', { deal: { stage: 'Proposal' } }), true);
      assert.equal(evaluateConditions('customer', { contact: { status: 'Customer' } }), true);
      assert.equal(evaluateConditions('high value', { deal: { value: 20000 } }), true);
    });

    it('AND requires all clauses; OR requires any', () => {
      const ctx = { deal: { value: 20000, stage: 'Proposal' } };
      assert.equal(evaluateConditions('deal.value >= 10000 and stage:Proposal', ctx), true);
      assert.equal(evaluateConditions('deal.value >= 10000 and stage:Lead', ctx), false);
      assert.equal(evaluateConditions('stage:Lead or deal.value >= 10000', ctx), true);
    });
  });
});
