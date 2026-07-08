'use strict';

const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const origHome = process.env.HOME;
const origUser = process.env.USERPROFILE;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-visitor-flow-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const denizenDb = require('../src/denizen-db.js');
const NpcBrainManager = require('../src/npc-brains.js');
const {
  createOrUpdateSession,
  claimAssistant,
  addProject,
  sendHandoff,
  getPendingHandoffs,
  markHandoffDelivered,
  resolveHandoffTarget,
  listTeammates,
  listProjects,
} = require('../src/denizen-visitor.js');

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SESSION_ID = '99999999-9999-9999-9999-999999999999';
const ASSISTANT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CEO_BRIDGE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PROJECT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function npcRow(key, { protected: prot = false, claimable = true } = {}) {
  return {
    npc_key: key,
    display_name: key.charAt(0).toUpperCase() + key.slice(1),
    protected: prot,
    claimable,
  };
}

function eqParam(url, field) {
  const m = url.match(new RegExp(`${field}=eq\\.([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function neqParam(url, field) {
  const m = url.match(new RegExp(`${field}=neq\\.([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function createStore() {
  return {
    sessions: new Map(),
    orgMembers: [],
    assistants: new Map(),
    projects: [],
    messages: [],
    nextMsgId: 1,
  };
}

function sessionRow(store, id) {
  const s = store.sessions.get(id);
  if (!s) return null;
  return {
    id: s.id,
    display_name: s.display_name,
    created_at: s.created_at,
    last_seen_at: s.last_seen_at,
    metadata: s.metadata,
    org_id: s.org_id,
  };
}

function assistantRow(store, sessionId) {
  const a = store.assistants.get(sessionId);
  if (!a) return null;
  return {
    ...a,
    denizen_npcs: npcRow(a.npc_key),
  };
}

function jsonResponse(data) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => data,
  };
}

function installMockFetch(store, calls) {
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method, body });

    if (url.includes('rpc/denizen_record_fact')) {
      return jsonResponse('fact-id');
    }

    if (url.includes('denizen_npcs') && url.includes('npc_key=eq.bob')) {
      return jsonResponse([npcRow('bob')]);
    }

    if (url.includes('denizen_npcs') && url.includes('npc_key=eq.lucy')) {
      return jsonResponse([npcRow('lucy', { protected: true, claimable: false })]);
    }

    if (url.includes('metadata->>bridge=eq.ceo')) {
      const bridge = [...store.sessions.values()].find((s) => s.metadata?.bridge === 'ceo');
      return jsonResponse(bridge ? [{ id: bridge.id }] : []);
    }

    if (url.includes('denizen_visitor_sessions') && method === 'PATCH') {
      const id = eqParam(url, 'id');
      const existing = store.sessions.get(id);
      if (!existing) {
        return jsonResponse([]);
      }
      Object.assign(existing, body);
      if (body.org_id) existing.org_id = body.org_id;
      return jsonResponse([sessionRow(store, id)]);
    }

    if (url.includes('denizen_visitor_sessions') && method === 'POST') {
      const id = body.id || (body.metadata?.bridge === 'ceo' ? CEO_BRIDGE_ID : SESSION_ID);
      const row = {
        id,
        display_name: body.display_name || 'Guest',
        created_at: '2026-06-06T00:00:00.000Z',
        last_seen_at: body.last_seen_at || '2026-06-06T00:00:00.000Z',
        metadata: body.metadata || {},
        org_id: body.org_id || null,
      };
      store.sessions.set(id, row);
      return jsonResponse([row]);
    }

    if (url.includes('denizen_visitor_sessions') && method === 'GET' && url.includes('id=neq.')) {
      const excludeId = neqParam(url, 'id');
      const teammates = [...store.sessions.values()]
        .filter((s) => s.org_id === ORG_ID && s.id !== excludeId && store.assistants.has(s.id))
          .map((s) => {
            const asst = store.assistants.get(s.id);
            return {
              id: s.id,
              display_name: s.display_name,
              denizen_user_assistants: {
                npc_key: asst.npc_key,
                assistant_name: asst.assistant_name,
                denizen_npcs: { display_name: npcRow(asst.npc_key).display_name },
              },
            };
          });
      return jsonResponse(teammates);
    }

    if (url.includes('denizen_visitor_sessions') && method === 'GET') {
      const id = eqParam(url, 'id');
      if (id) {
        const row = sessionRow(store, id);
        return jsonResponse(row ? [row] : []);
      }
    }

    if (url.includes('denizen_org_members') && method === 'GET') {
      const memberId = eqParam(url, 'member_id');
      const hits = store.orgMembers.filter(
        (m) => m.org_id === ORG_ID && m.member_id === memberId,
      );
      return jsonResponse(hits.map((m) => ({ id: m.id })));
    }

    if (url.includes('denizen_org_members') && method === 'POST') {
      store.orgMembers.push({
        id: `org-member-${store.orgMembers.length + 1}`,
        ...body,
      });
      return jsonResponse(null);
    }

    if (url.includes('denizen_user_assistants') && method === 'GET') {
      const sessionId = eqParam(url, 'session_id');
      if (url.includes('select=id')) {
        const existing = store.assistants.get(sessionId);
        return jsonResponse(existing ? [{ id: ASSISTANT_ID }] : []);
      }
      const row = assistantRow(store, sessionId);
      return jsonResponse(row ? [row] : []);
    }

    if (url.includes('denizen_user_assistants') && method === 'POST') {
      const row = {
        id: ASSISTANT_ID,
        session_id: body.session_id,
        npc_key: body.npc_key,
        assistant_name: body.assistant_name,
        focus: body.focus,
        role_overlay: body.role_overlay,
        claimed_at: body.claimed_at,
      };
      store.assistants.set(body.session_id, row);
      return jsonResponse([row]);
    }

    if (url.includes('denizen_user_assistants') && method === 'PATCH') {
      const sessionId = eqParam(url, 'session_id');
      const existing = store.assistants.get(sessionId);
      if (!existing) return jsonResponse([]);
      Object.assign(existing, body);
      return jsonResponse([existing]);
    }

    if (url.includes('denizen_user_projects') && method === 'POST') {
      const row = {
        id: PROJECT_ID,
        session_id: body.session_id,
        name: body.name,
        status: body.status,
        priority: body.priority,
        notes: body.notes,
        created_at: '2026-06-06T00:00:00.000Z',
        updated_at: body.updated_at,
      };
      store.projects.push(row);
      return jsonResponse([row]);
    }

    if (url.includes('denizen_user_projects') && method === 'GET') {
      const sessionId = eqParam(url, 'session_id');
      const rows = store.projects.filter((p) => p.session_id === sessionId);
      return jsonResponse(rows);
    }

    if (url.includes('denizen_assistant_messages') && method === 'POST') {
      const row = {
        id: `msg-${store.nextMsgId++}`,
        from_session_id: body.from_session_id,
        to_session_id: body.to_session_id,
        from_npc: body.from_npc,
        to_npc: body.to_npc,
        message: body.message,
        status: body.status || 'pending',
        metadata: body.metadata || {},
        created_at: new Date().toISOString(),
      };
      store.messages.push(row);
      return jsonResponse([row]);
    }

    if (url.includes('denizen_assistant_messages') && method === 'GET') {
      const toSessionId = eqParam(url, 'to_session_id');
      const pending = store.messages.filter(
        (m) => m.to_session_id === toSessionId && m.status === 'pending',
      );
      return jsonResponse(pending);
    }

    if (url.includes('denizen_assistant_messages') && method === 'PATCH') {
      const msgId = eqParam(url, 'id');
      const toSessionId = eqParam(url, 'to_session_id');
      const msg = store.messages.find(
        (m) => m.id === msgId && m.to_session_id === toSessionId,
      );
      if (!msg) return jsonResponse([]);
      Object.assign(msg, body);
      return jsonResponse([msg]);
    }

    return {
      ok: false,
      status: 404,
      text: async () => `not found: ${method} ${url}`,
    };
  };
}

