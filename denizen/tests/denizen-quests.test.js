'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const worldState = require('../src/world-state');
const quests = require('../src/office-hq/denizen-quests');
const officeProgress = require('../src/office-hq/denizen-office-progress');

function resetQuestState() {
  worldState.quests = { periodKeys: {}, progress: {} };
  quests._ensurePeriods();
}

describe('denizen-quests', () => {
  beforeEach(resetQuestState);

  it('counter quest increments only on matching outcome type', () => {
    quests.recordProgress('ticket_closed');
    quests.recordProgress('task_shipped');
    const all = quests.getActiveQuests();
    const daily = all.find((q) => q.id === 'daily_ticket_2');
    const ship = all.find((q) => q.id === 'daily_ship_3');
    assert.equal(daily.count, 1);
    assert.equal(ship.count, 1);
    const deals = all.find((q) => q.id === 'weekly_deals_2');
    assert.equal(deals.count, 0);
  });

  it('quest_reward never feeds quest progress (no award loop)', () => {
    const before = quests.getActiveQuests().map((q) => q.count);
    officeProgress.awardXp('quest_reward', 5, {});
    const after = quests.getActiveQuests().map((q) => q.count);
    assert.deepEqual(after, before);
  });

  it('completing a quest emits quest_complete once', () => {
    const events = [];
    const onComplete = (p) => events.push(p);
    worldState.on('quest_complete', onComplete);

    quests.recordProgress('ticket_closed');
    quests.recordProgress('ticket_closed');
    quests.recordProgress('ticket_closed');

    const fires = events.filter((e) => e.id === 'daily_ticket_2');
    assert.equal(fires.length, 1, 'complete announced exactly once');

    worldState.off('quest_complete', onComplete);
  });

  it('claim awards XP once and is idempotent on second claim', () => {
    quests.recordProgress('ticket_closed');
    quests.recordProgress('ticket_closed');

    const xpBefore = worldState.officeProgress.totalXp;
    const first = quests.claimQuest('daily_ticket_2');
    assert.equal(first.ok, true);
    assert.equal(worldState.officeProgress.totalXp, xpBefore + 10);

    const second = quests.claimQuest('daily_ticket_2');
    assert.equal(second.ok, false);
    assert.equal(second.error, 'already claimed');
    assert.equal(worldState.officeProgress.totalXp, xpBefore + 10, 'no double award');
  });

  it('claim rejects incomplete and unknown quests', () => {
    const incomplete = quests.claimQuest('daily_ship_3');
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.error, 'quest not complete');

    const unknown = quests.claimQuest('nope');
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error, 'quest not found');
  });

  it('period rollover resets progress for that period only', () => {
    quests.recordProgress('ticket_closed');
    quests.recordProgress('deal_won');

    // Simulate a stale daily key ΓÇö next ensurePeriods should reset daily quests.
    worldState.quests.periodKeys.daily = '1999-01-01';
    quests._ensurePeriods();

    const all = quests.getActiveQuests();
    assert.equal(all.find((q) => q.id === 'daily_ticket_2').count, 0, 'daily reset');
    assert.equal(all.find((q) => q.id === 'weekly_deals_2').count, 1, 'weekly untouched');
  });

  it('tickQuests syncs snapshot streak quests from npcStats', () => {
    const npcStats = require('../src/office-hq/denizen-npc-stats');
    const npc = 'QuestStreaker' + Date.now();
    npcStats.recordOutcome(npc, { outcome: 'success', taskPhase: 'finished' });

    quests.tickQuests();
    const streakQuest = quests.getActiveQuests().find((q) => q.id === 'weekly_streak_7');
    assert.ok(streakQuest.count >= 1, 'streak snapshot reflected in quest progress');
  });
});
