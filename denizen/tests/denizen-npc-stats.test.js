'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const npcStats = require('../src/office-hq/denizen-npc-stats');
const worldState = require('../src/world-state');

describe('denizen-npc-stats', () => {
  it('recordOutcome bumps the shipped bucket only on success+finished', () => {
    const npc = 'TestShipper' + Date.now();
    npcStats.recordOutcome(npc, { outcome: 'ok', taskPhase: 'continuing' });
    npcStats.recordOutcome(npc, { outcome: 'success', taskPhase: 'finished' });
    npcStats.recordOutcome(npc, { outcome: 'stuck', taskPhase: 'continuing' });

    const rec = worldState.getNpcStatRecord(npc);
    const today = npcStats._dateKey();
    assert.equal(rec.dailyCounts[today].shipped, 1);
    assert.equal(rec.dailyCounts[today].ok, 1);
    assert.equal(rec.dailyCounts[today].stuck, 1);
    assert.equal(rec.dailyCounts[today].blocked, 0);
  });

  it('getLeaderboard sorts by shipped count desc', () => {
    const a = 'LeaderA' + Date.now();
    const b = 'LeaderB' + Date.now();
    npcStats.recordOutcome(a, { outcome: 'success', taskPhase: 'finished' });
    npcStats.recordOutcome(b, { outcome: 'success', taskPhase: 'finished' });
    npcStats.recordOutcome(b, { outcome: 'success', taskPhase: 'finished' });

    const board = npcStats.getLeaderboard({ period: 'today' });
    const idxA = board.findIndex((r) => r.npcName === a);
    const idxB = board.findIndex((r) => r.npcName === b);
    assert.ok(idxB < idxA, 'NPC with more shipped work should rank higher');
    assert.equal(board[idxB].shipped, 2);
    assert.equal(board[idxA].shipped, 1);
  });

  it('computeStreak counts consecutive shipped days ending today', () => {
    const today = npcStats._dateKey();
    const yesterday = npcStats._dateKey(new Date(Date.now() - 86400000));
    const twoDaysAgo = npcStats._dateKey(new Date(Date.now() - 2 * 86400000));
    const fourDaysAgo = npcStats._dateKey(new Date(Date.now() - 4 * 86400000));

    const dailyCounts = {
      [today]: { shipped: 1, ok: 0, stuck: 0, blocked: 0 },
      [yesterday]: { shipped: 2, ok: 0, stuck: 0, blocked: 0 },
      [twoDaysAgo]: { shipped: 1, ok: 0, stuck: 0, blocked: 0 },
      [fourDaysAgo]: { shipped: 1, ok: 0, stuck: 0, blocked: 0 }, // gap at day 3 breaks the streak
    };
    const { streakDays, lastShipDate } = npcStats._computeStreak(dailyCounts);
    assert.equal(streakDays, 3);
    assert.equal(lastShipDate, today);
  });

  it('computeStreak stays alive if today has no shipped work yet', () => {
    const yesterday = npcStats._dateKey(new Date(Date.now() - 86400000));
    const dailyCounts = { [yesterday]: { shipped: 1, ok: 0, stuck: 0, blocked: 0 } };
    const { streakDays } = npcStats._computeStreak(dailyCounts);
    assert.equal(streakDays, 1);
  });

  it('getStreaks only returns NPCs with an active streak', () => {
    const streaks = npcStats.getStreaks();
    assert.ok(Array.isArray(streaks));
    assert.ok(streaks.every((s) => s.streakDays > 0));
  });
});
