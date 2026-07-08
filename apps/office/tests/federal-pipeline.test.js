'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getRfpPipelineSummary, getRfpDetail } = require('../src/intelligence/federal-pipeline.js');

function createMockDenizenDb() {
  return {
    async _get(path) {
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
    const summary = await getRfpPipelineSummary(createMockDenizenDb());
    assert.equal(summary.total_rfps, 2);
    assert.equal(summary.counts_by_status.in_review, 1);
    assert.equal(summary.counts_by_status.draft, 1);
    assert.equal(summary.total_pipeline_value, 1300000);
    assert.equal(summary.next_due_dates.length, 2);
  });

  it('builds per-RFP detail metrics and unmet mandatory requirements', async () => {
    const detail = await getRfpDetail(createMockDenizenDb(), 'rfp-1');
    assert.equal(detail.id, 'rfp-1');
    assert.equal(detail.bid_probability, 0.74);
    assert.equal(detail.requirement_counts.total, 2);
    assert.equal(detail.requirement_counts.completed, 1);
    assert.equal(detail.requirement_completion_pct, 50);
    assert.equal(detail.unmet_mandatory_requirements.length, 1);
    assert.match(detail.unmet_mandatory_requirements[0].requirement_text, /clearance/i);
  });
});
