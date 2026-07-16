'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CEO_OFFICE_ID,
  resolveOfficeFromSession,
  shouldDeliverToSocket,
  attachOfficeId,
  ensurePresenceKey,
  listPlayersInOffice,
  upsertPlayerPose,
  removePlayerFromOffice,
  ensureSimHost,
  clearSimHostIf,
  _resetMultiplayerStateForTests,
} = require('../src/visitor-office-registry.js');

describe('visitor-office-registry', () => {
  it('provides the multiplayer registry methods required by server.js', () => {
    _resetMultiplayerStateForTests();
    const ws = {
      readyState: 1,
      _denizenSessionId: 'session-a',
      _denizenOfficeId: 'office-a',
      _denizenJoinedAt: 1,
    };
    const key = ensurePresenceKey(ws);
    assert.equal(key, 'sess:session-a');

    const stored = upsertPlayerPose('office-a', {
      sessionId: key,
      displayName: 'A',
      x: 12,
      y: 34,
    }, { force: true });
    assert.equal(stored.ok, true);
    assert.equal(listPlayersInOffice('office-a').length, 1);

    const elected = ensureSimHost('office-a', new Set([ws]));
    assert.equal(elected.host.presenceKey, key);
    const cleared = clearSimHostIf(key, 'office-a', new Set());
    assert.equal(cleared.host, null);

    assert.equal(removePlayerFromOffice('office-a', key).sessionId, key);
    assert.deepEqual(listPlayersInOffice('office-a'), []);
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

  it('attachOfficeId adds office_id to payload', () => {
    const out = attachOfficeId({ type: 'npc_decision' }, 'id-x');
    assert.equal(out.office_id, 'id-x');
  });
});
