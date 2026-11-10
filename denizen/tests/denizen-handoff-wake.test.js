'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const wake = require('../src/denizen-handoff-wake.js');
const teamTools = require('../src/denizen-mcp-team-tools.js');
const mcpScopes = require('../src/denizen-mcp-scopes.js');

const SCOPE = {
  ok: true,
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: 'jenny',
  session_id: 'sess-jenny-active',
  member_id: 'mem-1',
  scopes: ['read', 'skills', 'handoff', 'office'],
};

describe('handoff wake + lifecycle', () => {
  const prevLocal = process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST;

  afterEach(() => {
    if (prevLocal === undefined) delete process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST;
    else process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST = prevLocal;
  });

  it('normalizes kinds and lifecycle mapping', () => {
    assert.equal(wake.normalizeHandoffKind('QUESTION'), 'question');
    assert.equal(wake.normalizeHandoffKind('nope'), 'fyi');
    assert.equal(wake.lifecycleFromStatus('pending'), 'sent');
    assert.equal(wake.lifecycleFromStatus('delivered'), 'read');
    assert.equal(wake.statusFromLifecycle('done'), 'done');
  });

  it('blocks private hosts unless localhost flag set', () => {
    delete process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST;
    assert.equal(wake.validateWakeUrl('https://192.168.1.1/hook').ok, false);
    assert.equal(wake.validateWakeUrl('http://localhost:8787/wake').ok, false);
    process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST = '1';
    assert.equal(wake.validateWakeUrl('http://localhost:8787/wake').ok, true);
    assert.equal(wake.validateWakeUrl('https://hooks.example.com/denizen').ok, true);
  });

  it('posts wake payload with bearer secret', async () => {
    process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST = '1';
    let seen = null;
    const result = await wake.postWakeWebhook(
      'http://127.0.0.1:9999/wake',
      wake.buildWakePayload({
        handoff: {
          id: 'h1',
          message: 'Need deck review',
          status: 'pending',
          from_session_id: 'a',
          to_session_id: 'b',
          metadata: { kind: 'task' },
        },
        fromDisplayName: 'Jake',
        kind: 'task',
      }),
      {
        secret: 'sekrit',
        fetchImpl: async (url, opts) => {
          seen = { url, opts };
          return { ok: true, status: 204 };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers.Authorization, 'Bearer sekrit');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.event, 'handoff.received');
    assert.equal(body.kind, 'task');
    assert.equal(body.handoff_id, 'h1');
    assert.equal(body.from_display_name, 'Jake');
  });

  it('notifyHandoffWake skips when no URL registered', async () => {
    const result = await wake.notifyHandoffWake({
      visitor: {
        getSession: async () => ({ id: 'sess', metadata: {} }),
      },
      toSessionId: 'sess',
      handoff: { id: 'h1', message: 'hi', status: 'pending' },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_wake_url');
  });

  it('scopes gate wake registration + complete', () => {
    assert.equal(mcpScopes.requiredScope('register_handoff_webhook'), 'handoff');
    assert.equal(mcpScopes.requiredScope('complete_handoff'), 'handoff');
    assert.equal(mcpScopes.requiredScope('get_handoff_webhook'), 'read');
    assert.equal(mcpScopes.toolAllowed(SCOPE, 'register_handoff_webhook'), true);
    assert.equal(
      mcpScopes.toolAllowed({ scopes: ['read'] }, 'register_handoff_webhook'),
      false,
    );
  });
});

describe('team tools handoff wake integration', () => {
  let wakePosts;
  let lastHandoff;
  let sessionMeta;

  beforeEach(() => {
    wakePosts = [];
    lastHandoff = null;
    sessionMeta = {
      'sess-jenny-active': {},
      'sess-other': { handoff_wake_url: 'https://hooks.example.com/jake-bot' },
    };
    process.env.DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST = '1';

    teamTools.configure({
      denizenVisitor: {
        listTeammatesWithPresence: async () => ([]),
        getSession: async (id) => ({
          id,
          display_name: id === 'sess-jenny-active' ? 'Jenny' : 'Jake',
          metadata: sessionMeta[id] || {},
        }),
        getAssistant: async () => ({ npc_key: 'jenny' }),
        sendHandoff: async (payload) => {
          lastHandoff = {
            id: 'handoff-wake-1',
            from_session_id: payload.fromSessionId,
            to_session_id: payload.toSessionId,
            from_npc: payload.fromNpc,
            to_npc: payload.toNpc,
            message: payload.message,
            status: 'pending',
            metadata: payload.metadata || {},
            kind: payload.kind || 'fyi',
            lifecycle: 'sent',
            reply_to: payload.replyTo || null,
          };
          return lastHandoff;
        },
        resolveHandoffTarget: async ({ toDisplayName }) => ({
          session_id: 'sess-other',
          display_name: toDisplayName || 'Jake',
        }),
        getPendingHandoffs: async () => [],
        markHandoffDelivered: async (id) => ({ id, status: 'delivered', lifecycle: 'read' }),
        markHandoffStatus: async (id, _sid, lifecycle) => ({
          id,
          status: lifecycle === 'done' ? 'done' : 'delivered',
          lifecycle,
        }),
        setHandoffWakeUrl: async (sessionId, { url, secret, clear } = {}) => {
          if (clear) {
            sessionMeta[sessionId] = { ...sessionMeta[sessionId], handoff_wake_url: null, handoff_wake_secret: null };
            return { ok: true, configured: false, url: null };
          }
          sessionMeta[sessionId] = {
            ...sessionMeta[sessionId],
            handoff_wake_url: url,
            handoff_wake_secret: secret || null,
          };
          return { ok: true, configured: true, url: wake.maskWakeUrl(url), has_secret: !!secret };
        },
        getHandoffWakeUrl: async (sessionId) => {
          const cfg = wake.wakeConfigFromSession({ metadata: sessionMeta[sessionId] || {} });
          return {
            ok: true,
            configured: cfg.configured,
            url: cfg.url ? wake.maskWakeUrl(cfg.url) : null,
            has_secret: !!cfg.secret,
          };
        },
      },
      visitorConnections: { assertCanMessage: async () => true },
      listOnlineSessionIds: () => new Set(),
      broadcast: () => {},
      fetchImpl: async (url, opts) => {
        wakePosts.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
        return { ok: true, status: 200 };
      },
    });
  });

  it('send_handoff posts wake webhook to recipient', async () => {
    const r = await teamTools.callTool(SCOPE, 'send_handoff', {
      message: 'Can you review the RFP?',
      to_display_name: 'Jake',
      kind: 'question',
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'question');
    assert.equal(r.lifecycle, 'sent');
    assert.equal(r.wake.notified, true);
    assert.equal(wakePosts.length, 1);
    assert.equal(wakePosts[0].body.event, 'handoff.received');
    assert.equal(wakePosts[0].body.kind, 'question');
    assert.equal(wakePosts[0].body.handoff_id, 'handoff-wake-1');
    assert.equal(lastHandoff.metadata.kind, 'question');
  });

  it('register + get handoff webhook', async () => {
    const set = await teamTools.callTool(SCOPE, 'register_handoff_webhook', {
      url: 'https://hooks.example.com/jenny',
      secret: 'tok',
    });
    assert.equal(set.ok, true);
    assert.equal(set.configured, true);
    const got = await teamTools.callTool(SCOPE, 'get_handoff_webhook', {});
    assert.equal(got.configured, true);
    assert.equal(got.has_secret, true);
  });

  it('complete_handoff marks done', async () => {
    const r = await teamTools.callTool(SCOPE, 'complete_handoff', { handoff_id: 'h1' });
    assert.equal(r.ok, true);
    assert.equal(r.lifecycle, 'done');
    assert.equal(r.status, 'done');
  });

  it('acknowledge_handoff defaults to read', async () => {
    const r = await teamTools.callTool(SCOPE, 'acknowledge_handoff', { handoff_id: 'h1' });
    assert.equal(r.ok, true);
    assert.equal(r.lifecycle, 'read');
  });
});
