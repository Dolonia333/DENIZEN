'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const computeCredits = require('./src/denizen-compute-credits.js');
const contributionTracker = require('./src/denizen-contribution-tracker.js');

describe('denizen-compute-credits', () => {
  it('scales job credits by hardware score and contribution level', () => {
    const low = computeCredits.computeJobCredits({
      jobType: 'npc_think_batch',
      hardwareScore: 20,
      contributionLevel: 'light',
      durationMs: 12000,
      gpuUtilAvg: 10,
    });
    const high = computeCredits.computeJobCredits({
      jobType: 'npc_think_batch',
      hardwareScore: 88,
      contributionLevel: 'max',
      durationMs: 12000,
      gpuUtilAvg: 55,
    });
    assert.ok(high.amount > low.amount);
    assert.equal(high.formula_version, 1);
  });

  it('caps daily grants', () => {
    const identityId = 'test-cap-identity';
    let total = 0;
    for (let i = 0; i < 50; i += 1) {
      const cap = contributionTracker.grantWithCap(identityId, 'job', 10);
      total += cap.granted;
      if (cap.granted === 0) break;
    }
    assert.ok(total <= computeCredits.DAILY_CAPS.total_credits);
  });

  it('computes fleet bonus for multiple machines', () => {
    const bonus = computeCredits.computeFleetBonusCredits(3);
    assert.equal(bonus.amount, 2);
  });

  it('exposes spend catalog', () => {
    const option = computeCredits.getSpendOption('priority_boost');
    assert.ok(option.cost > 0);
    assert.ok(option.priority_delta > 0);
  });
});
