'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const officeDirector = require('../src/office-director');
const telemetryInsights = require('../src/intelligence/telemetry-insights');

describe('office-director', () => {
  it('needsLlm when escalation or directive pending', () => {
    assert.equal(officeDirector.needsLlm('Alex', { inbox: [{ kind: 'escalate', text: 'blocked' }] }), true);
    assert.equal(officeDirector.needsLlm('Alex', { hasDirective: true }), true);
    assert.equal(officeDirector.needsLlm('Alex', { pendingSkill: true }), true);
    assert.equal(officeDirector.needsLlm('Alex', { inbox: [], cycles: 2 }), false);
  });

  it('plan returns valid decision shape', () => {
    const mgr = {
      brains: { Alex: { role: 'Developer' } },
      _hierarchy: {
        Alex: { reportsTo: 'Abby', manages: ['Josh', 'Edward', 'Roki'], title: 'Senior Developer' },
        Josh: { reportsTo: 'Alex', manages: [], title: 'Frontend Developer' },
        Abby: { reportsTo: 'CEO', manages: ['Alex'], title: 'CTO' },
      },
      _getTeamsForNpc(name) {
        if (name === 'Alex') return [{ members: ['Alex', 'Josh', 'Edward', 'Roki'] }];
        return [];
      },
      getDailyPlan() {
        return { priorities: ['Finish auth module', 'Review PRs'] };
      },
    };
    const d = officeDirector.plan(mgr, 'Alex', { cycles: 1 });
    assert.ok(d.action);
    assert.ok(d.location);
    assert.equal(d._director, true);
    assert.equal(d.outcome, 'ok');
  });
});

describe('telemetry-insights', () => {
  it('analyzes sample records', () => {
    const sample = [
      { at: '2026-06-01T10:00:00.000Z', kind: 'think', npc: 'Abby', tokensIn: 3000, tokensOut: 80 },
      { at: '2026-06-01T10:05:00.000Z', kind: 'think', npc: 'Lucy', tokensIn: 4000, tokensOut: 0, error: { category: 'context_overflow' } },
      { at: '2026-06-02T10:00:00.000Z', kind: 'response', npc: 'Alex', tokensIn: 500, tokensOut: 120 },
    ];
    const insights = telemetryInsights.analyze(sample);
    assert.equal(insights.summary.totalCalls, 3);
    assert.equal(insights.summary.testingDays, 2);
    assert.ok(insights.recommendations.length >= 1);
    assert.ok(insights.summary.thinkShare > 0);
  });
});
