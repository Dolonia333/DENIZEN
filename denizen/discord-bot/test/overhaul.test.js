'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { TrackerEngine, isoWeekKey } = require('../src/tracker');
const { HangoutStore } = require('../src/hangout-store');
const { ConfigStore } = require('../src/core/config-store');
const { parseGiveawayArgs, rankWhoKnows } = require('../src/modules/community/giveaway-util');

describe('hangout persist', () => {
  it('survives tracker restart via HangoutStore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-hang-'));
    const store = new HangoutStore({ dir });
    const silent = { join: () => {}, leave: () => {}, move: () => {}, text: () => {}, expire: () => {} };
    const t1 = new TrackerEngine({ hangoutStore: store, log: silent });
    const t0 = Date.now() - 120_000;
    t1.applyVoice({
      kind: 'join',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: null,
      toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      now: t0,
      silent: true,
    });
    t1.applyVoice({
      kind: 'leave',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: 'vc1',
      toChannelId: null,
      fromChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      now: t0 + 120_000,
      silent: true,
    });
    store.flush('g1');

    const t2 = new TrackerEngine({ hangoutStore: new HangoutStore({ dir }), log: silent });
    t2._ensureMember('g1', 'u1', 'Ada');
    const board = t2.hangoutLeaderboard('g1');
    assert.equal(board.week, isoWeekKey());
    assert.ok(board.rows.length >= 1);
    assert.ok(board.rows[0].ms >= 100_000);
  });
});

describe('config-store atomic + quarantine', () => {
  it('writes via temp rename and quarantines corrupt files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cfg-'));
    const store = new ConfigStore({ dir });
    store.update('g1', (c) => {
      c.hangout.enabled = true;
      c.hangout.channelId = 'ch1';
      return c;
    });
    const file = path.join(dir, 'g1.json');
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.hangout.enabled, true);
    assert.equal(parsed.hangout.channelId, 'ch1');

    fs.writeFileSync(file, '{not-json', 'utf8');
    const store2 = new ConfigStore({ dir });
    const cfg = store2.get('g1');
    assert.equal(cfg.hangout.enabled, false); // defaults after quarantine
    const corrupt = fs.readdirSync(dir).filter((f) => f.includes('.corrupt.'));
    assert.ok(corrupt.length >= 1);
  });
});

describe('giveaway util + WhoKnows rank', () => {
  it('parses winners and duration', () => {
    const a = parseGiveawayArgs(['2', '30m', 'nitro', 'boost']);
    assert.equal(a.winners, 2);
    assert.equal(a.durationMs, 30 * 60_000);
    assert.deepEqual(a.prizeParts, ['nitro', 'boost']);
  });

  it('ranks WhoKnows by plays', () => {
    const ranked = rankWhoKnows([
      { discordId: '1', plays: 3 },
      { discordId: '2', plays: 40 },
      { discordId: '3', plays: 0 },
    ]);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].discordId, '2');
  });
});

describe('presence boosted + hangoutTop shape', () => {
  it('snapshot includes boosted and hangoutMs', () => {
    const silent = { join: () => {}, leave: () => {}, move: () => {}, text: () => {}, expire: () => {} };
    const tracker = new TrackerEngine({ log: silent });
    tracker.applyVoice({
      kind: 'join',
      guildId: 'g1',
      userId: 'u1',
      displayName: 'Ada',
      fromChannelId: null,
      toChannelId: 'vc1',
      toChannel: { id: 'vc1', name: 'Lounge', type: 'voice' },
      boosted: true,
      silent: true,
    });
    const snap = tracker.snapshot('g1');
    const m = snap.members.find((x) => x.userId === 'u1');
    assert.equal(m.boosted, true);
    const board = tracker.hangoutLeaderboard('g1', { limit: 5 });
    assert.ok(Array.isArray(board.rows));
  });
});
