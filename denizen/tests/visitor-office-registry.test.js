'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  CEO_OFFICE_ID,
  resolveOfficeFromSession,
  shouldDeliverToSocket,
  attachOfficeId,
  upsertPlayerPose,
  removePlayerFromOffice,
  listPlayersInOffice,
  ensureSimHost,
  clearSimHostIf,
  getSimHost,
  _resetMultiplayerStateForTests,
  POSE_MIN_INTERVAL_MS,
} = require('../src/visitor-office-registry.js');

describe('visitor-office-registry', () => {
  beforeEach(() => {
    _resetMultiplayerStateForTests();
  });

  it('ceo ws without session maps to ceo-operator office', () => {
    const o = resolveOfficeFromSession(null, { isCeoWs: true });
    assert.equal(o.officeId, CEO_OFFICE_ID);
    assert.equal(o.isOperatorOffice, true);
  });

  it('identity session maps office_id to identity_id', () => {
    const o = resolveOfficeFromSession({
      id: 'sess-1',
      identity_id: 'id-abc',
      metadata: {},
    });
    assert.equal(o.officeId, 'id-abc');
    assert.equal(o.isOperatorOffice, false);
  });

  it('shouldDeliverToSocket filters office-scoped npc_decision', () => {
    const ws = { readyState: 1, _denizenOfficeId: 'id-a' };
    assert.equal(shouldDeliverToSocket({ type: 'npc_decision', office_id: 'id-a' }, ws), true);
    assert.equal(shouldDeliverToSocket({ type: 'npc_decision', office_id: 'id-b' }, ws), false);
    assert.equal(shouldDeliverToSocket({ type: 'threat', office_id: 'id-b' }, ws), true);
  });

  it('shouldDeliverToSocket filters player_pose by office', () => {
    const ws = { readyState: 1, _denizenOfficeId: 'office-1' };
    assert.equal(shouldDeliverToSocket({ type: 'player_pose', office_id: 'office-1' }, ws), true);
    assert.equal(shouldDeliverToSocket({ type: 'player_pose', office_id: 'office-2' }, ws), false);
  });

  it('attachOfficeId adds office_id to payload', () => {
    const out = attachOfficeId({ type: 'npc_decision' }, 'id-x');
    assert.equal(out.office_id, 'id-x');
  });

  it('upsertPlayerPose stores and lists players', () => {
    const a = upsertPlayerPose('office-a', {
      sessionId: 'sess:a',
      displayName: 'Ada',
      x: 10,
      y: 20,
      facing: 'left',
    }, { force: true });
    assert.equal(a.ok, true);
    const b = upsertPlayerPose('office-a', {
      sessionId: 'sess:b',
      displayName: 'Bob',
      x: 30,
      y: 40,
    }, { force: true });
    assert.equal(b.ok, true);
    const list = listPlayersInOffice('office-a');
    assert.equal(list.length, 2);
    assert.ok(list.some((p) => p.displayName === 'Ada' && p.x === 10));
  });

  it('upsertPlayerPose throttles rapid updates', () => {
    const first = upsertPlayerPose('office-t', {
      sessionId: 'sess:t',
      x: 1,
      y: 1,
    }, { force: true });
    assert.equal(first.ok, true);
    const second = upsertPlayerPose('office-t', {
      sessionId: 'sess:t',
      x: 2,
      y: 2,
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'throttled');
    assert.ok(POSE_MIN_INTERVAL_MS >= 50);
  });

  it('removePlayerFromOffice clears presence', () => {
    upsertPlayerPose('office-r', { sessionId: 'sess:r', x: 1, y: 1 }, { force: true });
    const removed = removePlayerFromOffice('office-r', 'sess:r');
    assert.equal(removed.sessionId, 'sess:r');
    assert.equal(listPlayersInOffice('office-r').length, 0);
  });

  it('ensurePresenceKey migrates anon to sess and drops ghost pose', () => {
    const {
      ensurePresenceKey,
      upsertPlayerPose,
      listPlayersInOffice,
      _resetMultiplayerStateForTests: reset,
    } = require('../src/visitor-office-registry.js');
    reset();
    const ws = {
      readyState: 1,
      _denizenOfficeId: 'office-m',
      _denizenSessionId: null,
    };
    const anon = ensurePresenceKey(ws);
    assert.ok(anon.startsWith('anon:'));
    upsertPlayerPose('office-m', {
      sessionId: anon,
      displayName: 'Dulumia',
      x: 10,
      y: 20,
    }, { force: true });
    assert.equal(listPlayersInOffice('office-m').length, 1);

    ws._denizenSessionId = 'real-sess';
    const sess = ensurePresenceKey(ws);
    assert.equal(sess, 'sess:real-sess');
    assert.equal(listPlayersInOffice('office-m').length, 0);
    assert.equal(ws._denizenPresenceKeyMigrated.from, anon);
  });

  it('ensureSimHost elects interactive client and failovers', () => {
    const clients = new Set();
    const mk = (key, office, opts = {}) => ({
      readyState: 1,
      _denizenOfficeId: office,
      _denizenPresenceKey: key,
      _denizenSessionId: key.startsWith('sess:') ? key.slice(5) : null,
      _denizenJoinedAt: opts.joinedAt || Date.now(),
      _denizenSpectator: !!opts.spectator,
      _denizenDemoMode: !!opts.demo,
      _denizenInteractive: opts.interactive !== false,
    });
    const a = mk('sess:a', 'office-h', { joinedAt: 100 });
    const b = mk('sess:b', 'office-h', { joinedAt: 200 });
    const spec = mk('sess:s', 'office-h', { joinedAt: 50, spectator: true });
    clients.add(a);
    clients.add(b);
    clients.add(spec);

    const first = ensureSimHost('office-h', clients);
    assert.equal(first.host.presenceKey, 'sess:a');
    assert.equal(getSimHost('office-h').presenceKey, 'sess:a');

    clients.delete(a);
    const fail = clearSimHostIf('sess:a', 'office-h', clients);
    assert.equal(fail.host.presenceKey, 'sess:b');
    assert.equal(fail.message.type, 'sim_host');
    assert.equal(fail.message.sessionId, 'sess:b');
  });
});
