'use strict';

/**
 * Strict end-to-end chain test:
 * E3 requirement → goal → discovery experiment → CRM-linked interview evidence
 * → experiment / milestone / program / Funding Readiness → mentor ACL → Jenny MCP snapshot.
 *
 * Completion is judged by information flow, not by screens opening.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/denizen-business-studio-store');
const e3 = require('../src/denizen-business-studio-e3-template');
const progress = require('../src/denizen-business-studio-progress');
const funding = require('../src/denizen-business-studio-funding');
const chain = require('../src/denizen-business-studio-chain');
const tools = require('../src/denizen-mcp-business-studio-tools');
const scopes = require('../src/denizen-mcp-scopes');

function seedE3Workspace() {
  const state = store.emptyState();
  const bundle = e3.applyProgramTemplate('i2e-e3-pave', {
    businessName: 'Dolonia / DENIZEN',
    founderName: 'Founder',
  });
  state.business = {
    id: 'biz_test',
    name: 'Dolonia / DENIZEN',
    founderName: 'Founder',
  };
  state.programs = [bundle.program];
  state.milestones = bundle.milestones;
  state.tasks = bundle.tasks;
  state.assumptions = bundle.assumptions;
  state.experiments = bundle.experiments;
  state.goals = bundle.goals;
  state.metrics = bundle.metrics;
  state.strategyNodes = bundle.strategyNodes;
  state.strategyEdges = bundle.strategyEdges;
  return state;
}

describe('Business Studio end-to-end evidence chain', () => {
  it('flows discovery interviews through experiment → requirement → milestone → goal → funding', () => {
    const state = seedE3Workspace();
    const before = chain.chainSnapshot(state);

    assert.equal(before.program.discoveryRequirement.count, 0);
    assert.equal(before.experiment.count, 0);
    assert.equal(before.fundingCustomerDiscovery.count, 0);
    assert.equal(before.metricDiscoveryInterviews.current, 0);

    // Negative control: completing a task alone must not move the chain
    state.tasks[0].status = 'done';
    const afterTask = chain.chainSnapshot(state);
    assert.equal(afterTask.program.discoveryRequirement.count, 0);
    assert.equal(afterTask.fundingCustomerDiscovery.count, 0);
    assert.equal(afterTask.experiment.count, 0);

    // Attach 3 CRM-linked discovery interviews via the single SoT writer
    for (let i = 1; i <= 3; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i} — CTE director`,
        persona: 'CTE Director',
        contactId: `crm_contact_${i}`,
        contactName: `Contact ${i}`,
        insightTags: ['recurring cost pain', 'wants pilot'],
        notes: `Real interview notes ${i}`,
      });
    }

    const mid = chain.chainSnapshot(state);
    assert.equal(mid.experiment.count, 3);
    assert.equal(mid.program.discoveryRequirement.count, 3);
    assert.equal(mid.program.discoveryRequirement.complete, false); // need 10
    assert.equal(mid.fundingCustomerDiscovery.count, 3);
    assert.equal(mid.fundingCustomerDiscovery.complete, false);
    assert.equal(mid.metricDiscoveryInterviews.current, 3);
    assert.equal(mid.crmLinkedEvidenceCount, 3);
    assert.ok(mid.relationsCount >= 3);

    const discoveryMs = mid.milestones.find((m) => /10 discovery/i.test(m.title));
    assert.ok(discoveryMs);
    assert.equal(discoveryMs.complete, false);
    assert.equal(discoveryMs.status, 'active'); // derived from partial evidence

    const goal = mid.goals[0];
    assert.ok(goal);
    assert.equal(goal.complete, false);
    assert.match(goal.why, /3\/10/);

    // Assumptions never auto-validate
    const asm = state.assumptions[0];
    assert.notEqual(asm.status, 'validated');
    assert.equal(asm.confidence, 'insufficient');

    // Finish the discovery requirement (10 interviews)
    for (let i = 4; i <= 10; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_contact_${i}`,
        contactName: `Contact ${i}`,
      });
    }

    const done = chain.chainSnapshot(state);
    assert.equal(done.experiment.count, 10);
    assert.equal(done.experiment.complete, true);
    assert.equal(done.program.discoveryRequirement.count, 10);
    assert.equal(done.program.discoveryRequirement.complete, true);
    assert.equal(done.fundingCustomerDiscovery.count, 10);
    assert.equal(done.fundingCustomerDiscovery.complete, true);
    assert.equal(done.metricDiscoveryInterviews.current, 10);

    const msDone = done.milestones.find((m) => /10 discovery/i.test(m.title));
    assert.equal(msDone.complete, true);
    assert.equal(msDone.status, 'complete');
    assert.equal(state.milestones.find((m) => m.id === msDone.id).status, 'complete');

    const goalDone = done.goals[0];
    assert.equal(goalDone.complete, true);
    assert.equal(state.goals[0].status, 'complete');

    // Program % only moves when requirements complete (1 of 3)
    assert.equal(done.program.percent, Math.round((1 / 3) * 100));

    // health categories reflect funding + discovery
    const health = progress.businessHealth(state);
    assert.ok(health.milestones.some((m) => m.complete));
    assert.ok(health.goals.some((g) => g.complete));
    const frCat = health.categories.find((c) => c.id === 'funding_readiness');
    assert.ok(frCat);
    assert.notEqual(frCat.status, 'unknown');
  });

  it('mentor ACL hides unshared evidence while founder chain remains intact', () => {
    const state = seedE3Workspace();
    chain.attachDiscoveryInterview(state, {
      title: 'Interview — shared path',
      contactId: 'crm_1',
      contactName: 'Ada',
    });

    const mentorHidden = store.filterStateForAdvisor(state, {
      email: 'jenny@example.com',
      role: 'mentor',
      share: {
        programs: true,
        roadmap: true,
        goals: true,
        experiments: true,
        evidence: false,
        metrics: true,
        funding: true,
      },
    });
    assert.equal(mentorHidden.evidence.length, 0);
    // Funding object may still exist, but without evidence FR customer_discovery stays empty
    const mentorFr = funding.evaluateFundingReadiness(mentorHidden);
    const item = mentorFr.sections
      .flatMap((s) => s.items)
      .find((i) => i.key === 'customer_discovery');
    assert.equal(item.count, 0);

    const mentorShown = store.filterStateForAdvisor(state, {
      email: 'jenny@example.com',
      role: 'mentor',
      share: {
        programs: true,
        roadmap: true,
        goals: true,
        experiments: true,
        evidence: true,
        metrics: true,
        funding: true,
      },
    });
    assert.equal(mentorShown.evidence.length, 1);
    const shownFr = chain.fundingItemByKey(mentorShown, 'customer_discovery');
    assert.equal(shownFr.count, 1);
  });

  it('MCP add_evidence + chain_status expose what changed for Jenny', async () => {
    assert.equal(scopes.requiredScope('business_studio_chain_status'), 'read');
    assert.ok(tools.BUSINESS_STUDIO_TOOL_DEFINITIONS.some((t) => t.name === 'business_studio_chain_status'));
    assert.ok(tools.hasBusinessStudioAccess('jenny'));

    // In-memory path: exercise the same attachEvidence the MCP tool uses
    const state = seedE3Workspace();
    const attached = chain.attachEvidence(state, {
      title: 'MCP interview',
      type: 'interview',
      description: 'From Jenny tool path',
      contact_id: 'crm_jenny_1',
      contact_name: 'District IT',
      source: 'mcp',
    });

    assert.equal(attached.evidence.requirementKey, 'discovery_interviews');
    assert.equal(attached.evidence.fundingKey, 'customer_discovery');
    assert.ok(attached.evidence.experimentId);
    assert.equal(attached.evidence.contactId, 'crm_jenny_1');
    assert.equal(attached.chain.experiment.count, 1);
    assert.equal(attached.chain.fundingCustomerDiscovery.count, 1);
    assert.equal(attached.chain.program.discoveryRequirement.count, 1);

    const snap = chain.chainSnapshot(state);
    assert.ok(snap.nextActions.length >= 1);
    assert.match(
      JSON.stringify(snap.nextActions),
      /interview|discovery|Funding|evidence/i,
    );

    // Brief-shaped payload Jenny would read
    const health = progress.businessHealth(state);
    const attn = health.categories.filter((c) => c.status === 'needs_attention');
    assert.ok(Array.isArray(attn));
    assert.equal(snap.crmLinkedEvidenceCount, 1);
  });

  it('evidence without funding keys does not move Funding Readiness customer_discovery', () => {
    const state = seedE3Workspace();
    // Manual non-interview document with only a requirement key
    chain.attachEvidence(state, {
      title: 'PAVE draft notes',
      type: 'document',
      requirement_key: 'pave_part_b',
      autoLinkDiscovery: false,
    });
    const fr = chain.fundingItemByKey(state, 'customer_discovery');
    assert.equal(fr.count, 0);
    const req = chain.chainSnapshot(state).program.discoveryRequirement;
    assert.equal(req.count, 0);
  });
});
