'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const mcpActor = require('../src/denizen-mcp-actor');

describe('denizen-mcp-actor', () => {
  beforeEach(() => {
    mcpActor.configure({
      denizenVisitor: {
        getSession: async (sid) => {
          if (sid === 'sess-member') {
            return {
              display_name: 'Kaiser',
              identity_id: 'id-kaiser',
              metadata: { email: 'kaiser@example.com', role: 'member' },
            };
          }
          if (sid === 'sess-owner') {
            return {
              display_name: 'Angela',
              identity_id: 'id-angela',
              metadata: { email: 'angela@example.com' },
            };
          }
          return null;
        },
      },
      teamAuth: {
        getTeamAccountForSession: async (sid) => {
          if (sid === 'sess-member') {
            return {
              id: 'acct-kaiser',
              email: 'kaiser@example.com',
              display_name: 'Kaiser',
              role: 'member',
            };
          }
          if (sid === 'sess-owner') {
            return {
              id: 'acct-angela',
              email: 'angela@example.com',
              display_name: 'Angela',
              role: 'owner',
            };
          }
          return null;
        },
        resolveCeoPrincipalForSession: async () => ({ ceo: false }),
      },
    });
  });

  it('enriches member ChatGPT sessions into own data_scope', async () => {
    const scope = await mcpActor.enrichMcpScope({
      org_id: 'org-1',
      npc_key: 'josh',
      session_id: 'sess-member',
      scopes: ['read', 'crm_write'],
    });
    assert.equal(scope.identity_id, 'id-kaiser');
    assert.equal(scope.member_id, 'acct-kaiser');
    assert.equal(scope.display_name, 'Kaiser');
    assert.equal(scope.role, 'member');
    assert.equal(scope.org_wide, false);
    assert.equal(scope.data_scope, 'own');
    const actor = mcpActor.actorFromMcpScope(scope);
    assert.equal(actor.identityId, 'id-kaiser');
    assert.equal(actor.user, 'Kaiser');
  });

  it('keeps owners org-wide', async () => {
    const scope = await mcpActor.enrichMcpScope({
      org_id: 'org-1',
      npc_key: 'abby',
      session_id: 'sess-owner',
    });
    assert.equal(scope.role, 'owner');
    assert.equal(scope.org_wide, true);
    assert.equal(scope.data_scope, 'org');
  });

  it('treats team operator tokens without session as org-wide', async () => {
    const scope = await mcpActor.enrichMcpScope({
      org_id: 'org-1',
      npc_key: '_team',
      scope_mode: 'team',
    });
    assert.equal(scope.org_wide, true);
    assert.equal(scope.data_scope, 'org');
  });
});
