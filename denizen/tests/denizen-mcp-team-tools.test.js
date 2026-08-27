'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const teamTools = require('../src/denizen-mcp-team-tools.js');

const SCOPE = {
  ok: true,
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: 'jenny',
  session_id: 'sess-jenny-active',
  member_id: 'mem-1',
};

describe('denizen-mcp-team-tools', () => {
  before(() => {
    teamTools.configure({
      denizenVisitor: {
        listTeammatesWithPresence: async () => ([
          {
            session_id: 'sess-other',
            display_name: 'Jake',
            identity_id: 'ident-jake',
            npc_key: 'josh',
            assistant_name: 'Josh',
            online: true,
          },
          {
            session_id: 'sess-dolonia-a',
            display_name: 'Dolonia',
            identity_id: 'ident-dolonia',
            npc_key: 'abby',
          },
          {
            session_id: 'sess-dolonia-b',
            display_name: 'Dolonia',
            identity_id: 'ident-dolonia',
            npc_key: 'abby',
          },
          {
            session_id: 'sess-probe-1',
            display_name: 'TestUser',
            npc_key: null,
          },
          {
            session_id: 'sess-probe-2',
            display_name: 'HealthCheck',
            npc_key: null,
          },
          {
            session_id: 'sess-probe-3',
            display_name: 'Probe',
            npc_key: null,
          },
        ]),
        getSession: async (id) => ({
          id,
          display_name: 'Jenny',
          identity_id: 'ident-jenny',
        }),
        getAssistant: async () => ({ npc_key: 'jenny', assistant_name: 'Jenny' }),
        sendHandoff: async (payload) => ({
          id: 'handoff-1',
          ...payload,
        }),
        resolveHandoffTarget: async ({ toCeo, toDisplayName }) => {
          if (toCeo) return { session_id: 'ceo-bridge', is_ceo_bridge: true };
          if (toDisplayName) return { session_id: 'sess-other', display_name: toDisplayName };
          return { session_id: 'sess-other' };
        },
        getPendingHandoffs: async () => ([
          { id: 'h1', message: 'Review deck', status: 'pending' },
        ]),
        markHandoffDelivered: async (id, sessionId) => ({
          id,
          session_id: sessionId,
          status: 'delivered',
        }),
      },
      visitorConnections: {
        assertCanMessage: async () => true,
      },
      listOnlineSessionIds: () => new Set(['sess-other']),
      notifyCeoHandoff: () => {},
      npcBrains: {
        getDirective: () => ({ from: 'MCP', task: 'Ship mockups', urgent: false }),
        getOpenCommitments: () => [{ text: 'Send Figma link', status: 'open' }],
        getAllDirectives: () => ({ Rob: { from: 'MCP', task: 'Ship mockups', urgent: true } }),
      },
    });
  });

  beforeEach(() => {
    teamTools.clearMcpPresenceForTests();
  });

  it('list_team works without session_id for CLI/API tokens', async () => {
    const r = await teamTools.callTool({ ...SCOPE, session_id: null, npc_key: 'grok' }, 'list_team', {});
    assert.equal(r.ok, true);
    assert.equal(r.session_linked, false);
    assert.ok(r.count >= 1);
    const you = r.teammates.find((t) => t.is_you);
    assert.ok(you);
    assert.equal(you.npc_key, 'grok');
    assert.equal(you.mcp_online, true);
    assert.ok(r.online_count >= 1);
  });

  it('team_standup works without session_id (degraded handoffs)', async () => {
    const r = await teamTools.callTool(
      { ...SCOPE, session_id: null, npc_key: 'claude' },
      'team_standup',
      { include_crm: false, include_cursor: false },
    );
    assert.equal(r.ok, true);
    assert.equal(r.session_linked, false);
    assert.equal(r.handoffs.count, 0);
    assert.ok(r.team.count >= 1);
    assert.ok(Array.isArray(r.action_items));
  });

  it('list_team marks caller mcp_online and online_count >= 1', async () => {
    const r = await teamTools.callTool(SCOPE, 'list_team', {});
    assert.equal(r.ok, true);
    assert.ok(r.online_count >= 1, `expected online_count >= 1, got ${r.online_count}`);
    const you = r.teammates.find((t) => t.is_you);
    assert.ok(you);
    assert.equal(you.mcp_online, true);
    assert.equal(you.online, true);
    assert.equal(you.mcp_presence, 'active');
    assert.ok(you.last_mcp_at);
  });

  it('list_team collapses duplicate identities and filters probes', async () => {
    const r = await teamTools.callTool(SCOPE, 'list_team', {});
    assert.equal(r.ok, true);
    assert.ok(r.raw_session_count >= 6);
    assert.ok(r.pruned_probe_count >= 3);
    const names = r.teammates.map((t) => t.display_name);
    assert.ok(names.includes('Jenny'));
    assert.ok(names.includes('Jake'));
    assert.ok(names.includes('Dolonia'));
    assert.equal(names.filter((n) => n === 'Dolonia').length, 1);
    assert.ok(!names.includes('TestUser'));
    assert.ok(!names.includes('HealthCheck'));
    assert.ok(!names.includes('Probe'));
    const dolonia = r.teammates.find((t) => t.display_name === 'Dolonia');
    assert.ok(dolonia.sessions_collapsed >= 2);
    assert.ok(r.count < r.raw_session_count);
  });

  it('touchMcpPresence drives mcp_online without DB tokens', async () => {
    teamTools.touchMcpPresence('sess-other');
    const enriched = teamTools.enrichTeammatesWithMcpPresence(
      [{ session_id: 'sess-other', display_name: 'Jake' }],
      [],
      new Set(),
    );
    assert.equal(enriched[0].mcp_online, true);
    assert.equal(enriched[0].online, true);
    assert.equal(enriched[0].ws_online, false);
  });

  it('collapseRosterByIdentity merges by identity_id', () => {
    const { teammates, pruned_probe_count } = teamTools.collapseRosterByIdentity([
      { session_id: 'a', display_name: 'Dolonia', identity_id: 'x', online: false, mcp_presence: 'recent', last_mcp_at: '2026-08-01T00:00:00Z' },
      { session_id: 'b', display_name: 'Dolonia', identity_id: 'x', online: true, mcp_online: true, mcp_presence: 'active', last_mcp_at: '2026-08-27T09:00:00Z' },
      { session_id: 'c', display_name: 'TestUser', online: false },
    ]);
    assert.equal(pruned_probe_count, 1);
    assert.equal(teammates.length, 1);
    assert.equal(teammates[0].online, true);
    assert.equal(teammates[0].sessions_collapsed, 2);
  });

  it('isProbeSessionName catches TestUser / Probe / HealthCheck', () => {
    assert.equal(teamTools.isProbeSessionName('TestUser'), true);
    assert.equal(teamTools.isProbeSessionName('Probe'), true);
    assert.equal(teamTools.isProbeSessionName('HealthCheck'), true);
    assert.equal(teamTools.isProbeSessionName('Dolonia'), false);
    assert.equal(teamTools.isProbeSessionName('Jenny'), false);
  });

  it('acknowledge_handoff marks delivered', async () => {
    const r = await teamTools.callTool(SCOPE, 'acknowledge_handoff', { handoff_id: 'h1' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'delivered');
  });

  it('team_standup aggregates action items and presence', async () => {
    const r = await teamTools.callTool(SCOPE, 'team_standup', {
      include_crm: false,
      include_cursor: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.handoffs.count, 1);
    assert.ok(r.team.online_count >= 1);
    assert.ok(Array.isArray(r.action_items));
    assert.ok(r.action_items.some((a) => a.action === 'list_pending_handoffs'));
    assert.ok(r.next_poll?.tools?.includes('team_standup'));
  });

  it('send_handoff to CEO', async () => {
    const r = await teamTools.callTool(SCOPE, 'send_handoff', {
      message: 'Need approval on quote',
      to_ceo: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.handoff_id, 'handoff-1');
  });

  it('list_pending_handoffs returns inbox', async () => {
    const r = await teamTools.callTool(SCOPE, 'list_pending_handoffs', {});
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
  });

  it('buildStatusExtras includes directive and skills', async () => {
    const extras = await teamTools.buildStatusExtras(SCOPE, { work: [] });
    assert.equal(extras.display_name, 'Jenny');
    assert.ok(Array.isArray(extras.skills));
    assert.equal(extras.directive_inbox.task, 'Ship mockups');
    assert.equal(extras.pending_handoffs_count, 1);
  });
});
