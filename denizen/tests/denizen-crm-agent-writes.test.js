'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const orgPolicy = require('../src/denizen-org-policy');
const crmStore = require('../src/denizen-crm-store');
const agentWrites = require('../src/denizen-crm-agent-writes');

describe('denizen-crm-agent-writes', () => {
  let origGet;
  let origUpsert;
  let origResolve;
  let store;
  let visitor;

  beforeEach(() => {
    orgPolicy.clearOrgPolicyCache();
    store = {
      state: {
        contacts: [{ id: 1, name: 'Jane Doe', email: 'jane@acme.com' }],
        deals: [{ id: 10, title: 'Acme Deal', stage: 'Qualified', value: 1000, contact: 'Jane Doe' }],
        notes: [],
        tasks: [],
      },
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    origGet = crmStore.getWorkspace;
    origUpsert = crmStore.upsertWorkspace;
    crmStore.getWorkspace = async () => ({
      org_id: 'org-1',
      state: store.state,
      updated_at: store.updated_at,
    });
    crmStore.upsertWorkspace = async (_org, state) => {
      store.state = state;
      store.updated_at = new Date().toISOString();
      return { org_id: 'org-1', state, updated_at: store.updated_at };
    };

    visitor = require('../src/denizen-visitor');
    origResolve = visitor.resolveOrgBySlug;
    visitor.resolveOrgBySlug = async (slug) => {
      if (String(slug).toLowerCase() === 'zion') return { id: 'org-1', slug: 'zion' };
      if (String(slug).toLowerCase() === 'missing') return null;
      return { id: `org-${slug}`, slug };
    };
  });

  afterEach(() => {
    crmStore.getWorkspace = origGet;
    crmStore.upsertWorkspace = origUpsert;
    if (visitor && origResolve) visitor.resolveOrgBySlug = origResolve;
    orgPolicy.clearOrgPolicyCache();
  });

  it('createNote fails closed without orgSlug', async () => {
    const r = await agentWrites.createNote({ npcName: 'Lucy', body: 'hello' });
    assert.equal(r.ok, false);
    assert.match(r.error, /org_slug required/i);
  });

  it('createNote fails closed when organization not found', async () => {
    const r = await agentWrites.createNote({
      orgSlug: 'missing',
      npcName: 'Lucy',
      body: 'hello',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /organization not found/i);
    assert.equal(r.code, 'MISSING_ORG');
  });

  it('createNote fails closed for demo org (acme)', async () => {
    const r = await agentWrites.createNote({
      orgSlug: 'acme',
      npcName: 'Lucy',
      body: 'should not write',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /Business data access disabled/i);
    assert.equal(r.code, 'ORG_POLICY_DENIED');
    assert.equal(store.state.notes.length, 0);
  });

  it('createNote validates body and npcName', async () => {
    let r = await agentWrites.createNote({ orgSlug: 'zion', npcName: 'Lucy', body: '' });
    assert.equal(r.ok, false);
    assert.match(r.error, /body required/i);

    r = await agentWrites.createNote({ orgSlug: 'zion', body: 'hi' });
    assert.equal(r.ok, false);
    assert.match(r.error, /npcName required/i);
  });

  it('createNote writes note with contactId/dealId', async () => {
    const r = await agentWrites.createNote({
      orgSlug: 'zion',
      npcName: 'Lucy',
      contactId: 1,
      dealId: 10,
      body: 'Called customer about renewal',
    });
    assert.equal(r.ok, true);
    assert.ok(r.id);
    assert.equal(store.state.notes.length, 1);
    assert.equal(store.state.notes[0].contact, 'Jane Doe');
    assert.equal(store.state.notes[0].contactId, 1);
    assert.equal(store.state.notes[0].dealId, 10);
    assert.equal(store.state.notes[0].author, 'Lucy');
    assert.equal(store.state.notes[0].type, 'agent-note');
    assert.match(r.summary, /Jane Doe/);
  });

  it('logTask fails closed without org and for demo', async () => {
    let r = await agentWrites.logTask({ npcName: 'Marcus', title: 'Follow up' });
    assert.equal(r.ok, false);
    assert.match(r.error, /org_slug required/i);

    r = await agentWrites.logTask({
      orgSlug: 'acme',
      npcName: 'Marcus',
      title: 'Follow up',
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ORG_POLICY_DENIED');
  });

  it('logTask creates task with optional dueAt', async () => {
    const r = await agentWrites.logTask({
      orgSlug: 'zion',
      npcName: 'Marcus',
      title: 'Send proposal',
      dueAt: '2026-08-01T12:00:00.000Z',
    });
    assert.equal(r.ok, true);
    assert.ok(r.id);
    assert.equal(store.state.tasks.length, 1);
    assert.equal(store.state.tasks[0].title, 'Send proposal');
    assert.equal(store.state.tasks[0].due, '2026-08-01');
    assert.match(store.state.tasks[0].notes, /Marcus/);
  });

  it('logTask validates title', async () => {
    const r = await agentWrites.logTask({ orgSlug: 'zion', npcName: 'Marcus', title: '  ' });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/i);
  });

  it('updateDealStage moves deal via existing mutation', async () => {
    const r = await agentWrites.updateDealStage({
      orgSlug: 'zion',
      dealId: 10,
      stage: 'Proposal',
      npcName: 'Marcus',
    });
    assert.equal(r.ok, true);
    assert.equal(r.id, 10);
    assert.equal(store.state.deals[0].stage, 'Proposal');
    assert.equal(r.previousStage, 'Qualified');
    assert.match(r.summary, /Proposal/i);
  });

  it('updateDealStage fails closed on missing deal and demo org', async () => {
    let r = await agentWrites.updateDealStage({
      orgSlug: 'zion',
      dealId: 999,
      stage: 'Won',
      npcName: 'Marcus',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);

    r = await agentWrites.updateDealStage({
      orgSlug: 'acme',
      dealId: 10,
      stage: 'Proposal',
      npcName: 'Marcus',
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ORG_POLICY_DENIED');
  });

  it('updateDealStage validates stage and dealId', async () => {
    let r = await agentWrites.updateDealStage({
      orgSlug: 'zion',
      stage: 'Proposal',
      npcName: 'Marcus',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /dealId required/i);

    r = await agentWrites.updateDealStage({
      orgSlug: 'zion',
      dealId: 10,
      stage: '',
      npcName: 'Marcus',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /stage required/i);
  });
});
