'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const records = require('../src/denizen-crm-agent-records');

const state = {
  contacts: [{ id: 1, name: 'Ada', email: 'ada@example.com', company: 'Acme' }],
  companies: [{ id: 9, name: 'Acme', linkedContacts: [], linkedDeals: [] }],
  deals: [
    { id: 15, title: 'Acme site', stage: 'Qualified', value: 110, contact: 'Ada', company: 'Acme', status: 'open', closeDate: '2026-11-01', ownerEmail: 'angelavanzandt1921@gmail.com' },
    { id: 16, title: 'Zion deal', stage: 'Proposal', value: 500, ownerEmail: 'zionvanzandt@gmail.com' },
  ],
  tasks: [
    { id: 3, title: 'HSJ follow up', due: '2020-01-01', done: false, assignee: 'Angela Van Zandt' },
    { id: 4, title: 'Zion task', due: '2020-01-01', done: false, assignee: 'Dolonia' },
  ],
  packages: [],
  userPrefs: { profile: { name: 'Guest' } },
};

const angela = {
  forceOwn: true,
  email: 'angelavanzandt1921@gmail.com',
  displayName: 'Angela Van Zandt',
  user: 'Angela Van Zandt',
  identityId: 'ident-angela',
  aliases: ['angela van zandt', 'angelavanzandt1921@gmail.com'],
};

describe('crm agent records', () => {
  it('lists structured ids', () => {
    const listed = records.recordsFromState(state, { limit: 50 });
    assert.equal(listed.records.deals[0].deal_id, 15);
    assert.equal(listed.records.deals[0].contact_id, 1);
    assert.equal(listed.records.deals[0].company_id, 9);
    assert.equal(listed.records.contacts[0].contact_id, 1);
    assert.equal(listed.records.companies[0].company_id, 9);
    assert.equal(listed.records.tasks[0].task_id, 3);
  });

  it('bulk-updates only the caller’s deals and tasks', () => {
    const deals = records.applyBulkDealUpdates(state, [
      { deal_id: 15, stage: 'Proposal', next_action: 'Send scope' },
      { deal_id: 16, stage: 'Closed Lost' },
    ], angela);
    assert.equal(deals.results[0].ok, true);
    assert.equal(deals.results[1].ok, false);
    assert.equal(deals.state.deals.find((d) => d.id === 15).stage, 'Proposal');
    assert.equal(deals.state.deals.find((d) => d.id === 16).stage, 'Proposal');

    const tasks = records.applyBulkTaskUpdates(state, [
      { task_id: 3, status: 'paused' },
      { task_id: 4, status: 'cancelled' },
    ], angela);
    assert.equal(tasks.results[0].ok, true);
    assert.equal(tasks.state.tasks.find((t) => t.id === 3).status, 'paused');
    assert.equal(tasks.state.tasks.find((t) => t.id === 4).status, undefined);
  });

  it('links a contact to a deal and upserts a package', () => {
    const linked = records.applyBulkLinks(state, [
      { type: 'contact_deal', contact_id: 1, deal_id: 15 },
      { type: 'deal_company', deal_id: 15, company_id: 9 },
      { type: 'past_performance_customer', deal_id: 15, customer_id: 9 },
    ], angela);
    assert.ok(linked.results.every((row) => row.ok));
    const deal = linked.state.deals.find((d) => d.id === 15);
    assert.equal(deal.contactId, 1);
    assert.equal(deal.companyId, 9);
    assert.equal(deal.pastPerformance.customer_id, 9);

    const pkg = records.upsertPackageRecord(state, {
      name: 'Proposal support',
      tier: 'proposal',
      features: ['capture', 'coordination'],
    });
    assert.equal(pkg.result.ok, true);
    assert.equal(pkg.result.package.name, 'Proposal support');
    assert.equal(pkg.state.packages.length, 1);
  });

  it('writes profile fields without inventing a name', () => {
    const profile = records.applyProfilePatch(state, {
      name: 'Angela Van Zandt',
      email: 'angelavanzandt1921@gmail.com',
      title: 'Principal',
      phone: '405-555-0100',
    }, 'angela');
    assert.equal(profile.profile.name, 'Angela Van Zandt');
    assert.equal(profile.profile.title, 'Principal');
    assert.equal(profile.state.userPrefs.profile.name, 'Angela Van Zandt');
  });
});
