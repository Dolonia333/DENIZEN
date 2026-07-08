'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildDailySnapshot, appendDailySnapshot, summarizeDeals } = require('../src/crm/denizen-crm-metrics');

describe('denizen-crm-metrics', () => {
  it('summarizeDeals splits open/won/lost', () => {
    const s = summarizeDeals([
      { stage: 'Proposal', value: 1000 },
      { stage: 'Closed Won', value: 500 },
      { stage: 'Closed Lost', value: 200 },
    ]);
    assert.equal(s.openCount, 1);
    assert.equal(s.wonCount, 1);
    assert.equal(s.lostCount, 1);
    assert.equal(s.pipelineValue, 1000);
    assert.equal(s.wonValue, 500);
  });

  it('appendDailySnapshot dedupes same day', () => {
    const state = {
      deals: [{ stage: 'Lead', value: 100 }],
      contacts: [{ id: 1 }],
      tasks: [{ done: false, due: '2000-01-01' }],
      metricSnapshots: [],
    };
    const first = appendDailySnapshot(state);
    assert.equal(first.changed, true);
    assert.equal(first.state.metricSnapshots.length, 1);
    const second = appendDailySnapshot(first.state);
    assert.equal(second.changed, false);
  });

  it('buildDailySnapshot includes overdue tasks', () => {
    const snap = buildDailySnapshot({
      deals: [],
      contacts: [],
      tasks: [{ done: false, due: '2000-01-01' }, { done: true, due: '2000-01-01' }],
    });
    assert.equal(snap.overdueTasks, 1);
  });
});
