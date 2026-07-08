'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const worldState = require('../src/world-state');
const achievements = require('../src/office-hq/denizen-achievements');
const officeProgress = require('../src/office-hq/denizen-office-progress');

describe('denizen-achievements', () => {
  it('loads definitions from data/achievements.json', () => {
    const defs = achievements._loadDefinitions();
    assert.ok(defs.length > 0);
    assert.ok(defs.every((d) => d.id && d.metric && Number.isFinite(d.threshold)));
    assert.ok(defs.every((d) => d.icon && !/\p{Extended_Pictographic}/u.test(d.icon)), 'icons should be Tabler slugs, not emoji');
  });

  it('resolveMetric reads cumulative counts and level', () => {
    worldState.officeProgress.counts.deal_won = 3;
    assert.equal(achievements._resolveMetric('deal_won'), 3);
    assert.equal(achievements._resolveMetric('level'), worldState.officeProgress.level);
    assert.equal(achievements._resolveMetric('unknown_metric'), 0);
  });

  it('evaluate unlocks exactly once at threshold and announces', () => {
    const announced = [];
    const onUnlock = (p) => announced.push(p);
    worldState.on('achievement_unlocked', onUnlock);

    worldState.officeAchievements.delete('first_deal_won');
    worldState.officeProgress.counts.deal_won = 1;

    const first = achievements.evaluate();
    assert.ok(first.some((d) => d.id === 'first_deal_won'));
    assert.ok(worldState.officeAchievements.has('first_deal_won'));
    assert.ok(announced.some((p) => p.id === 'first_deal_won'));

    const second = achievements.evaluate();
    assert.ok(!second.some((d) => d.id === 'first_deal_won'), 'must not re-unlock');

    worldState.off('achievement_unlocked', onUnlock);
  });

  it('getAchievements splits unlocked vs locked with progress', () => {
    const { unlocked, locked } = achievements.getAchievements();
    assert.ok(unlocked.some((a) => a.id === 'first_deal_won'));
    const lockedIds = locked.map((a) => a.id);
    assert.ok(!lockedIds.includes('first_deal_won'));
    assert.ok(locked.every((a) => Number.isFinite(a.progress)));
  });

  it('quest_reward XP can unlock XP-metric achievements via awardXp', () => {
    worldState.officeAchievements.delete('xp_1000');
    worldState.setOfficeProgress({ totalXp: 999 });
    officeProgress.awardXp('quest_reward', 1, { questId: 'test' });
    assert.ok(worldState.officeAchievements.has('xp_1000'));
  });
});
