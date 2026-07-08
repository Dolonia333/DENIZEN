'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const denizenDb = require('../src/denizen-db.js');
const {
  createOrUpdateSession,
  claimAssistant,
  releaseAssistant,
  getAssistant,
  ensureOrgMembership,
  sendHandoff,
  getPendingHandoffs,
  listProjects,
  listTeammates,
  getOrgContext,
  getOrCreateCeoBridgeSession,
  listOrganizations,
  resolveOrgBySlug,
  VisitorError,
} = require('../src/denizen-visitor.js');

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACME_ORG_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSISTANT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CEO_BRIDGE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const HANDOFF_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PROJECT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const OTHER_SESSION_ID = '99999999-9999-9999-9999-999999999999';

function npcRow(key, { protected: prot = false, claimable = true } = {}) {
  return {
    npc_key: key,
    display_name: key.charAt(0).toUpperCase() + key.slice(1),
    protected: prot,
    claimable,
  };
}

describe('denizen-visitor', () => {
  let calls;
  let hasAssistant;

  beforeEach(() => {
    calls = [];
    hasAssistant = false;
    denizenDb.enabled = true;
    denizenDb.orgId = ORG_ID;
    denizenDb.orgSlug = 'zion';
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });

      if (url.includes('denizen_visitor_sessions') && method === 'PATCH') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [],
        };
      }

      if (url.includes('denizen_org_members') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [],
        };
      }

      if (url.includes('denizen_org_members') && method === 'POST') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => null,
        };
      }

      if (url.includes('denizen_organizations') && method === 'GET' && url.includes('order=display_name')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [
            { id: ACME_ORG_ID, slug: 'acme', display_name: 'Acme Corp (Demo)' },
            { id: ORG_ID, slug: 'zion', display_name: 'Zion / Default Org' },
          ],
        };
      }

      if (url.includes('denizen_organizations') && method === 'GET' && url.includes('slug=eq.acme')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: ACME_ORG_ID,
            slug: 'acme',
            display_name: 'Acme Corp (Demo)',
            plan: 'trial',
            settings: { demo: true },
          }],
        };
      }

      if (url.includes('metadata->>bridge=eq.ceo')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [],
        };
      }

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
            message: 'Please review the deck',
            status: 'pending',
            created_at: '2026-06-06T01:00:00.000Z',
          }],
        };
      }

      if (url.includes('denizen_assistant_messages') && method === 'POST') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: HANDOFF_ID,
            from_session_id: body.from_session_id,
            to_session_id: body.to_session_id,
            from_npc: body.from_npc,
            to_npc: body.to_npc,
            message: body.message,
            status: 'pending',
            metadata: body.metadata,
          }],
        };
      }

      if (url.includes('denizen_user_projects') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: PROJECT_ID,
            session_id: SESSION_ID,
            name: 'Launch site',
            status: 'active',
            priority: 'high',
            notes: null,
          }],
        };
      }

      if (url.includes('denizen_visitor_sessions') && method === 'POST') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: body.metadata?.bridge === 'ceo' ? CEO_BRIDGE_ID : (body.id || SESSION_ID),
            display_name: body.display_name,
            created_at: '2026-06-06T00:00:00.000Z',
            last_seen_at: body.last_seen_at,
            metadata: body.metadata,
            org_id: body.org_id,
          }],
        };
      }

      if (url.includes('denizen_npcs') && url.includes('npc_key=eq.lucy')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [npcRow('lucy', { protected: true, claimable: false })],
        };
      }

      if (url.includes('denizen_npcs') && url.includes('npc_key=eq.bob')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [npcRow('bob')],
        };
      }

      if (url.includes('denizen_visitor_sessions') && method === 'GET' && url.includes('select=metadata')) {
        if (url.includes('cccccccc-cccc-cccc-cccc-cccccccccccc')) {
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => [],
          };
        }
      }

      if (url.includes('denizen_visitor_sessions') && url.includes(`id=eq.${SESSION_ID}`)) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: SESSION_ID,
            display_name: 'Teammate',
            org_id: ORG_ID,
            created_at: '2026-06-06T00:00:00.000Z',
            last_seen_at: '2026-06-06T00:00:00.000Z',
            metadata: {},
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

      if (url.includes('denizen_user_assistants?select=id,npc_key') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => (hasAssistant ? [{ id: ASSISTANT_ID, npc_key: 'bob' }] : []),
        };
      }

      if (url.includes('denizen_user_assistants?select=id') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => (hasAssistant ? [{ id: ASSISTANT_ID }] : []),
        };
      }

      if (url.includes('denizen_user_assistants') && method === 'DELETE') {
        hasAssistant = false;
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => null,
        };
      }

      if (url.includes('denizen_user_assistants') && method === 'POST') {
        hasAssistant = true;
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: ASSISTANT_ID,
            session_id: body.session_id,
            npc_key: body.npc_key,
            assistant_name: body.assistant_name,
            focus: body.focus,
            role_overlay: body.role_overlay,
            claimed_at: body.claimed_at,
          }],
        };
      }

      if (url.includes('denizen_visitor_sessions') && url.includes('denizen_user_assistants!inner')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: OTHER_SESSION_ID,
            display_name: 'Jake',
            denizen_user_assistants: {
              npc_key: 'bob',
              assistant_name: 'Research Buddy',
              denizen_npcs: npcRow('bob'),
            },
          }],
        };
      }

      if (url.includes('denizen_user_assistants?select=') && method === 'GET' && url.includes('denizen_npcs')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => (hasAssistant ? [{
            npc_key: 'bob',
            assistant_name: 'Research Buddy',
            focus: 'papers',
            role_overlay: null,
            claimed_at: '2026-06-06T00:00:00.000Z',
            denizen_npcs: npcRow('bob'),
          }] : []),
        };
      }

      if (url.includes('rpc/denizen_record_fact')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => 'fact-id',
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => 'not found',
      };
    };
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('createOrUpdateSession creates new session', async () => {
    const session = await createOrUpdateSession({ displayName: 'Teammate', orgId: ORG_ID });
    assert.equal(session.id, SESSION_ID);
    assert.equal(session.display_name, 'Teammate');

    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_visitor_sessions'));
    assert.ok(postCall, 'POST denizen_visitor_sessions');
    assert.equal(postCall.body.display_name, 'Teammate');
  });

  it('createOrUpdateSession upserts when browser UUID is new', async () => {
    const freshId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const session = await createOrUpdateSession({ sessionId: freshId, displayName: 'Jake' });
    assert.equal(session.id, freshId);
    assert.equal(session.display_name, 'Jake');

    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('denizen_visitor_sessions'));
    assert.ok(patchCall, 'PATCH attempted first');
    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_visitor_sessions'));
    assert.ok(postCall, 'POST with explicit id when PATCH missed');
    assert.equal(postCall.body.id, freshId);
  });

  it('claimAssistant rejects lucy (protected)', async () => {
    await assert.rejects(
      () => claimAssistant({ sessionId: SESSION_ID, npcKey: 'Lucy' }),
      (err) => {
        assert.ok(err instanceof VisitorError);
        assert.equal(err.code, 'PROTECTED');
        return true;
      },
    );

    const claimPost = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_user_assistants'));
    assert.equal(claimPost, undefined, 'no assistant row written for protected NPC');
  });

  it('claimAssistant succeeds for bob', async () => {
    const assistant = await claimAssistant({
      sessionId: SESSION_ID,
      npcKey: 'Bob',
      assistantName: 'Research Buddy',
      focus: 'papers',
    });

    assert.equal(assistant.npc_key, 'bob');
    assert.equal(assistant.display_name, 'Bob');
    assert.equal(assistant.assistant_name, 'Research Buddy');
    assert.equal(assistant.focus, 'papers');

    const claimPost = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_user_assistants'));
    assert.ok(claimPost);
    assert.equal(claimPost.body.npc_key, 'bob');

    const factCall = calls.find((c) => c.url.includes('denizen_record_fact'));
    assert.ok(factCall, 'claim fact recorded');
    assert.equal(factCall.body.p_fact_type, 'visitor.assistant.claimed');
  });

  it('getAssistant returns claimed NPC', async () => {
    await claimAssistant({
      sessionId: SESSION_ID,
      npcKey: 'Bob',
      assistantName: 'Research Buddy',
      focus: 'papers',
    });
    const assistant = await getAssistant(SESSION_ID);
    assert.ok(assistant);
    assert.equal(assistant.npc_key, 'bob');
    assert.equal(assistant.display_name, 'Bob');
    assert.equal(assistant.assistant_name, 'Research Buddy');
    assert.equal(assistant.focus, 'papers');
  });

  it('releaseAssistant removes claimed NPC and is idempotent', async () => {
    await claimAssistant({
      sessionId: SESSION_ID,
      npcKey: 'Bob',
      assistantName: 'Research Buddy',
    });
    const released = await releaseAssistant(SESSION_ID);
    assert.equal(released.released, true);
    assert.equal(released.npc_key, 'bob');

    const deleteCall = calls.find(
      (c) => c.method === 'DELETE' && c.url.includes('denizen_user_assistants'),
    );
    assert.ok(deleteCall, 'assistant row deleted');

    const again = await releaseAssistant(SESSION_ID);
    assert.equal(again.released, false);
    assert.equal(again.npc_key, null);

    const assistant = await getAssistant(SESSION_ID);
    assert.equal(assistant, null);
  });

  it('ensureOrgMembership patches session org_id and posts org member', async () => {
    await ensureOrgMembership(SESSION_ID, 'Teammate', ORG_ID);

    const sessionPatch = calls.find(
      (c) => c.method === 'PATCH' && c.url.includes('denizen_visitor_sessions') && c.body.org_id === ORG_ID,
    );
    assert.ok(sessionPatch, 'session org_id patched');

    const memberPost = calls.find(
      (c) => c.method === 'POST' && c.url.includes('denizen_org_members'),
    );
    assert.ok(memberPost, 'org member created');
    assert.equal(memberPost.body.org_id, ORG_ID);
    assert.equal(memberPost.body.member_type, 'visitor_session');
    assert.equal(memberPost.body.member_id, SESSION_ID);
    assert.equal(memberPost.body.role, 'member');
  });

  it('getOrgContext returns org from denizenDb', () => {
    const ctx = getOrgContext();
    assert.equal(ctx.orgId, ORG_ID);
    assert.equal(ctx.orgSlug, 'zion');
  });

  it('listOrganizations returns rows', async () => {
    const orgs = await listOrganizations();
    assert.equal(orgs.length, 2);
    assert.equal(orgs[0].slug, 'acme');
    assert.equal(orgs[0].display_name, 'Acme Corp (Demo)');
    assert.equal(orgs[1].slug, 'zion');

    const getCall = calls.find(
      (c) => c.method === 'GET' && c.url.includes('denizen_organizations') && c.url.includes('order=display_name'),
    );
    assert.ok(getCall, 'list orgs query issued');
  });

  it('resolveOrgBySlug finds acme', async () => {
    const org = await resolveOrgBySlug('acme');
    assert.ok(org);
    assert.equal(org.id, ACME_ORG_ID);
    assert.equal(org.slug, 'acme');
    assert.equal(org.display_name, 'Acme Corp (Demo)');
    assert.equal(org.plan, 'trial');

    const getCall = calls.find(
      (c) => c.method === 'GET' && c.url.includes('denizen_organizations') && c.url.includes('slug=eq.acme'),
    );
    assert.ok(getCall, 'resolve org query issued');
  });

  it('ensureOrgMembership accepts orgId override', async () => {
    await ensureOrgMembership(SESSION_ID, 'Teammate', ACME_ORG_ID);

    const sessionPatch = calls.find(
      (c) => c.method === 'PATCH' && c.url.includes('denizen_visitor_sessions') && c.body.org_id === ACME_ORG_ID,
    );
    assert.ok(sessionPatch, 'session org_id patched with override');

    const memberPost = calls.find(
      (c) => c.method === 'POST' && c.url.includes('denizen_org_members') && c.body.org_id === ACME_ORG_ID,
    );
    assert.ok(memberPost, 'org member created with override org');
  });

  it('listTeammates filters by org_id', async () => {
    const teammates = await listTeammates(SESSION_ID);
    assert.equal(teammates.length, 1);
    assert.equal(teammates[0].session_id, OTHER_SESSION_ID);
    assert.equal(teammates[0].display_name, 'Jake');

    const getCall = calls.find(
      (c) => c.method === 'GET' && c.url.includes('denizen_visitor_sessions') && c.url.includes('denizen_user_assistants'),
    );
    assert.ok(getCall, 'teammates query issued');
    assert.match(getCall.url, new RegExp(`org_id=eq\\.${ORG_ID}`));
    assert.match(getCall.url, new RegExp(`id=neq\\.${SESSION_ID}`));
  });

  it('sendHandoff posts assistant message', async () => {
    const handoff = await sendHandoff({
      fromSessionId: SESSION_ID,
      toSessionId: OTHER_SESSION_ID,
      fromNpc: 'bob',
      toNpc: 'assistant',
      message: 'Please review the deck',
    });

    assert.equal(handoff.id, HANDOFF_ID);
    assert.equal(handoff.message, 'Please review the deck');

    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_assistant_messages'));
    assert.ok(postCall);
    assert.equal(postCall.body.from_session_id, SESSION_ID);
    assert.equal(postCall.body.to_session_id, OTHER_SESSION_ID);
    assert.equal(postCall.body.status, 'pending');

    const factCall = calls.find((c) => c.url.includes('denizen_record_fact'));
    assert.ok(factCall, 'handoff fact recorded');
    assert.equal(factCall.body.p_fact_type, 'visitor.handoff.sent');
  });

  it('getPendingHandoffs returns pending messages for session', async () => {
    const handoffs = await getPendingHandoffs(SESSION_ID);
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].id, HANDOFF_ID);
    assert.equal(handoffs[0].status, 'pending');
    assert.equal(handoffs[0].from_display_name, 'Jake');

    const getCall = calls.find((c) => c.method === 'GET' && c.url.includes('denizen_assistant_messages'));
    assert.ok(getCall);
    assert.match(getCall.url, /status=eq\.pending/);
    assert.match(getCall.url, /to_session_id=eq\./);
  });

  it('listProjects returns session projects', async () => {
    const projects = await listProjects(SESSION_ID);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Launch site');

    const getCall = calls.find((c) => c.method === 'GET' && c.url.includes('denizen_user_projects'));
    assert.ok(getCall);
    assert.match(getCall.url, /session_id=eq\./);
  });

  it('getOrCreateCeoBridgeSession creates CEO bridge when missing', async () => {
    const bridgeId = await getOrCreateCeoBridgeSession();
    assert.equal(bridgeId, CEO_BRIDGE_ID);

    const getCall = calls.find((c) => c.method === 'GET' && c.url.includes('metadata->>bridge=eq.ceo'));
    assert.ok(getCall, 'searched for existing bridge');
    const postCall = calls.find(
      (c) => c.method === 'POST' && c.url.includes('denizen_visitor_sessions') && c.body.metadata?.bridge === 'ceo',
    );
    assert.ok(postCall, 'created CEO bridge session');
    assert.equal(postCall.body.display_name, 'CEO Office');
    assert.equal(postCall.body.org_id, ORG_ID);
  });
});
