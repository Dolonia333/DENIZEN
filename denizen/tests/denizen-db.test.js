'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { DenizenDb, DISPLAY_TO_NPC_KEY } = require('../src/denizen-db.js');
const llmTelemetry = require('../src/llm-telemetry.js');

describe('denizen-db', () => {
  it('maps display names to npc_key folders', () => {
    assert.equal(DISPLAY_TO_NPC_KEY.lucy, 'lucy');
    assert.equal(DISPLAY_TO_NPC_KEY.marcus, 'conference_man');
    const db = new DenizenDb({ env: {} });
    assert.equal(db.npcKey('Lucy'), 'lucy');
    assert.equal(db.npcKey('Marcus'), 'conference_man');
  });

  it('is disabled without SUPABASE_URL', () => {
    const db = new DenizenDb({ env: { DENIZEN_DB_ENABLED: 'true' } });
    assert.equal(db.enabled, false);
  });

  it('init creates office session and boot fact', async () => {
    const calls = [];
    const orgId = '11111111-1111-1111-1111-111111111111';
    const sessionId = '22222222-2222-2222-2222-222222222222';

    global.fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes('denizen_organizations')) {
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => [{ id: orgId }] };
      }
      if (url.includes('denizen_office_sessions')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{ id: sessionId }],
        };
      }
      if (url.includes('rpc/denizen_record_fact')) {
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => 'fact-id' };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
        DENIZEN_ORG_SLUG: 'zion',
      },
    });

    const result = await db.init();
    assert.equal(result.ok, true);
    assert.equal(db.orgId, orgId);
    assert.equal(db.officeSessionId, sessionId);

    const factCall = calls.find((c) => c.url.includes('denizen_record_fact'));
    assert.ok(factCall, 'boot fact recorded');
    assert.equal(factCall.body.p_fact_type, 'office.started');

    delete global.fetch;
  });

  it('recordJobOutcome calls denizen_record_outcome RPC', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      if (url.includes('rpc/denizen_record_outcome')) {
        calls.push(JSON.parse(opts.body));
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => 'outcome-id' };
      }
      if (url.includes('rpc/denizen_record_fact')) {
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => 'fact-id' };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
      },
    });
    db.orgId = '11111111-1111-1111-1111-111111111111';
    db.enabled = true;

    db.recordJobOutcome('job-abc', 'interview', { site: 'linkedin', score: 8 });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].p_outcome_type, 'job.interview');
    assert.equal(calls[0].p_entity_key, 'job-abc');

    delete global.fetch;
  });

  it('llm-telemetry setDbSink forwards records', () => {
    const seen = [];
    llmTelemetry.setDbSink((rec) => seen.push(rec.id));
    const rec = llmTelemetry.record({ npc: 'Lucy', kind: 'think', provider: 'lmstudio' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0], rec.id);
    llmTelemetry.setDbSink(null);
  });
});