function seedTeammate(store, { id, displayName, npcKey, assistantName, focus }) {
  store.sessions.set(id, {
    id,
    display_name: displayName,
    created_at: '2026-06-06T00:00:00.000Z',
    last_seen_at: '2026-06-06T00:00:00.000Z',
    metadata: {},
    org_id: ORG_ID,
  });
  store.assistants.set(id, {
    id: ASSISTANT_ID,
    session_id: id,
    npc_key: npcKey,
    assistant_name: assistantName,
    focus,
    role_overlay: null,
    claimed_at: '2026-06-06T00:00:00.000Z',
  });
}

let mgr;

before(() => {
  mgr = new NpcBrainManager();
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUser === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUser;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

describe('visitor assistant integration flow', () => {
  let store;
  let calls;

  beforeEach(() => {
    store = createStore();
    calls = [];
    denizenDb.enabled = true;
    denizenDb.orgId = ORG_ID;
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';
    installMockFetch(store, calls);
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('runs full API chain from session through handoff round-trip', async () => {
    const session = await createOrUpdateSession({ displayName: 'Jordan', orgId: ORG_ID });
    assert.equal(session.id, SESSION_ID);
    assert.equal(session.display_name, 'Jordan');

    const orgMemberPost = calls.find(
      (c) => c.method === 'POST' && c.url.includes('denizen_org_members'),
    );
    assert.ok(orgMemberPost, 'ensureOrgMembership created org member');
    assert.equal(orgMemberPost.body.member_id, SESSION_ID);
    assert.equal(orgMemberPost.body.member_type, 'visitor_session');

    const sessionPatch = calls.find(
      (c) => c.method === 'PATCH'
        && c.url.includes('denizen_visitor_sessions')
        && c.body?.org_id === ORG_ID,
    );
    assert.ok(sessionPatch, 'ensureOrgMembership patched session org_id');

    const assistant = await claimAssistant({
      sessionId: SESSION_ID,
      npcKey: 'Bob',
      assistantName: 'Research Buddy',
      focus: 'papers',
    });
    assert.equal(assistant.npc_key, 'bob');
    assert.equal(assistant.assistant_name, 'Research Buddy');

    const project = await addProject(SESSION_ID, {
      name: 'Launch site',
      status: 'active',
      priority: 'high',
      notes: 'Ship by Friday',
    });
    assert.equal(project.name, 'Launch site');
    assert.equal(project.session_id, SESSION_ID);

    const ceoTarget = await resolveHandoffTarget({ toCeo: true });
    assert.equal(ceoTarget.session_id, CEO_BRIDGE_ID);
    assert.equal(ceoTarget.is_ceo_bridge, true);

    const outbound = await sendHandoff({
      fromSessionId: SESSION_ID,
      toSessionId: ceoTarget.session_id,
      fromNpc: 'bob',
      toNpc: 'lucy',
      message: 'Jordan needs deck review before Friday',
    });
    assert.equal(outbound.status, 'pending');
    assert.equal(outbound.to_session_id, CEO_BRIDGE_ID);

    const bridgeInbox = await getPendingHandoffs(CEO_BRIDGE_ID);
    assert.equal(bridgeInbox.length, 1);
    assert.equal(bridgeInbox[0].message, 'Jordan needs deck review before Friday');
    assert.equal(bridgeInbox[0].from_display_name, 'Jordan');

    const delivered = await markHandoffDelivered(bridgeInbox[0].id, CEO_BRIDGE_ID);
    assert.equal(delivered.status, 'delivered');

    const bridgePendingAfter = await getPendingHandoffs(CEO_BRIDGE_ID);
    assert.equal(bridgePendingAfter.length, 0);

    const reply = await sendHandoff({
      fromSessionId: CEO_BRIDGE_ID,
      toSessionId: SESSION_ID,
      fromNpc: 'lucy',
      toNpc: 'bob',
      message: 'Lucy will review the deck this afternoon',
    });
    assert.equal(reply.to_session_id, SESSION_ID);

    const visitorInbox = await getPendingHandoffs(SESSION_ID);
    assert.equal(visitorInbox.length, 1);
    assert.equal(visitorInbox[0].message, 'Lucy will review the deck this afternoon');

    const projects = await listProjects(SESSION_ID);
    assert.equal(projects.length, 1);

    const visitorOpts = {
      sessionId: SESSION_ID,
      displayName: 'Jordan',
      assistant,
      projects,
    };

    const profileBlock = mgr._visitorProfilePromptBlock('Bob', visitorOpts);
    assert.match(profileBlock, /Launch site \[active\]/);
    assert.match(profileBlock, /Ship by Friday/);
    assert.match(profileBlock, /papers/);

    const chat = await mgr.getPlayerResponse('Bob', 'hi', visitorOpts);
    assert.match(chat.text, /Hey Jordan/);
    assert.match(chat.text, /assistant/i);
  });

  it('listTeammates excludes self', async () => {
    seedTeammate(store, {
      id: SESSION_ID,
      displayName: 'Jordan',
      npcKey: 'bob',
      assistantName: 'Research Buddy',
      focus: 'papers',
    });
    seedTeammate(store, {
      id: OTHER_SESSION_ID,
      displayName: 'Jake',
      npcKey: 'pier',
      assistantName: 'Data Pal',
      focus: 'pipelines',
    });

    const teammates = await listTeammates(SESSION_ID);
    assert.equal(teammates.length, 1);
    assert.equal(teammates[0].session_id, OTHER_SESSION_ID);
    assert.equal(teammates[0].display_name, 'Jake');
    assert.equal(teammates[0].npc_key, 'pier');
    assert.ok(
      !teammates.some((t) => t.session_id === SESSION_ID),
      'self session excluded',
    );

    const getCall = calls.find(
      (c) => c.method === 'GET' && c.url.includes('denizen_visitor_sessions') && c.url.includes('id=neq.'),
    );
    assert.ok(getCall);
    assert.match(getCall.url, new RegExp(`id=neq\\.${SESSION_ID}`));
  });
});
