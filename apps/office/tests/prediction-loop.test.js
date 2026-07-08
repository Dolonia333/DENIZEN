'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { DenizenDb } = require('../src/intelligence/denizen-db.js');
const {
  runPredictionMaintenance,
  getPredictionSummary,
  recordPrediction,
} = require('../src/intelligence/denizen-prediction-loop.js');

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const PRED_ID = '22222222-2222-2222-2222-222222222222';
const ENTITY_ID = '33333333-3333-3333-3333-333333333333';
const OUTCOME_ID = '44444444-4444-4444-4444-444444444444';

describe('denizen-prediction-loop', () => {
  let calls;

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('getPredictionSummary aggregates totals and byType', async () => {
    global.fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET' });
      if (url.includes('denizen_predictions')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [
            {
              prediction_type: 'intake.close_probability',
              accuracy_score: 0.8,
              validated_at: '2026-06-01T00:00:00.000Z',
            },
            {
              prediction_type: 'intake.close_probability',
              accuracy_score: 0.6,
              validated_at: '2026-06-02T00:00:00.000Z',
            },
            {
              prediction_type: 'rfp.bid_probability',
              accuracy_score: null,
              validated_at: null,
            },
          ],
        };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
      },
    });
    db.enabled = true;

    const summary = await getPredictionSummary(ORG_ID, db);
    assert.equal(summary.total, 3);
    assert.equal(summary.validated, 2);
    assert.equal(summary.avgAccuracy, 0.7);
    assert.equal(summary.byType['intake.close_probability'].total, 2);
    assert.equal(summary.byType['intake.close_probability'].validated, 2);
    assert.equal(summary.byType['intake.close_probability'].avgAccuracy, 0.7);
    assert.equal(summary.byType['rfp.bid_probability'].total, 1);
    assert.equal(summary.byType['rfp.bid_probability'].validated, 0);
    assert.equal(summary.byType['rfp.bid_probability'].avgAccuracy, null);

    const getCall = calls.find((c) => c.url.includes('denizen_predictions'));
    assert.ok(getCall);
    assert.match(getCall.url, new RegExp(`org_id=eq\\.${ORG_ID}`));

    delete global.fetch;
  });

  it('runPredictionMaintenance marks prediction validated when outcome exists', async () => {
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });

      if (url.includes('denizen_predictions') && method === 'GET' && url.includes('validated_at=is.null')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: PRED_ID,
            entity_type: 'intake',
            entity_id: ENTITY_ID,
            entity_key: null,
            prediction_type: 'intake.close_probability',
            prediction: { close_probability: 0.75 },
            confidence: 0.75,
          }],
        };
      }

      if (url.includes('denizen_outcomes') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: OUTCOME_ID,
            outcome_type: 'intake.converted',
          }],
        };
      }

      if (url.includes('denizen_predictions') && method === 'PATCH') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => null,
        };
      }

      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
      },
    });
    db.enabled = true;
    db.orgId = ORG_ID;

    const result = await runPredictionMaintenance(db);
    assert.equal(result.updated, 1);

    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('denizen_predictions'));
    assert.ok(patchCall, 'prediction patched as validated');
    assert.equal(patchCall.body.actual_outcome_id, OUTCOME_ID);
    assert.equal(patchCall.body.accuracy_score, 0.75);
    assert.ok(patchCall.body.validated_at);

    delete global.fetch;
  });

  it('runPredictionMaintenance supports lead.close_probability predictions', async () => {
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });

      if (url.includes('denizen_predictions') && method === 'GET' && url.includes('validated_at=is.null')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: PRED_ID,
            entity_type: 'lead',
            entity_id: ENTITY_ID,
            entity_key: null,
            prediction_type: 'lead.close_probability',
            prediction: { close_probability: 0.82 },
            confidence: 0.82,
          }],
        };
      }

      if (url.includes('denizen_outcomes') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{
            id: OUTCOME_ID,
            outcome_type: 'lead.converted',
          }],
        };
      }

      if (url.includes('denizen_predictions') && method === 'PATCH') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => null,
        };
      }

      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const db = new DenizenDb({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'test-key',
      },
    });
    db.enabled = true;
    db.orgId = ORG_ID;

    const result = await runPredictionMaintenance(db);
    assert.equal(result.updated, 1);

    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('denizen_predictions'));
    assert.ok(patchCall, 'lead prediction patched as validated');
    assert.equal(patchCall.body.accuracy_score, 0.82);
    delete global.fetch;
  });

  it('recordPrediction writes via db.insertPrediction helper', async () => {
    const db = {
      enabled: true,
      orgId: ORG_ID,
      insertPrediction: async (payload) => ({
        id: 'pred-app-1',
        ...payload,
      }),
    };
    const row = await recordPrediction(db, {
      predictionType: 'lead.close_probability',
      entityType: 'lead',
      entityId: ENTITY_ID,
      prediction: { close_probability: 0.64 },
      confidence: 0.64,
      metadata: { source: 'unit-test' },
    });
    assert.equal(row.id, 'pred-app-1');
    assert.equal(row.predictionType, 'lead.close_probability');
  });
});
