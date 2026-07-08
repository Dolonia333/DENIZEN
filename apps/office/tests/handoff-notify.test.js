'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const denizenDb = require('../src/intelligence/denizen-db.js');
const {
  getPendingHandoffs,
  buildLucyHandoffAlertBroadcast,
} = require('../src/visitors/denizen-visitor.js');

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SESSION_ID = '99999999-9999-9999-9999-999999999999';
const HANDOFF_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('handoff notify', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    denizenDb.enabled = true;
    denizenDb.orgId = ORG_ID;
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method });

      if (url.includes('denizen_assistant_messages') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: HANDOFF_ID,
            from_session_id: OTHER_SESSION_ID,
            to_session_id: SESSION_ID,
            from_npc: 'bob',
            to_npc: 'assistant',
            message: 'Please review the deck before the meeting',
            status: 'pending',
            created_at: '2026-06-06T01:00:00.000Z',
          }],
        };
      }

      if (url.includes('denizen_visitor_sessions') && url.includes(`id=eq.${OTHER_SESSION_ID}`)) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: OTHER_SESSION_ID,
            display_name: 'Jake',
            created_at: '2026-06-06T00:00:00.000Z',
            last_seen_at: '2026-06-06T00:00:00.000Z',
            metadata: {},
          }],
        };
      }

      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => [],
      };
    };
  });

  it('getPendingHandoffs enriches rows with from_display_name and message', async () => {
    const handoffs = await getPendingHandoffs(SESSION_ID);
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].from_display_name, 'Jake');
    assert.equal(handoffs[0].message, 'Please review the deck before the meeting');
    assert.equal(handoffs[0].id, HANDOFF_ID);
  });

  it('buildLucyHandoffAlertBroadcast includes full handoff for WS clients', () => {
    const handoff = {
      id: HANDOFF_ID,
      from_display_name: 'Jake',
      message: 'Please review the deck before the meeting',
      status: 'pending',
    };
    const payload = buildLucyHandoffAlertBroadcast(handoff, 1717632000000);
    assert.equal(payload.type, 'lucy_handoff_alert');
    assert.equal(payload.ts, 1717632000000);
    assert.equal(payload.handoff.from_display_name, 'Jake');
    assert.equal(payload.handoff.message, 'Please review the deck before the meeting');
    assert.equal(payload.handoff.id, HANDOFF_ID);

    const json = JSON.parse(JSON.stringify(payload));
    assert.equal(json.handoff.message, handoff.message);
    assert.equal(json.handoff.from_display_name, handoff.from_display_name);
  });
});
