'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const crmStore = require('../src/denizen-crm-store');
const denizenDb = require('../src/denizen-db');
const denizenVisitor = require('../src/denizen-visitor');
const { mountCrmRoutes } = require('../src/denizen-crm-routes');
const ingest = require('../src/denizen-crm-intake-ingest');

const TOKEN = 'test-token-not-a-real-secret';

function validBody(over = {}) {
  return {
    org_slug: 'zion',
    intake_id: 'intake-0001',
    business_name: 'Test Salon',
    business_type: 'salon or barber',
    contact_name: 'Pat Tester',
    contact_email: ' Pat@Example.TEST ',
    contact_phone: '555-0100',
    goals: 'get bookings',
    pages_wanted: ['Home', 'Services', 'Contact'],
    brand_notes: 'some logo',
    deadline: 'within a month',
    budget_range: 'not sure yet',
    source: 'dolonia.cloud',
    client_type: 'new',
    answers: { web_presence: 'none' },
    notes: 'fake data only',
    ...over,
  };
}

describe('POST /api/crm/intake-ingest', () => {
  let store;
  let upsertCalls;
  let origGet;
  let origUpsert;
  let origResolve;
  let origFetch;
  let origToken;
  let fetchCalls;
  let server;
  let port;

  async function post(body, headers = {}) {
    const res = await fetch(`http://127.0.0.1:${port}/api/crm/intake-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  const authed = { Authorization: `Bearer ${TOKEN}` };

  beforeEach(async () => {
    store = { state: {}, updated_at: '2026-01-01T00:00:00.000Z' };
    upsertCalls = [];
    origGet = crmStore.getWorkspace;
    origUpsert = crmStore.upsertWorkspace;
    origResolve = denizenVisitor.resolveOrgBySlug;
    origToken = process.env.INTAKE_INGEST_TOKEN;
    process.env.INTAKE_INGEST_TOKEN = TOKEN;

    crmStore.getWorkspace = async () => ({
      org_id: 'org-1', state: JSON.parse(JSON.stringify(store.state)), updated_at: store.updated_at,
    });
    crmStore.upsertWorkspace = async (_org, state, _id, opts) => {
      upsertCalls.push(opts);
      store.state = state;
      store.updated_at = new Date(Date.now() + upsertCalls.length * 1000).toISOString();
      return { org_id: 'org-1', state, updated_at: store.updated_at };
    };
    denizenVisitor.resolveOrgBySlug = async (slug) => (
      String(slug).toLowerCase() === 'zion' ? { id: 'org-1', slug: 'zion' } : null
    );

    // Any outbound HTTP made by the route fails the "no outbound" assertion.
    fetchCalls = [];
    origFetch = global.fetch;
    const realFetch = origFetch;
    global.fetch = (url, ...rest) => {
      if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, ...rest);
      fetchCalls.push(String(url));
      return Promise.reject(new Error('outbound blocked in test'));
    };

    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => { throw new Error('session auth must not be used'); },
      readJsonBody: async (req) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      },
      npcBrains: null,
      broadcastToOffice: null,
    });
    server = http.createServer(async (req, res) => { await handler(req, res); });
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(() => {
    server.close();
    crmStore.getWorkspace = origGet;
    crmStore.upsertWorkspace = origUpsert;
    denizenVisitor.resolveOrgBySlug = origResolve;
    global.fetch = origFetch;
    if (origToken === undefined) delete process.env.INTAKE_INGEST_TOKEN;
    else process.env.INTAKE_INGEST_TOKEN = origToken;
  });

  it('is listed in the route list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/crm/health`);
    const data = await res.json();
    assert.ok(data.routes.includes('POST /api/crm/intake-ingest'));
  });

  it('returns 401 without a token and with a wrong token', async () => {
    let r = await post(validBody());
    assert.equal(r.status, 401);
    r = await post(validBody(), { Authorization: 'Bearer wrong' });
    assert.equal(r.status, 401);
    r = await post(validBody(), { Authorization: TOKEN }); // no Bearer scheme
    assert.equal(r.status, 401);
    assert.equal(upsertCalls.length, 0);
    assert.ok(!JSON.stringify(r.data).includes(TOKEN));
  });

  it('returns 503 (fail closed) when INTAKE_INGEST_TOKEN is unset or blank', async () => {
    delete process.env.INTAKE_INGEST_TOKEN;
    let r = await post(validBody(), authed);
    assert.equal(r.status, 503);
    process.env.INTAKE_INGEST_TOKEN = '   ';
    r = await post(validBody(), { Authorization: 'Bearer ' });
    assert.equal(r.status, 503);
    assert.equal(upsertCalls.length, 0);
  });

  it('rejects client_type other than "new"', async () => {
    for (const ct of ['early', 'portfolio', '', undefined, 'New ']) {
      const body = validBody({ client_type: ct });
      if (ct === undefined) delete body.client_type;
      const r = await post(body, authed);
      assert.equal(r.status, 400, `client_type=${String(ct)}`);
    }
    assert.equal(upsertCalls.length, 0);
  });

  it('rejects a bad email, missing intake_id, missing business_name, unknown org', async () => {
    assert.equal((await post(validBody({ contact_email: 'not-an-email' }), authed)).status, 400);
    assert.equal((await post(validBody({ contact_email: '' }), authed)).status, 400);
    assert.equal((await post(validBody({ intake_id: '' }), authed)).status, 400);
    assert.equal((await post(validBody({ intake_id: 'bad id!' }), authed)).status, 400);
    assert.equal((await post(validBody({ business_name: ' ' }), authed)).status, 400);
    assert.equal((await post(validBody({ org_slug: '' }), authed)).status, 400);
    assert.equal((await post(validBody({ org_slug: 'nope' }), authed)).status, 404);
    assert.equal(upsertCalls.length, 0);
  });

  it('happy path creates company, contact, deal, task and note in one save', async () => {
    const r = await post(validBody(), authed);
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.duplicate, false);
    assert.equal(upsertCalls.length, 1, 'single workspace update');
    assert.equal(upsertCalls[0].skipAutomations, true);
    assert.equal(upsertCalls[0].skipWebhooks, true);
    assert.ok(upsertCalls[0].ifUpdatedAt);

    const s = store.state;
    assert.equal(s.companies.length, 1);
    assert.equal(s.contacts.length, 1);
    assert.equal(s.deals.length, 1);
    assert.equal(s.tasks.length, 1);
    assert.equal(s.notes.length, 1);

    const [company] = s.companies;
    const [contact] = s.contacts;
    const [deal] = s.deals;
    const [task] = s.tasks;
    assert.equal(r.data.company_id, company.id);
    assert.equal(r.data.contact_id, contact.id);
    assert.equal(r.data.deal_id, deal.id);
    assert.equal(r.data.task_id, task.id);

    assert.equal(contact.email, 'pat@example.test');
    assert.ok(contact.tags.includes('client_type=new'));
    assert.equal(contact.leadSource, 'dolonia.cloud');
    assert.equal(deal.title, 'Test Salon website intake');
    assert.equal(deal.stage, 'New Intake');
    assert.equal(deal.value, 0);
    assert.match(deal.notes, /Budget range: not sure yet/);
    assert.match(deal.notes, /Deadline: within a month/);
    assert.equal(deal.contactId, contact.id);
    assert.equal(deal.companyId, company.id);
    assert.ok(company.linkedContacts.includes(contact.id));
    assert.ok(company.linkedDeals.includes(deal.id));
    assert.equal(task.title, 'Review intake and send quote');
    assert.equal(task.dealId, deal.id);
    assert.match(task.due, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(s.notes[0].text, /web_presence: none/);
    assert.match(s.notes[0].text, /Pages wanted: Home, Services, Contact/);
    assert.ok(s.auditLog.some((a) => a.entity === 'intake'));
    assert.equal(fetchCalls.length, 0);
  });

  it('retry with the same email + intake_id is idempotent', async () => {
    const first = await post(validBody(), authed);
    const snapshot = JSON.stringify(store.state);
    const retry = await post(validBody({ contact_email: 'PAT@example.test' }), authed);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.duplicate, true);
    assert.equal(retry.data.contact_id, first.data.contact_id);
    assert.equal(retry.data.company_id, first.data.company_id);
    assert.equal(retry.data.deal_id, first.data.deal_id);
    assert.equal(retry.data.task_id, first.data.task_id);
    assert.equal(upsertCalls.length, 1, 'no second save');
    assert.equal(JSON.stringify(store.state), snapshot);
  });

  it('ingest-created contact (by lowercased email) is reused on a new intake_id; adds deal, task and note only', async () => {
    const first = await post(validBody(), authed);
    assert.equal(first.status, 200);
    const second = await post(validBody({ intake_id: 'intake-0002', contact_email: 'PAT@example.test' }), authed);
    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, false);
    assert.equal(second.data.contact_id, first.data.contact_id);
    assert.equal(second.data.company_id, first.data.company_id);
    assert.notEqual(second.data.deal_id, first.data.deal_id);
    assert.notEqual(second.data.task_id, first.data.task_id);
    assert.equal(store.state.contacts.length, 1);
    assert.equal(store.state.companies.length, 1);
    assert.equal(store.state.deals.length, 2);
    assert.equal(store.state.tasks.length, 2);
    assert.equal(store.state.notes.length, 2);
    assert.deepEqual(store.state.companies[0].linkedContacts, [first.data.contact_id]);
    assert.equal(store.state.companies[0].linkedDeals.length, 2);
    // Retries of either intake stay idempotent.
    const retry1 = await post(validBody(), authed);
    const retry2 = await post(validBody({ intake_id: 'intake-0002' }), authed);
    assert.equal(retry1.data.duplicate, true);
    assert.equal(retry1.data.deal_id, first.data.deal_id);
    assert.equal(retry2.data.duplicate, true);
    assert.equal(retry2.data.deal_id, second.data.deal_id);
    assert.equal(store.state.deals.length, 2);
  });

  it('existing UNTAGGED contact by email -> 409 existing_record_needs_review (contact), state unchanged', async () => {
    store.state = {
      companies: [{ id: 7, name: 'Someone Else LLC', linkedContacts: [], linkedDeals: [] }],
      contacts: [{ id: 3, name: 'Pat T.', email: 'PAT@example.test', company: 'Someone Else LLC', tags: [] }],
      deals: [{ id: 9, title: 'Other', stage: 'Lead', value: 500 }],
      tasks: [],
      notes: [],
    };
    const snapshot = JSON.stringify(store.state);
    const r = await post(validBody(), authed);
    assert.equal(r.status, 409);
    assert.deepEqual(r.data, { ok: false, error: 'existing_record_needs_review', reason: 'contact' });
    assert.equal(upsertCalls.length, 0);
    assert.equal(JSON.stringify(store.state), snapshot);
  });

  it('existing contact tagged client_type=new but NOT created by ingest is still refused', async () => {
    store.state = {
      contacts: [{
        id: 3, name: 'Pat', email: 'pat@example.test', tags: ['client_type=new'], clientType: 'new',
      }],
    };
    const snapshot = JSON.stringify(store.state);
    const r = await post(validBody(), authed);
    assert.equal(r.status, 409);
    assert.equal(r.data.reason, 'contact');
    assert.equal(JSON.stringify(store.state), snapshot);
  });

  it('existing UNTAGGED company by name -> 409 existing_record_needs_review (company), state unchanged', async () => {
    store.state = {
      companies: [{ id: 7, name: 'TEST salon', linkedContacts: [], linkedDeals: [] }],
      contacts: [{ id: 3, name: 'Other', email: 'other@example.test', tags: [] }],
      deals: [],
      tasks: [],
      notes: [],
    };
    const snapshot = JSON.stringify(store.state);
    const r = await post(validBody(), authed);
    assert.equal(r.status, 409);
    assert.deepEqual(r.data, { ok: false, error: 'existing_record_needs_review', reason: 'company' });
    assert.equal(upsertCalls.length, 0);
    assert.equal(JSON.stringify(store.state), snapshot);
  });

  it('ingest-created company is reused by a different contact with the same business name', async () => {
    const first = await post(validBody(), authed);
    const r = await post(validBody({
      intake_id: 'intake-0009', contact_email: 'second@example.test', contact_name: 'Second',
    }), authed);
    assert.equal(r.status, 200);
    assert.equal(r.data.company_id, first.data.company_id);
    assert.notEqual(r.data.contact_id, first.data.contact_id);
    assert.equal(store.state.companies.length, 1);
    assert.equal(store.state.contacts.length, 2);
  });

  it('records created by ingest carry the intake-ingest origin marker', async () => {
    await post(validBody(), authed);
    assert.equal(store.state.contacts[0].intakeOrigin, 'intake-ingest');
    assert.equal(store.state.companies[0].intakeOrigin, 'intake-ingest');
  });

  it('retries on conflict (reloading) and gives up after 3 attempts', async () => {
    let n = 0;
    crmStore.upsertWorkspace = async (_o, state) => {
      n += 1;
      if (n < 3) return { conflict: true, state: {}, updated_at: 'x' };
      store.state = state;
      return { org_id: 'org-1', state };
    };
    let r = await post(validBody(), authed);
    assert.equal(r.status, 200);
    assert.equal(n, 3);

    n = -100;
    crmStore.upsertWorkspace = async () => { n += 1; return { conflict: true }; };
    r = await post(validBody({ intake_id: 'intake-0003' }), authed);
    assert.equal(r.status, 409);
    assert.equal(n, -97);
  });

  it('503 when storage is unavailable', async () => {
    crmStore.upsertWorkspace = async () => null;
    const r = await post(validBody(), authed);
    assert.equal(r.status, 503);
  });

  it('concurrent calls produce unique ids (no duplicate-id bug)', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => post(
      validBody({ intake_id: `par-${i}`, contact_email: `p${i}@example.test`, business_name: `Biz ${i}` }),
      authed,
    )));
    results.forEach((r) => assert.equal(r.status, 200));
    for (const key of ['contacts', 'companies', 'deals', 'tasks', 'notes']) {
      const ids = store.state[key].map((x) => x.id);
      assert.equal(ids.length, 5, key);
      assert.equal(new Set(ids).size, 5, `${key} ids unique`);
    }
  });

  it('makes no outbound calls even when the workspace has webhooks and email automations', async () => {
    // Use the REAL store save path with a mocked DB layer.
    crmStore.getWorkspace = origGet;
    crmStore.upsertWorkspace = origUpsert;
    const origEnabled = denizenDb.enabled;
    const origDbGet = denizenDb._get;
    const origDbPost = denizenDb._post;
    let saved = null;
    const wsState = {
      integrations: { outboundWebhooks: { contact_added: 'https://hooks.example.test/contact' } },
      automations: [{
        id: 1, active: true, trigger: 'contact_added', action: 'draft_email', actionDetail: 'Hi',
      }],
      contacts: [], deals: [],
    };
    denizenDb.enabled = true;
    denizenDb._get = async () => [{
      org_id: 'org-1', state: wsState, schema_version: 1, updated_at: '2026-01-01T00:00:00.000Z',
    }];
    denizenDb._post = async (p, row) => {
      if (String(p).startsWith('denizen_crm_workspaces')) saved = row;
      return [row];
    };
    try {
      const r = await post(validBody(), authed);
      assert.equal(r.status, 200);
      assert.ok(saved, 'workspace saved');
      assert.equal(saved.state.contacts.length, 1);
      assert.equal((saved.state.emailLog || []).length, 0, 'no email logged/sent');
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Internal Supabase REST bookkeeping (portal-token index) is not a message.
      const outbound = fetchCalls.filter((u) => !u.startsWith('/rest/v1/'));
      assert.deepEqual(outbound, [], 'no outbound HTTP (webhooks/email)');
    } finally {
      denizenDb.enabled = origEnabled;
      denizenDb._get = origDbGet;
      denizenDb._post = origDbPost;
    }
  });
});

