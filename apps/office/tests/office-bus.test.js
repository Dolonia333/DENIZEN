'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const officeBus = require('../src/office-bus.js');

describe('office-bus', () => {
  it('sendOfficeBusMessage requires connection before cross-team messaging', async () => {
    const visitor = {
      getSession: async (id) => ({
        id,
        display_name: id === 'from' ? 'Sender' : 'Target',
        identity_id: id === 'from' ? 'identity-a' : 'identity-b',
        org_id: null,
      }),
      getAssistant: async (id) => ({
        npc_key: 'bob',
        assistant_name: 'Bob',
      }),
      sendHandoff: async () => ({ id: 'handoff-1' }),
    };
    const visitorConnections = {
      assertCanMessage: async () => {
        const err = new Error('connection required');
        err.code = 'CONNECTION_REQUIRED';
        throw err;
      },
    };

    await assert.rejects(
      () => officeBus.sendOfficeBusMessage({
        fromSessionId: 'from',
        toSessionId: 'target',
        message: 'Hello',
      }, { denizenVisitor: visitor, visitorConnections }),
      /connection required/i,
    );
  });

  it('sendOfficeBusMessage delegates to visitor handoff when allowed', async () => {
    let handoffPayload = null;
    const visitor = {
      getSession: async (id) => ({
        id,
        display_name: 'Sender',
        identity_id: 'identity-a',
        org_id: 'org-1',
      }),
      getAssistant: async () => ({ npc_key: 'bob', assistant_name: 'Bob' }),
      sendHandoff: async (payload) => {
        handoffPayload = payload;
        return { id: 'handoff-2', ...payload };
      },
    };
    const visitorConnections = {
      assertCanMessage: async () => true,
    };

    const result = await officeBus.sendOfficeBusMessage({
      fromSessionId: 'from',
      toSessionId: 'target',
      message: 'Sync up',
      intent: 'sync',
    }, { denizenVisitor: visitor, visitorConnections });

    assert.equal(result.id, 'handoff-2');
    assert.equal(handoffPayload.toSessionId, 'target');
    assert.equal(handoffPayload.metadata.office_bus, true);
    assert.equal(handoffPayload.metadata.intent, 'sync');
  });
});
