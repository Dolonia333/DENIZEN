'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const teamGateway = require('../src/denizen-mcp-team-gateway.js');
const npcGateway = require('../src/denizen-npc-mcp-gateway.js');

const TEAM_SCOPE = {
  ok: true,
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: '_team',
  scope_mode: 'team',
  session_id: 'sess-team',
  member_id: 'mem-1',
  token_id: 'tok-team',
};

describe('denizen-mcp-team-gateway', () => {
  before(() => {
    let assignCount = 0;
    npcGateway.configure({
      runNpcSkill: async (name, skill) => ({ ok: true, output: `${name}:${skill}`, npcName: name, skill }),
      npcBrains: {
        assignDirective: () => { assignCount += 1; },
        getAllDirectives: () => ({ Rob: { task: 'Design mockup', from: 'MCP' } }),
        getDirective: () => null,
        getOpenCommitments: () => [],
      },
      broadcast: () => {},
    });
    teamGateway.configure({
      denizenVisitor: {
        listTeammatesWithPresence: async () => ([{ session_id: 's2', display_name: 'Jake', online: true }]),
        getSession: async (id) => ({ id, display_name: 'Operator', identity_id: 'ident-op' }),
        getAssistant: async () => ({ npc_key: '_team', assistant_name: 'Team' }),
        getPendingHandoffs: async () => ([]),
        markHandoffDelivered: async (id) => ({ id, status: 'delivered' }),
        sendHandoff: async (p) => ({ id: 'h1', ...p }),
        resolveHandoffTarget: async () => ({ session_id: 's2' }),
      },
      visitorConnections: { assertCanMessage: async () => true },
      listOnlineSessionIds: () => new Set(['s2']),
      npcBrains: {
        assignDirective: () => { assignCount += 1; },
        getAllDirectives: () => ({ Rob: { task: 'Design mockup', from: 'MCP' } }),
        getDirective: () => null,
        getOpenCommitments: () => [],
      },
    });
  });

  it('exports team operator tools', () => {
    const names = teamGateway.TEAM_TOOL_DEFINITIONS.map((t) => t.name);
    assert.ok(names.includes('team_status'));
    assert.ok(names.includes('run_as_npc'));
    assert.ok(names.includes('broadcast_task'));
    assert.ok(names.includes('list_team'));
  });

  it('team_status aggregates roster and directives', async () => {
    const r = await teamGateway.callTool(TEAM_SCOPE, 'team_status', {});
    assert.equal(r.ok, true);
    // Caller row is included so an active MCP session always has online_count >= 1.
    assert.ok(r.teammate_count >= 1);
    assert.ok(r.online_count >= 1);
    assert.ok(r.presence_summary);
    assert.ok(r.poll?.standup);
    assert.ok(r.active_directives.Rob);
  });

  it('team_standup tool and resource are registered', async () => {
    assert.ok(teamGateway.TEAM_TOOL_DEFINITIONS.some((t) => t.name === 'team_standup'));
    assert.ok(teamGateway.TEAM_RESOURCES.some((r) => r.uri === 'team://standup'));
    const r = await teamGateway.callTool(TEAM_SCOPE, 'team_standup', {
      include_crm: false,
      include_cursor: false,
    });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.action_items));
  });

  it('run_as_npc delegates to npc gateway', async () => {
    const r = await teamGateway.callTool(TEAM_SCOPE, 'run_as_npc', {
      npc_key: 'rob',
      tool: 'list_skills',
      arguments: {},
    });
    assert.equal(r.ok, true);
    assert.equal(r.npc_key, 'rob');
    assert.ok(r.result.skills);
  });

  it('run_as_npc blocks protected NPCs', async () => {
    const r = await teamGateway.callTool(TEAM_SCOPE, 'run_as_npc', {
      npc_key: 'lucy',
      tool: 'get_status',
    });
    assert.equal(r.ok, false);
  });

  it('broadcast_task assigns multiple NPCs', async () => {
    const r = await teamGateway.callTool(TEAM_SCOPE, 'broadcast_task', {
      task: 'Standup in 5',
      npc_keys: ['rob', 'josh'],
    });
    assert.equal(r.ok, true);
    assert.equal(r.assigned_count, 2);
  });

  it('isTeamScope detects team tokens', () => {
    assert.equal(teamGateway.isTeamScope(TEAM_SCOPE), true);
    assert.equal(teamGateway.isTeamScope({ npc_key: 'rob' }), false);
  });
});
