'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const teamGateway = require('../src/mcp/denizen-mcp-team-gateway.js');
const npcGateway = require('../src/core/denizen-npc-mcp-gateway.js');

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
        getPendingHandoffs: async () => ([]),
        sendHandoff: async (p) => ({ id: 'h1', ...p }),
        resolveHandoffTarget: async () => ({ session_id: 's2' }),
      },
      visitorConnections: { assertCanMessage: async () => true },
      listOnlineSessionIds: () => new Set(),
      npcBrains: {
        assignDirective: () => { assignCount += 1; },
        getAllDirectives: () => ({ Rob: { task: 'Design mockup', from: 'MCP' } }),
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
    assert.equal(r.teammate_count, 1);
    assert.ok(r.active_directives.Rob);
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
