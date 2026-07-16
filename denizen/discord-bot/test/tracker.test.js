'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TrackerEngine } = require('../src/tracker');

describe('TrackerEngine', () => {
  it('tracks hard voice join/move/leave with counts', () => {
    const logs = [];
    const tracker = new TrackerEngine({
      log: {
        join: (x) => logs.push(['join', x]),
        leave: (x) => logs.push(['leave', x]),
        move: (x) => logs.push(['move', x]),
        text: () => {},
        expire: () => {},
      },
    });

    tracker.applyVoice({
      kind: 'join',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: null,
      toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
    });
    assert.equal(tracker.getOccupantCount('g1', 'vc1'), 1);
    assert.equal(logs[0][0], 'join');

    tracker.applyVoice({
      kind: 'move',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: 'vc1',
      toChannelId: 'vc2',
      fromChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      toChannel: { id: 'vc2', name: 'Gaming', type: 'voice' },
    });
    assert.equal(tracker.getOccupantCount('g1', 'vc1'), 0);
    assert.equal(tracker.getOccupantCount('g1', 'vc2'), 1);
    assert.equal(logs[1][0], 'move');
    assert.match(logs[1][1].toRoom.name, /Gaming/);

    tracker.applyVoice({
      kind: 'leave',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: 'vc2',
      toChannelId: null,
      fromChannel: { id: 'vc2', name: 'Gaming', type: 'voice' },
    });
    assert.equal(tracker.getOccupantCount('g1', 'vc2'), 0);
  });

  it('tracks mute flags without channel change', () => {
    const tracker = new TrackerEngine({ log: { join: () => {}, leave: () => {}, move: () => {}, text: () => {}, expire: () => {} } });
    tracker.applyVoice({
      kind: 'join', guildId: 'g1', userId: 'u1', displayName: 'Ada',
      fromChannelId: null, toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      muted: false,
    });
    tracker.applyVoiceFlags({
      guildId: 'g1', userId: 'u1', displayName: 'Ada', channelId: 'vc1',
      muted: true, deafened: false, streaming: true, video: false,
    });
    const snap = tracker.snapshot('g1');
    const m = snap.members.find((x) => x.userId === 'u1');
    assert.equal(m.muted, true);
    assert.equal(m.streaming, true);
    assert.equal(m.live, false);
  });

  it('hangout leaderboard accumulates VC time', () => {
    const tracker = new TrackerEngine({ log: { join: () => {}, leave: () => {}, move: () => {}, text: () => {}, expire: () => {} } });
    const t0 = Date.now() - 120_000;
    tracker.applyVoice({
      kind: 'join', guildId: 'g1', userId: 'u1', displayName: 'Ada',
      fromChannelId: null, toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      now: t0,
    });
    tracker.applyVoice({
      kind: 'leave', guildId: 'g1', userId: 'u1', displayName: 'Ada',
      fromChannelId: 'vc1', toChannelId: null,
      fromChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      now: t0 + 120_000,
    });
    const board = tracker.hangoutLeaderboard('g1');
    assert.ok(board.rows.length >= 1);
    assert.ok(board.rows[0].minutes >= 1);
  });

  it('soft text presence expires on tick', () => {
    const logs = [];
    const tracker = new TrackerEngine({
      textWindowMs: 1000,
      log: {
        join: () => {},
        leave: () => {},
        move: () => {},
        text: (x) => logs.push(['text', x]),
        expire: (x) => logs.push(['expire', x]),
      },
    });

    const t0 = 1_000_000;
    tracker.applyTextActivity({
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Bea',
      channelId: 't1',
      channel: { id: 't1', name: 'general', type: 'text' },
      now: t0,
    });
    assert.equal(tracker.getOccupantCount('g1', 't1'), 1);

    tracker.tick(t0 + 500);
    assert.equal(tracker.getOccupantCount('g1', 't1'), 1);

    tracker.tick(t0 + 1001);
    assert.equal(tracker.getOccupantCount('g1', 't1'), 0);
    assert.equal(logs.some((l) => l[0] === 'expire'), true);
  });

  it('snapshot returns JSON-ready rooms', () => {
    const tracker = new TrackerEngine({ log: { join() {}, leave() {}, move() {}, text() {}, expire() {} } });
    tracker.applyVoice({
      kind: 'join',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: null,
      toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      silent: true,
    });
    const snap = tracker.snapshot('g1');
    assert.equal(snap.guildId, 'g1');
    assert.equal(snap.rooms.length, 1);
    assert.equal(snap.rooms[0].occupantCount, 1);
    assert.deepEqual(snap.members[0].userId, 'u1');
  });
});