describe('denizen-crm-intake-ingest helpers', () => {
  it('addBusinessDays skips weekends', () => {
    // Fri 2026-10-23 + 2 business days = Tue 2026-10-27
    assert.equal(ingest.addBusinessDays(new Date('2026-10-23T12:00:00Z'), 2), '2026-10-27');
    // Mon 2026-10-26 + 2 = Wed 2026-10-28
    assert.equal(ingest.addBusinessDays(new Date('2026-10-26T12:00:00Z'), 2), '2026-10-28');
    // Sat 2026-10-24 + 2 = Tue 2026-10-27
    assert.equal(ingest.addBusinessDays(new Date('2026-10-24T12:00:00Z'), 2), '2026-10-27');
  });

  it('tokenMatches is exact and Bearer-only', () => {
    process.env.INTAKE_INGEST_TOKEN = 'abc';
    try {
      assert.equal(ingest.tokenMatches('Bearer abc'), true);
      assert.equal(ingest.tokenMatches('bearer abc'), true);
      assert.equal(ingest.tokenMatches('Bearer abcd'), false);
      assert.equal(ingest.tokenMatches('Bearer ab'), false);
      assert.equal(ingest.tokenMatches('abc'), false);
      assert.equal(ingest.tokenMatches(undefined), false);
    } finally {
      delete process.env.INTAKE_INGEST_TOKEN;
    }
  });
});
