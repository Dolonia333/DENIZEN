'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const wa = require('../src/denizen-workspace-access');
const roster = require('../src/denizen-studio-board-roster');
const boardMutations = require('../src/denizen-studio-board-mutations');

describe('denizen-workspace-access', () => {
  const alice = {
    identityId: 'id-alice',
    email: 'alice@dolonia.test',
    displayName: 'Alice Founder',
    user: 'Alice Founder',
    role: 'owner',
  };
  const bob = {
    identityId: 'id-bob',
    email: 'bob@dolonia.test',
    displayName: 'Bob Member',
    user: 'Bob Member',
    role: 'member',
  };

  it('parseScope defaults to own; org requires admin role', () => {
    assert.equal(wa.parseScope(null, { role: 'owner' }), 'own');
    assert.equal(wa.parseScope('team', { role: 'member' }), 'team');
    assert.equal(wa.parseScope('org', { role: 'member' }), 'own');
    assert.equal(wa.parseScope('org', { role: 'owner' }), 'org');
  });

  it('Mine hides others private rows; Team shows shared/assigned but NOT legacy', () => {
    const privateAlice = wa.stampOwnership({ id: '1', title: 'Secret' }, alice);
    const shared = wa.stampOwnership({ id: '2', title: 'Shared', visibility: 'team' }, alice);
    const legacy = { id: '3', title: 'Old row' };
    const assignedToBob = wa.stampOwnership({ id: '4', title: 'For Bob', assignee: 'Bob Member' }, alice);

    const mine = wa.filterRecords([privateAlice, shared, legacy, assignedToBob], 'own', bob);
    assert.equal(mine.some((r) => r.id === '1'), false);
    assert.equal(mine.some((r) => r.id === '3'), false); // legacy blank for members
    assert.equal(mine.some((r) => r.id === '4'), true); // assignee

    const team = wa.filterRecords([privateAlice, shared, legacy, assignedToBob], 'team', bob);
    assert.equal(team.some((r) => r.id === '1'), false);
    assert.equal(team.some((r) => r.id === '2'), true);
    assert.equal(team.some((r) => r.id === '3'), false); // legacy not team-visible
    assert.equal(team.some((r) => r.id === '4'), true);

    const aliceMine = wa.filterRecords([privateAlice, shared, legacy], 'own', alice);
    assert.ok(aliceMine.some((r) => r.id === '1'));
    assert.ok(aliceMine.some((r) => r.id === '3')); // owner keeps legacy in Mine
  });

  it('stampOwnership sets private + ownerIdentityId', () => {
    const row = wa.stampOwnership({ id: 'x', title: 'Deal' }, alice);
    assert.equal(row.visibility, 'private');
    assert.equal(row.ownerIdentityId, 'id-alice');
    assert.equal(row.ownerEmail, 'alice@dolonia.test');
  });
});

describe('studio-board-roster', () => {
  it('syncPeopleFromAccounts upserts org teammates without wiping color', () => {
    const state = {
      people: [{ id: 'p1', name: 'Alice Founder', email: 'alice@dolonia.test', color: '#111111' }],
    };
    const accounts = [
      { id: 'a1', display_name: 'Alice Founder', email: 'alice@dolonia.test', role: 'owner', identity_id: 'id-alice' },
      { id: 'a2', display_name: 'Bob Member', email: 'bob@dolonia.test', role: 'member', identity_id: 'id-bob' },
    ];
    const { state: next, changed } = roster.syncPeopleFromAccounts(state, accounts);
    assert.equal(changed, true);
    assert.equal(next.people.length, 2);
    const alice = next.people.find((p) => p.email === 'alice@dolonia.test');
    assert.equal(alice.color, '#111111');
    assert.equal(alice.identityId, 'id-alice');
    assert.ok(next.people.find((p) => p.email === 'bob@dolonia.test'));
  });
});

describe('board scope filters', () => {
  it('filterStateForScope keeps people and filters tasks', () => {
    const alice = { identityId: 'id-a', displayName: 'Alice', email: 'a@t.com', role: 'member' };
    const state = {
      people: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
      tasks: [
        wa.stampOwnership({ id: 't1', title: 'Mine', status: 'backlog' }, alice),
        { id: 't2', title: 'Legacy', status: 'backlog' },
        wa.stampOwnership({ id: 't3', title: 'Other private', status: 'backlog', ownerIdentityId: 'id-other', visibility: 'private' }, { identityId: 'id-other', displayName: 'Other' }),
      ],
      events: [],
      notes: [],
      activity: [],
      config: { stages: [{ id: 'backlog' }] },
    };
    const own = boardMutations.filterStateForScope(state, alice, 'own');
    assert.equal(own.state.people.length, 2);
    assert.ok(own.state.tasks.some((t) => t.id === 't1'));
    assert.equal(own.state.tasks.some((t) => t.id === 't2'), false); // member: legacy blank
    assert.equal(own.state.tasks.some((t) => t.id === 't3'), false);
    const team = boardMutations.filterStateForScope(state, alice, 'team');
    assert.equal(team.state.tasks.some((t) => t.id === 't2'), false); // legacy not team
    const owner = { ...alice, role: 'owner' };
    const ownerMine = boardMutations.filterStateForScope(state, owner, 'own');
    assert.ok(ownerMine.state.tasks.some((t) => t.id === 't2')); // owner keeps legacy
  });
});
