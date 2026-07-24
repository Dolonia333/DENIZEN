'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const orgPolicy = require('../src/denizen-org-policy');
const crmStore = require('../src/denizen-crm-store');
const crmCapture = require('../src/denizen-crm-capture');

describe('denizen-crm-capture', () => {
  let origGet;
  let origUpsert;
  let origResolve;
  let store;
  let visitor;

  beforeEach(() => {
    orgPolicy.clearOrgPolicyCache();
    store = {
      state: {
        contacts: [{ id: 1, name: 'OK.gov', email: 'buyer@ok.gov', company: 'OK.gov' }],
        deals: [{ id: 7, title: 'OMES EV00000919', stage: 'Qualified', value: 50000, contact: 'OK.gov' }],
        notes: [],
        tasks: [],
        auditLog: [],
        emailLog: [],
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
      return null;
    };
  });

  afterEach(() => {
    crmStore.getWorkspace = origGet;
    crmStore.upsertWorkspace = origUpsert;
    if (visitor && origResolve) visitor.resolveOrgBySlug = origResolve;
    orgPolicy.clearOrgPolicyCache();
  });

  it('parseRelativeDue understands Friday / tomorrow', () => {
    assert.ok(crmCapture.parseRelativeDue('follow up Friday'));
    assert.ok(crmCapture.parseRelativeDue('call tomorrow'));
  });

  it('extractWho finds talked-to target', () => {
    assert.equal(
      crmCapture.extractWho('I talked to OK.gov about the OMES bid, follow up Friday'),
      'OK.gov',
    );
  });

  it('proposeCaptureActions returns confirm_capture', () => {
    const actions = crmCapture.proposeCaptureActions(
      'I talked to OK.gov about the OMES bid, follow up Friday',
      { openDealCount: 1 },
    );
    assert.ok(actions.some((a) => a.type === 'confirm_capture'));
    assert.ok(actions.some((a) => a.type === 'confirm_task'));
  });

  it('runCapture logs note + follow-up task for Angela-style speech', async () => {
    const result = await crmCapture.runCapture({
      orgSlug: 'zion',
      orgId: 'org-1',
      npcName: 'Molly',
      message: 'I talked to OK.gov about the OMES bid, follow up Friday',
    });
    assert.equal(result.ok, true);
    assert.match(result.summary, /Logged note|Added task|Follow up/i);
    assert.ok(store.state.notes.length >= 1);
    assert.ok(store.state.tasks.length >= 1);
    assert.equal(result.contact?.name, 'OK.gov');
  });

  it('runCapture fails closed for acme demo org', async () => {
    const result = await crmCapture.runCapture({
      orgSlug: 'acme',
      orgId: 'org-acme',
      npcName: 'Lucy',
      message: 'I talked to someone about a deal',
    });
    assert.equal(result.ok, false);
  });

  it('parseRelativeDue ignores historical ISO dates without due language', () => {
    assert.equal(
      crmCapture.parseRelativeDue('Correct OMES deadline was 2026-06-11, not 2026-10-01'),
      null,
    );
  });

  it('EDIT/correction commands do not create notes or tasks', async () => {
    store.state.notes.push({
      id: 99,
      contact: 'OMES EV00000919',
      dealId: 7,
      text: 'EXECUTE CRM CORRECTIONS, NOT JUST A SUMMARY. Correct OMES EV00000919 to expired.',
      type: 'agent-note',
    });
    store.state.tasks.push({
      id: 55,
      title: 'Follow up — OMES EV00000919',
      due: '2026-06-11',
      done: false,
    });
    const beforeNotes = store.state.notes.length;
    const beforeTasks = store.state.tasks.length;

    const result = await crmCapture.runCapture({
      orgSlug: 'zion',
      orgId: 'org-1',
      npcName: 'Molly',
      message:
        'EDIT: EXECUTE CRM CORRECTIONS. Correct OMES EV00000919 to expired/needs correction '
        + 'with verified deadline 2026-06-11; detach instruction notes; close false follow-up tasks; '
        + 'no invented monetary value.',
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'edit');
    assert.equal(result.created?.length || 0, 0);
    assert.ok(store.state.notes.length <= beforeNotes);
    assert.ok(!store.state.notes.some((n) => /EDIT: EXECUTE CRM CORRECTIONS/i.test(String(n.text || ''))));
    assert.ok(store.state.tasks.every((t) => t.id !== 55 || t.done === true));
    const omes = store.state.deals.find((d) => d.id === 7);
    assert.ok(omes);
    assert.match(String(omes.stage || ''), /expired|needs correction/i);
    assert.equal(Number(omes.value) || 0, 0);
    assert.equal(omes.deadline, '2026-06-11');
    assert.ok(beforeTasks >= 1);
  });

  it('buildMyDay returns due tasks and notes', () => {
    store.state.notes.push({
      id: 9,
      contact: 'OK.gov',
      text: 'Called about OMES',
      date: new Date().toISOString().slice(0, 10),
      type: 'agent-note',
      author: 'Molly',
    });
    store.state.tasks.push({
      id: 3,
      title: 'Follow up with OK.gov',
      due: new Date().toISOString().slice(0, 10),
      done: false,
    });
    const day = crmCapture.buildMyDay(store.state, { user: 'angela', hours: 168 });
    assert.ok(day.dueTasks.length >= 1);
    assert.ok(day.items.some((i) => i.kind === 'note'));
  });
});
