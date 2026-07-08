'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const denizenDb = require('../src/intelligence/denizen-db.js');
const {
  requestConnection,
  respondConnection,
  listConnections,
  canMessage,
} = require('../src/visitors/visitor-connections.js');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_A = '33333333-3333-4333-8333-333333333333';
const ID_B = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

const sessions = {
  [SESSION_A]: {
    id: SESSION_A,
    display_name: 'Ari',
    org_id: ORG_A,
    identity_id: ID_A,
    last_seen_at: '2026-06-16T12:00:00.000Z',
    metadata: {},
  },
  [SESSION_B]: {
    id: SESSION_B,
    display_name: 'Blair',
    org_id: ORG_B,
    identity_id: ID_B,
    last_seen_at: '2026-06-16T12:01:00.000Z',
    metadata: {},
  },
};

const identities = {
  [ID_A]: {
    id: ID_A,
    email: 'ari@example.com',
    email_normalized: 'ari@example.com',
    display_name: 'Ari',
    org_id: ORG_A,
    primary_session_id: SESSION_A,
    tier: 'team',
  },
  [ID_B]: {
    id: ID_B,
    email: 'blair@example.com',
    email_normalized: 'blair@example.com',
    display_name: 'Blair',
    org_id: ORG_B,
    primary_session_id: SESSION_B,
    tier: 'team',
  },
};

function jsonResponse(value, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => value,
    text: async () => JSON.stringify(value),
  };
}

describe('visitor-connections', () => {
  let calls;
  let connections;

  beforeEach(() => {
    calls = [];
    connections = [];
    denizenDb.enabled = true;
    denizenDb.orgId = ORG_A;
    denizenDb.orgSlug = 'zion';
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      const raw = String(url);
      calls.push({ url: raw, method, body });

      if (raw.includes('rpc/denizen_record_fact')) {
        return jsonResponse('fact-id');
      }

      if (raw.includes('denizen_visitor_sessions') && method === 'GET') {
        const byId = Object.values(sessions).find((s) => raw.includes(`id=eq.${s.id}`));
        if (byId) return jsonResponse([byId]);
        const byIdentity = Object.values(sessions).find((s) => raw.includes(`identity_id=eq.${s.identity_id}`));
        if (byIdentity) return jsonResponse([byIdentity]);
        return jsonResponse([]);
      }

      if (raw.includes('denizen_user_identities') && method === 'GET') {
        const byId = Object.values(identities).find((i) => raw.includes(`id=eq.${i.id}`));
        if (byId) return jsonResponse([byId]);
        const byEmail = Object.values(identities).find((i) => raw.includes(`email_normalized=eq.${encodeURIComponent(i.email_normalized)}`));
        if (byEmail) return jsonResponse([byEmail]);
        return jsonResponse([]);
      }

      if (raw.includes('denizen_user_assistants') && method === 'GET') {
        if (raw.includes(`session_id=eq.${SESSION_B}`)) {
          return jsonResponse([{
            npc_key: 'bob',
            assistant_name: 'Blair Assistant',
            denizen_npcs: { npc_key: 'bob', display_name: 'Bob' },
          }]);
        }
        return jsonResponse([]);
      }

      if (raw.includes('denizen_visitor_connections') && method === 'GET') {
        if (/[?&]id=eq\./.test(raw)) {
          const found = connections.find((c) => raw.includes(`id=eq.${c.id}`));
          return jsonResponse(found ? [found] : []);
        }
        if (raw.includes('requester_identity_id=eq.') && raw.includes('recipient_identity_id=eq.')) {
          const found = connections.filter((c) =>
            raw.includes(`requester_identity_id=eq.${c.requester_identity_id}`)
            && raw.includes(`recipient_identity_id=eq.${c.recipient_identity_id}`));
          return jsonResponse(found);
        }
        if (raw.includes('or=')) {
          const id = raw.includes(ID_A) ? ID_A : (raw.includes(ID_B) ? ID_B : null);
          return jsonResponse(connections.filter((c) =>
            c.requester_identity_id === id || c.recipient_identity_id === id));
        }
        return jsonResponse([]);
      }

      if (raw.includes('denizen_visitor_connections') && method === 'POST') {
        const now = '2026-06-16T12:02:00.000Z';
        const row = {
          id: CONNECTION_ID,
          created_at: now,
          updated_at: body.updated_at || now,
          accepted_at: null,
          metadata: {},
          ...body,
        };
        connections.push(row);
        return jsonResponse([row]);
      }

      if (raw.includes('denizen_visitor_connections') && method === 'PATCH') {
        const row = connections.find((c) => raw.includes(`id=eq.${c.id}`));
        if (!row) return jsonResponse([], false, 404);
        Object.assign(row, body);
        return jsonResponse([row]);
      }

      return jsonResponse({ error: 'not found' }, false, 404);
    };
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('creates request and exposes outgoing/incoming views', async () => {
    const requested = await requestConnection({
      fromSessionId: SESSION_A,
      targetEmail: '  Blair@Example.com ',
      message: 'Question for your team',
    });

    assert.equal(requested.status, 'pending');
    assert.equal(requested.direction, 'outgoing');
    assert.equal(requested.other_identity_id, ID_B);
    assert.equal(requested.target_session_id, SESSION_B);

    const mine = await listConnections(SESSION_A);
    assert.equal(mine.outgoing.length, 1);
    assert.equal(mine.incoming.length, 0);

    const theirs = await listConnections(SESSION_B);
    assert.equal(theirs.incoming.length, 1);
    assert.equal(theirs.incoming[0].request_message, 'Question for your team');
  });

  it('requires an accepted connection before cross-team messaging', async () => {
    assert.equal(await canMessage({ fromSessionId: SESSION_A, toSessionId: SESSION_B }), false);

    await requestConnection({
      fromSessionId: SESSION_A,
      targetEmail: 'blair@example.com',
      message: 'Can our assistants talk?',
    });

    const accepted = await respondConnection({
      sessionId: SESSION_B,
      connectionId: CONNECTION_ID,
      action: 'accept',
    });

    assert.equal(accepted.status, 'accepted');
    assert.equal(await canMessage({ fromSessionId: SESSION_A, toSessionId: SESSION_B }), true);

    const mine = await listConnections(SESSION_A);
    assert.equal(mine.connections.length, 1);
    assert.equal(mine.connections[0].can_message, true);
  });
});
