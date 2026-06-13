'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichThinkContext,
  buildMemberOverlay,
  buildPurposeOverlay,
  displayToNpcKey,
  clearTeamCache,
} = require('../src/visitor-office-context.js');

describe('visitor-office-context', () => {
  it('displayToNpcKey maps roster display names', () => {
    assert.equal(displayToNpcKey('Alex'), 'alex');
    assert.equal(displayToNpcKey('alex'), 'alex');
  });

  it('buildMemberOverlay includes CEO line', () => {
    const overlay = buildMemberOverlay({
      display_name: 'Code Lead',
      role: 'Senior dev',
    }, 'Dog');
    assert.match(overlay, /CEO of this office/);
    assert.match(overlay, /Code Lead/);
  });

  it('buildPurposeOverlay includes mission', () => {
    const overlay = buildPurposeOverlay({
      name: 'Launch Squad',
      purpose: 'Ship v2 onboarding',
      members: [{ npc_key: 'alex', display_name: 'Alex', active: true }],
    }, 'Dog', false);
    assert.match(overlay, /CEO: Dog/);
    assert.match(overlay, /v2 onboarding/);
  });

  it('enrichThinkContext scopes to one office identity', async () => {
    clearTeamCache();
    const officeId = 'id-1';
    const deps = {
      listOnlineSessionIds: () => ['sess-1'],
      denizenVisitor: {
        getSession: async (id) => ({
          id,
          identity_id: officeId,
          display_name: 'Dog',
          metadata: { tier: 'demo' },
        }),
      },
      visitorAccess: {
        resolveSessionAccess: async () => ({
          tier: 'demo',
          session: { metadata: { tier: 'demo' } },
          org: { settings: {} },
        }),
        canUseRealWork: () => false,
      },
      userIdentity: {
        getNpcTeam: async () => ({
          name: 'Dog Squad',
          purpose: 'Find product-market fit',
          members: [
            {
              npc_key: 'alex',
              display_name: 'Alex',
              role: 'Builder',
              active: true,
            },
          ],
        }),
      },
    };

    const ctx = await enrichThinkContext('Alex', {
      officeId,
      visitorSessionId: 'sess-1',
    }, deps);
    assert.equal(ctx.officeId, officeId);
    assert.equal(ctx.visitorScoped, true);
    assert.equal(ctx.canUseRealWork, false);
    assert.match(ctx.teamPurposeOverlay, /Dog Squad/);
    assert.match(ctx.teamMemberOverlay, /Builder/);
  });

  it('enrichThinkContext without officeId uses ceo-operator', async () => {
    const ctx = await enrichThinkContext('Alex', {}, {});
    assert.equal(ctx.officeId, 'ceo-operator');
    assert.equal(ctx.visitorScoped, false);
  });
});
