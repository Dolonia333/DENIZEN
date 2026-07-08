'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreDecision } = require('../src/intelligence/outcome-scorer.js');
const competencyMap = require('../src/npc/competency-map.js');

describe('outcome-scorer', () => {
  it('scores skill errors as 0', () => {
    const r = scoreDecision({ taskPhase: 'finished' }, { skillError: true });
    assert.equal(r.score, 0);
  });

  it('scores chain advancement as 5', () => {
    const r = scoreDecision({ taskPhase: 'finished', outcome: 'success' }, { chainAdvanced: true });
    assert.equal(r.score, 5);
  });

  it('scores blocked outcomes as 2', () => {
    const r = scoreDecision({ outcome: 'blocked' });
    assert.equal(r.score, 2);
  });
});

describe('competency-map', () => {
  it('records outcomes and exposes gaps', () => {
    competencyMap.recordOutcome('Edward', { score: 4, skillDelta: { backend: 1 } });
    competencyMap.recordOutcome('Josh', { score: 3, skillDelta: { frontend: 2 } });
    const gaps = competencyMap.getTeamGaps(5);
    assert.ok(Array.isArray(gaps));
    const ed = competencyMap.getNpcProfile('Edward');
    assert.ok(ed.avgOutcome > 0);
  });
});
