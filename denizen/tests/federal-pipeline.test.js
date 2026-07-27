'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getRfpPipelineSummary, getRfpDetail } = require('../src/federal-pipeline.js');

const ORG = 'org-zion';

function createMockDenizenDb() {
  const paths = [];
  return {
    paths,
    async _get(path) {
      paths.push(path);
      if (path.startsWith('rfps?')) {
        if (path.includes('id=eq.rfp-1')) {
          return [{
            id: 'rfp-1',
            title: 'USAF Data Platform',
            agency: 'USAF',
            solicitation_number: 'FA-123',
            status: 'in_review',
            bid_decision: 'bid',
            proposal_due_date: '2099-06-20T00:00:00.000Z',
            estimated_value_max: 800000,
          }];
        }
        return [
          {
            id: 'rfp-1',
            title: 'USAF Data Platform',
            agency: 'USAF',
            status: 'in_review',
            proposal_due_date: '2099-06-20T00:00:00.000Z',
            estimated_value_max: 800000,
          },
          {
            id: 'rfp-2',
            title: 'VA Analytics',
            agency: 'VA',
            status: 'draft',
            proposal_due_date: '2099-06-15T00:00:00.000Z',
            estimated_value_max: 500000,
          },
        ];
      }
      if (path.startsWith('rfp_requirements?')) {
        return [
          {
            id: 'req-1',
            rfp_id: 'rfp-1',
            section_reference: 'L.2',
            requirement_type: 'mandatory',
            priority: 'must',
            risk_level: 'high',
            status: 'open',
            requirement_text: 'Provide facility clearance proof',
          },
          {
            id: 'req-2',
            rfp_id: 'rfp-1',
            section_reference: 'M.1',
            requirement_type: 'technical',
            priority: 'high',
            risk_level: 'medium',
            status: 'completed',
            requirement_text: 'Architecture narrative',
          },
        ];
      }
      if (path.startsWith('denizen_predictions?')) {
        return [{
          entity_id: 'rfp-1',
          prediction: { bid_probability: 0.74 },
          confidence: 0.74,
          created_at: '2099-06-10T00:00:00.000Z',
        }];
      }
      return [];
    },
  };
}

describe('federal-pipeline', () => {
  it('computes pipeline summary counts, value, and due dates', async () => {
    const summary = await getRfpPipelineSummary(createMockDenizenDb(), { orgId: ORG });
    assert.equal(summary.total_rfps, 2);
    assert.equal(summary.counts_by_status.in_review, 1);
    assert.equal(summary.counts_by_status.draft, 1);
    assert.equal(summary.total_pipeline_value, 1300000);
    assert.equal(summary.next_due_dates.length, 2);
  });

  it('builds per-RFP detail metrics and unmet mandatory requirements', async () => {
    const detail = await getRfpDetail(createMockDenizenDb(), 'rfp-1', { orgId: ORG });
    assert.equal(detail.id, 'rfp-1');
    assert.equal(detail.bid_probability, 0.74);
    assert.equal(detail.requirement_counts.total, 2);
    assert.equal(detail.requirement_counts.completed, 1);
    assert.equal(detail.requirement_completion_pct, 50);
    assert.equal(detail.unmet_mandatory_requirements.length, 1);
    assert.match(detail.unmet_mandatory_requirements[0].requirement_text, /clearance/i);
  });
});

// Dossier defect G#5. These assert on the emitted PostgREST query, not on the
// mock's return value — a mock that ignores filters would otherwise let an
// unscoped read pass a return-value-only assertion.
describe('federal-pipeline org scoping (G#5)', () => {
  it('scopes the pipeline summary read to the caller org', async () => {
    const db = createMockDenizenDb();
    await getRfpPipelineSummary(db, { orgId: ORG });
    const rfpQuery = db.paths.find((p) => p.startsWith('rfps?'));
    assert.ok(rfpQuery, 'expected an rfps query');
    assert.match(rfpQuery, /org_id=eq\.org-zion/);
  });

  it('scopes the detail read by org as well as id', async () => {
    const db = createMockDenizenDb();
    await getRfpDetail(db, 'rfp-1', { orgId: ORG });
    const rfpQuery = db.paths.find((p) => p.startsWith('rfps?'));
    assert.match(rfpQuery, /id=eq\.rfp-1/);
    assert.match(rfpQuery, /org_id=eq\.org-zion/);
  });

  it('scopes the prediction lookup to the caller org', async () => {
    const db = createMockDenizenDb();
    await getRfpDetail(db, 'rfp-1', { orgId: ORG });
    const predictionQuery = db.paths.find((p) => p.startsWith('denizen_predictions?'));
    assert.ok(predictionQuery, 'expected a predictions query');
    assert.match(predictionQuery, /org_id=eq\.org-zion/);
  });

  for (const [label, orgId] of [['missing', undefined], ['null', null], ['blank', '   ']]) {
    it(`refuses to read the summary with a ${label} orgId`, async () => {
      const db = createMockDenizenDb();
      await assert.rejects(
        () => getRfpPipelineSummary(db, { orgId }),
        (err) => err.code === 'ORG_ID_REQUIRED',
      );
      assert.equal(db.paths.length, 0, 'must not reach the database at all');
    });

    it(`refuses to read detail with a ${label} orgId`, async () => {
      const db = createMockDenizenDb();
      await assert.rejects(
        () => getRfpDetail(db, 'rfp-1', { orgId }),
        (err) => err.code === 'ORG_ID_REQUIRED',
      );
      assert.equal(db.paths.length, 0, 'must not reach the database at all');
    });
  }

  it('refuses the legacy unscoped call signature', async () => {
    const db = createMockDenizenDb();
    await assert.rejects(
      () => getRfpPipelineSummary(db),
      (err) => err.code === 'ORG_ID_REQUIRED',
    );
  });

  it('fails closed when the org_id column is absent (migration ...0005 skipped)', async () => {
    // PostgREST answers an unknown-column filter with a 400. The old code had
    // no filter to reject; the fix must surface this rather than retry wide.
    const db = {
      async _get(path) {
        if (path.startsWith('rfps?')) throw new Error(`GET ${path} → HTTP 400`);
        return [];
      },
    };
    await assert.rejects(
      () => getRfpPipelineSummary(db, { orgId: ORG }),
      (err) => err.code === 'ORG_SCOPE_UNAVAILABLE'
        && /20260606000005/.test(err.message),
    );
  });

  it('does not disguise unrelated database failures as a scope problem', async () => {
    const db = {
      async _get() { throw new Error('ECONNREFUSED'); },
    };
    await assert.rejects(
      () => getRfpPipelineSummary(db, { orgId: ORG }),
      (err) => err.code === undefined && /ECONNREFUSED/.test(err.message),
    );
  });
});
