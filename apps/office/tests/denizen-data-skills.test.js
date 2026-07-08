'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { resolveAction, runAction } = require('../jelly/lib/denizen-data-actions');

describe('denizen-data-actions', () => {
  let calls;

  before(() => {
    calls = [];
    const bridge = require('../jelly/lib/bridge-client');

    bridge.bridgeQuery = async (config, q) => {
      calls.push({ op: 'query', table: q.table, filters: q.filters });
      if (q.table === 'denizen_organizations') return [{ id: 'org-1' }];
      if (q.table === 'intake_forms') return [{ id: 'i1', company_name: 'Acme', priority_score: 90, status: 'new' }];
      if (q.table === 'rfps') {
        return [{
          id: 'rfp-1',
          title: 'USAF Data Platform',
          agency: 'USAF',
          status: 'in_review',
          proposal_due_date: '2099-06-20T00:00:00.000Z',
          estimated_value_max: 800000,
        }];
      }
      if (q.table === 'rfp_requirements') {
        return [{
          id: 'req-1',
          rfp_id: 'rfp-1',
          requirement_type: 'mandatory',
          status: 'open',
        }];
      }
      if (q.table === 'denizen_predictions') return [{ prediction_type: 'intake.close_probability', confidence: 0.7, prediction: { close_probability: 0.7 } }];
      if (q.table === 'denizen_outcomes') return [{ outcome_type: 'intake.converted', observed_at: new Date().toISOString() }];
      if (q.table === 'denizen_work_output') return [{ npc_key: 'pier', note: 'test' }];
      return [];
    };
    bridge.bridgeInsert = async (config, body) => {
      calls.push({ op: 'insert', table: body.table, rows: body.rows });
      return { ok: true };
    };
    bridge.bridgeUpdate = async () => ({ ok: true });
    bridge.bridgeHealth = async () => ({ ok: true });
  });

  it('resolves skill name as action', () => {
    assert.equal(resolveAction('intake-triage', {}), 'intake-triage');
    assert.equal(resolveAction('denizen-data', { action: 'lead-monitor' }), 'lead-monitor');
  });

  it('intake-triage returns summary', async () => {
    const r = await runAction('intake-triage', { npcName: 'Lucy', params: {}, config: {} });
    assert.match(r.summary, /intake/i);
    assert.ok(r.intakes.length >= 1);
  });

  it('entity-link inserts link and fact', async () => {
    const r = await runAction('entity-link', {
      npcName: 'Lucy',
      params: { entity_type: 'intake_form', entity_id: 'i1', note: 'reviewed' },
      config: {},
    });
    assert.match(r.summary, /Linked/);
    assert.equal(calls.filter((c) => c.op === 'insert').length, 2);
  });

  it('prediction-brief returns accuracy summary', async () => {
    const bridge = require('../jelly/lib/bridge-client');
    bridge.bridgeQuery = async (config, q) => {
      if (q.table === 'denizen_organizations') return [{ id: 'org-1' }];
      if (q.table === 'denizen_predictions' && q.select.includes('id')) {
        return [{
          id: 'p1',
          prediction_type: 'lead.close_probability',
          entity_type: 'lead',
          entity_id: 'lead-1',
          confidence: 0.7,
          prediction: { close_probability: 0.7 },
          validated_at: null,
          accuracy_score: null,
          created_at: new Date().toISOString(),
        }];
      }
      if (q.table === 'denizen_predictions' && q.select.includes('accuracy_score')) {
        return [
          { accuracy_score: 0.8, validated_at: '2026-01-01' },
          { accuracy_score: 0.6, validated_at: '2026-01-02' },
          { accuracy_score: null, validated_at: null },
        ];
      }
      return [];
    };
    const r = await runAction('prediction-brief', {
      npcName: 'Lucy',
      params: { entity_type: 'lead', entity_id: 'lead-1' },
      config: {},
    });
    assert.equal(r.accuracy_summary.validated, 2);
    assert.equal(r.accuracy_summary.avg_accuracy, 0.7);
    assert.match(r.summary, /benchmark/i);
  });

  it('org-benchmark aggregates validated predictions', async () => {
    const bridge = require('../jelly/lib/bridge-client');
    bridge.bridgeQuery = async (config, q) => {
      if (q.table === 'denizen_predictions') {
        return [
          { prediction_type: 'intake.close_probability', accuracy_score: 0.8, validated_at: '2026-01-01' },
          { prediction_type: 'intake.close_probability', accuracy_score: 0.6, validated_at: '2026-01-02' },
        ];
      }
      return [];
    };
    const r = await runAction('org-benchmark', { npcName: 'Pier', params: {}, config: {} });
    assert.equal(r.benchmark['intake.close_probability'].count, 2);
    assert.equal(r.benchmark['intake.close_probability'].avg_accuracy, 0.7);
  });

  it('rfp-pipeline-summary returns status and value metrics', async () => {
    const bridge = require('../jelly/lib/bridge-client');
    bridge.bridgeQuery = async (config, q) => {
      if (q.table === 'rfps') {
        return [{
          id: 'rfp-1',
          title: 'USAF Data Platform',
          agency: 'USAF',
          status: 'in_review',
          proposal_due_date: '2099-06-20T00:00:00.000Z',
          estimated_value_max: 800000,
        }];
      }
      return [];
    };
    const r = await runAction('rfp-pipeline-summary', { npcName: 'Pier', params: {}, config: {} });
    assert.equal(r.total_rfps, 1);
    assert.equal(r.total_pipeline_value, 800000);
    assert.equal(r.counts_by_status.in_review, 1);
  });
});

describe('denizen-data skill registry', () => {
  it('registers all action aliases', () => {
    const { discoverNativeSkills } = require('../jelly/skill-registry');
    const registry = discoverNativeSkills(require('node:path').join(__dirname, '..', 'jelly', 'skills'));
    assert.ok(registry.has('denizen-data'));
    assert.ok(registry.has('intake-triage'));
    assert.ok(registry.has('outcome-standup'));
    assert.ok(registry.has('visitor-claim'));
  });
});
