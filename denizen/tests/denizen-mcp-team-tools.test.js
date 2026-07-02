'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const teamTools = require('../src/denizen-mcp-team-tools.js');

const SCOPE = {
  ok: true,
  org_id: '11111111-1111-1111-1111-111111111111',
  org_slug: 'zion',
  npc_key: 'rob',
  session_id: 'sess-aaa-bbb',
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
            npc_key: 'josh',
            assistant_name: 'Josh',
            online: true,
          },
        ]),
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
      },
      visitorConnections: {
        assertCanMessage: async () => true,
      },
      listOnlineSessionIds: () => new Set(['sess-other']),
      notifyCeoHandoff: () => {},
      npcBrains: {
        getDirective: () => ({ from: 'MCP', task: 'Ship mockups', urgent: false }),
        getOpenCommitments: () => [{ text: 'Send Figma link', status: 'open' }],
      },
    });
  });

  it('list_team requires session_id', async () => {
    const r = await teamTools.callTool({ ...SCOPE, session_id: null }, 'list_team', {});
    assert.equal(r.ok, false);
  });

  it('list_team returns teammates', async () => {
    const r = await teamTools.callTool(SCOPE, 'list_team', {});
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.teammates[0].npc_key, 'josh');
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
    assert.equal(extras.display_name, 'Rob');
    assert.ok(Array.isArray(extras.skills));
    assert.equal(extras.directive_inbox.task, 'Ship mockups');
    assert.equal(extras.pending_handoffs_count, 1);
  });
});
