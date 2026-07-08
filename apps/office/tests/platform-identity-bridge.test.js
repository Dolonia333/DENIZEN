'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('platform identity bridge — job CRM DB sync', () => {
  let calls;
  let denizenDb;
  let jobCrm;

  beforeEach(() => {
    calls = [];
    delete require.cache[require.resolve('../src/intelligence/denizen-db.js')];
    delete require.cache[require.resolve('../src/pipelines/job-crm.js')];
    denizenDb = require('../src/intelligence/denizen-db.js');
    denizenDb.enabled = true;
    denizenDb.orgId = '11111111-1111-1111-1111-111111111111';
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => (method === 'GET' ? [] : null),
      };
    };

    jobCrm = require('../src/pipelines/job-crm.js');
  });

  afterEach(() => {
    delete global.fetch;
  });

  async function flushDbQueue() {
    for (let i = 0; i < 30; i++) {
      await denizenDb._drain();
      if (!denizenDb._queue.length && !denizenDb._draining) break;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it('syncJobApplication posts new row with org_id and npc_key roki', async () => {
    denizenDb.syncJobApplication({
      id: 'app-1',
      company: 'Acme',
      role: 'Engineer',
      status: 'applied',
      score: 8,
      site: 'linkedin',
    });
    await flushDbQueue();
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_job_applications'));
    assert.ok(post, 'POST denizen_job_applications');
    assert.equal(post.body.id, 'app-1');
    assert.equal(post.body.org_id, denizenDb.orgId);
    assert.equal(post.body.npc_key, 'roki');
    assert.equal(post.body.company, 'Acme');
  });

  it('upsertApplication triggers DB sync', async () => {
    let syncedApp = null;
    const origSync = denizenDb.syncJobApplication.bind(denizenDb);
    denizenDb.syncJobApplication = (app, opts) => {
      syncedApp = app;
      return origSync(app, opts);
    };

    const store = { applications: [], referrals: [] };
    const merged = jobCrm.upsertApplication(store, {
      id: 'app-2',
      company: 'Beta Corp',
      role: 'PM',
      status: 'new',
      score: 7,
    });
    assert.equal(merged.id, 'app-2');
    assert.ok(syncedApp, 'upsertApplication invoked syncJobApplication');
    assert.equal(syncedApp.id, 'app-2');
    await flushDbQueue();
    const wrote = calls.some((c) => c.url.includes('denizen_job_applications'));
    assert.ok(wrote, 'wrote to denizen_job_applications');
  });
});

describe('platform identity bridge — migration markers', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  it('migrations 000012 + 000013 define expected schema changes', () => {
    const sql12 = fs.readFileSync(
      path.join(__dirname, '../supabase/migrations/20260606000012_platform_identity_bridge.sql'),
      'utf8',
    );
    const sql13 = fs.readFileSync(
      path.join(__dirname, '../supabase/migrations/20260606000013_platform_tables_admin.sql'),
      'utf8',
    );
    const sql = `${sql12}\n${sql13}`;
    assert.match(sql, /client_appointments[\s\S]*client_id/);
    assert.match(sql, /subscriptions[\s\S]*org_id/);
    assert.match(sql, /denizen_job_applications[\s\S]*session_id/);
    assert.match(sql, /documents_agent_id_fkey/);
    assert.match(sql, /room_bookings_booked_by_fkey[\s\S]*profiles/);
    assert.match(sql, /denizen_trg_job_applications/);
    assert.match(sql, /denizen_user_can_access_org/);
    assert.match(sql, /leads_status_org_idx/);
  });
});
