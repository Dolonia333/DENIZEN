'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const access = require('../src/denizen-crm-access');

describe('denizen-crm-access', () => {
  const kaiser = {
    user: 'Kaiser',
    displayName: 'Kaiser',
    email: 'info@royalsocietymanagementgroup.com',
    identityId: 'id-kaiser',
    role: 'member',
  };

  const fullState = {
    deals: [
      { id: 1, title: 'Kaiser Deal', contact: 'Acme', ownerId: 'Kaiser', value: 100, stage: 'Lead' },
      { id: 2, title: 'Zion Deal', contact: 'Beta', ownerId: 'Zion', value: 200, stage: 'Proposal' },
      { id: 3, title: 'Unowned', contact: 'Gamma', value: 50, stage: 'Lead' },
    ],
    tasks: [
      { id: 10, title: 'Call Acme', assignee: 'Kaiser', done: false },
      { id: 11, title: 'Prep deck', assignee: 'Zion', done: false },
    ],
    contacts: [
      { id: 100, name: 'Acme', email: 'a@x.com' },
      { id: 101, name: 'Beta', email: 'b@x.com' },
      { id: 102, name: 'Gamma', email: 'g@x.com' },
    ],
    notes: [
      { id: 1, contact: 'Acme', text: 'mine', createdBy: 'Kaiser' },
      { id: 2, contact: 'Beta', text: 'theirs' },
    ],
    auditLog: [
      { user: 'Kaiser', action: 'created', entity: 'deals', at: '2026-09-01T00:00:00Z' },
      { user: 'Zion', action: 'updated', entity: 'deals', at: '2026-09-02T00:00:00Z' },
    ],
    usageLog: [
      { id: 1, user: 'Kaiser', action: 'deal_created', at: '2026-09-01T00:00:00Z' },
      { id: 2, user: 'Zion', action: 'deal_updated', at: '2026-09-02T00:00:00Z' },
    ],
    teamPolicy: { requireOwnerOnDeal: true },
    packages: [{ id: 1, name: 'Starter' }],
  };

  it('isOrgWideRole recognizes owner/admin', () => {
    assert.equal(access.isOrgWideRole('owner'), true);
    assert.equal(access.isOrgWideRole('admin'), true);
    assert.equal(access.isOrgWideRole('member'), false);
  });

  it('filterWorkspaceForAccess keeps only member-owned rows', () => {
    const { state, scope, filtered } = access.filterWorkspaceForAccess(fullState, kaiser, { orgWide: false });
    assert.equal(scope, 'own');
    assert.equal(filtered, true);
    assert.deepEqual(state.deals.map((d) => d.id), [1]);
    assert.deepEqual(state.tasks.map((t) => t.id), [10]);
    assert.deepEqual(state.contacts.map((c) => c.id), [100]);
    assert.equal(state.notes.length, 1);
    assert.equal(state.auditLog.length, 1);
    assert.equal(state.usageLog.length, 1);
    // Shared config still present for UI
    assert.equal(state.teamPolicy.requireOwnerOnDeal, true);
    assert.equal(state.packages.length, 1);
  });

  it('filterWorkspaceForAccess is a no-op for owners', () => {
    const { state, scope, filtered } = access.filterWorkspaceForAccess(fullState, {
      ...kaiser,
      role: 'owner',
    }, { orgWide: true });
    assert.equal(scope, 'org');
    assert.equal(filtered, false);
    assert.equal(state.deals.length, 3);
  });

  it('mergeMemberWorkspace does not wipe teammate deals', () => {
    const memberPayload = {
      deals: [
        { id: 1, title: 'Kaiser Deal Updated', contact: 'Acme', ownerId: 'Kaiser', value: 150, stage: 'Qualified' },
        { id: 4, title: 'New Kaiser Deal', contact: 'Acme', ownerId: 'Kaiser', value: 10, stage: 'Lead' },
      ],
      tasks: [{ id: 10, title: 'Call Acme done', assignee: 'Kaiser', done: true }],
      teamPolicy: { requireOwnerOnDeal: false },
      packages: [],
    };
    const merged = access.mergeMemberWorkspace(fullState, memberPayload, kaiser);
    assert.equal(merged.deals.find((d) => d.id === 2)?.title, 'Zion Deal');
    assert.equal(merged.deals.find((d) => d.id === 1)?.title, 'Kaiser Deal Updated');
    assert.ok(merged.deals.find((d) => d.id === 4));
    assert.equal(merged.tasks.find((t) => t.id === 11)?.assignee, 'Zion');
    // Member cannot clobber org policy / packages
    assert.equal(merged.teamPolicy.requireOwnerOnDeal, true);
    assert.equal(merged.packages.length, 1);
  });

  it('buildTeamActivity returns feed for everyone', () => {
    const activity = access.buildTeamActivity(fullState, {
      limit: 10,
      teamMembers: ['Kaiser', 'Zion'],
    });
    assert.ok(activity.feed.length >= 2);
    assert.ok(activity.by_user.some((u) => u.user === 'Zion' && u.actions > 0));
  });

  it('matches Kaiser by email local-part alias', () => {
    const state = {
      deals: [
        { id: 9, title: 'RS Deal', contact: 'X', ownerId: 'info', value: 1, stage: 'Lead' },
      ],
      tasks: [],
      contacts: [],
    };
    const scoped = access.filterWorkspaceForAccess(state, kaiser, { orgWide: false });
    assert.equal(scoped.state.deals.length, 1);
  });
});
