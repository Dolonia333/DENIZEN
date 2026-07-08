'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const scope = require('../src/denizen-approvals-scope');

describe('denizen-approvals-scope', () => {
  it('detects Angela Van Zandt by email and display name', () => {
    assert.equal(scope.isAngelaHoldingPrincipal({ email: 'vzion253@gmail.com' }), true);
    assert.equal(scope.isAngelaHoldingPrincipal({ display_name: 'Angela Van Zandt' }), true);
    assert.equal(scope.isAngelaHoldingPrincipal({ display_name: 'Rilwan Hollis' }), false);
  });

  it('forces white skin for regular users and branded skin for Angela', () => {
    assert.equal(scope.resolveDossierSkinForOwner(
      { display_name: 'Guest' },
      { requestedSkin: 'denizen', defaultSkin: 'denizen' },
    ), 'white');
    assert.equal(scope.resolveDossierSkinForOwner(
      { email: 'vzion253@gmail.com' },
      { requestedSkin: 'denizen', defaultSkin: 'denizen' },
    ), 'denizen');
    assert.equal(scope.resolveDossierSkinForOwner(
      { email: 'vzion253@gmail.com' },
      { defaultSkin: '1921' },
    ), '1921');
  });

  it('filters merged proposals to owned dossiers for individuals', () => {
    const items = [
      { kind: 'dossier', id: 'a', raw: { owner_identity_id: 'id-1' } },
      { kind: 'dossier', id: 'b', raw: { owner_identity_id: 'id-2' } },
      { kind: 'code', id: 'c', raw: {} },
    ];
    const mine = scope.filterMergedProposals(items, { identityId: 'id-1', operator: false });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, 'a');
    assert.equal(scope.filterMergedProposals(items, { identityId: 'id-1', operator: true }).length, 3);
  });

  it('hides legacy dossiers without owner from individuals', () => {
    const legacy = { kind: 'dossier', id: 'old', raw: {} };
    assert.equal(scope.proposalOwnedByIdentity(legacy, 'id-1'), false);
    assert.equal(scope.proposalVisibleToViewer(legacy, { identityId: 'id-1', operator: false }), false);
    assert.equal(scope.proposalVisibleToViewer(legacy, { operator: true }), true);
  });
});
