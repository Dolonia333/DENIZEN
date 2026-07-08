'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const officeProgress = require('../src/office-hq/denizen-office-progress');

describe('denizen-office-progress', () => {
  it('awardXp increases totalXp by the given weight', () => {
    const before = officeProgress.getProgress();
    const result = officeProgress.awardXp('task_shipped', 1, { npc: 'Test' });
    assert.equal(result.totalXp, before.totalXp + 1);
  });

  it('_levelForXp is monotonic and starts at level 1', () => {
    assert.equal(officeProgress._levelForXp(0), 1);
    assert.equal(officeProgress._levelForXp(49), 1);
    assert.equal(officeProgress._levelForXp(50), 2);
  });

  it('awardXp reports leveledUp when crossing a threshold', () => {
    const before = officeProgress.getProgress();
    if (before.xpForNextLevel == null) return; // already at max configured level
    const weightToLevelUp = before.xpForNextLevel - before.xpIntoLevel;
    const result = officeProgress.awardXp('deal_won', weightToLevelUp, { dealId: 'x' });
    assert.equal(result.leveledUp, true);
    assert.equal(result.level, before.level + 1);
  });

  it('awardXp with zero weight is a no-op', () => {
    const before = officeProgress.getProgress();
    officeProgress.awardXp('task_shipped', 0, {});
    const after = officeProgress.getProgress();
    assert.deepEqual(after, before);
  });
});
