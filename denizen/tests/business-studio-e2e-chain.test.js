'use strict';

/**
 * Strict end-to-end evidence chain tests.
 *
 * Rule: Task completed ≠ business progress.
 *       Qualifying evidence meeting a requirement = business progress.
 *
 * Program completion (10/10 interviews) ≠ business validation (hypothesis proved).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/denizen-business-studio-store');
const e3 = require('../src/denizen-business-studio-e3-template');
const progress = require('../src/denizen-business-studio-progress');
const funding = require('../src/denizen-business-studio-funding');
const chain = require('../src/denizen-business-studio-chain');
const ledger = require('../src/denizen-business-studio-evidence');
const tools = require('../src/denizen-mcp-business-studio-tools');
const scopes = require('../src/denizen-mcp-scopes');

function seedE3Workspace() {
  const state = store.emptyState();
  const bundle = e3.applyProgramTemplate('i2e-e3-pave', {
    businessName: 'Dolonia / DENIZEN',
    founderName: 'Founder',
  });
  state.business = { id: 'biz_test', name: 'Dolonia / DENIZEN', founderName: 'Founder' };
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

function counts(state) {
  const snap = chain.chainSnapshot(state);
  return {
    experiment: snap.experiment?.count ?? 0,
    requirement: snap.program.discoveryRequirement?.count ?? 0,
    funding: snap.fundingCustomerDiscovery?.count ?? 0,
    metric: snap.metricDiscoveryInterviews?.current ?? 0,
    reqComplete: !!snap.program.discoveryRequirement?.complete,
    fundingComplete: !!snap.fundingCustomerDiscovery?.complete,
    assumption: snap.primaryAssumption,
    workingSet: snap.workingSet,
  };
}

function assertAligned(state, n, label) {
  const c = counts(state);
  assert.equal(c.experiment, n, `${label}: experiment`);
  assert.equal(c.requirement, n, `${label}: requirement`);
  assert.equal(c.funding, n, `${label}: funding`);
  assert.equal(c.metric, n, `${label}: metric`);
}

describe('Business Studio end-to-end evidence chain', () => {
  it('flows discovery interviews through experiment → requirement → milestone → goal → funding', () => {
    const state = seedE3Workspace();
    assertAligned(state, 0, 'start');

    // Negative: task done alone must not move the chain
    state.tasks.forEach((t) => { t.status = 'done'; });
    assertAligned(state, 0, 'after tasks done');
    assert.equal(progress.programProgress(state, state.programs[0]).percent, 0);

    for (let i = 1; i <= 3; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i} — CTE director`,
        contactId: `crm_contact_${i}`,
        contactName: `Contact ${i}`,
        stance: 'neutral',
      });
    }
    assertAligned(state, 3, 'after 3 interviews');

    const mid = chain.chainSnapshot(state);
    assert.equal(mid.program.discoveryRequirement.complete, false);
    assert.equal(mid.milestones.find((m) => /10 discovery/i.test(m.title)).status, 'active');
    assert.match(mid.goals[0].why, /3\/10/);
    assert.notEqual(state.assumptions[0].status, 'validated');

    for (let i = 4; i <= 10; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_contact_${i}`,
        stance: 'neutral',
      });
    }
    assertAligned(state, 10, 'after 10 interviews');

    const done = chain.chainSnapshot(state);
    assert.equal(done.program.discoveryRequirement.complete, true);
    assert.equal(done.fundingCustomerDiscovery.complete, true);
    assert.equal(done.milestones.find((m) => /10 discovery/i.test(m.title)).complete, true);
    assert.equal(done.goals[0].complete, true);
    assert.notEqual(done.primaryAssumption.status, 'validated');
    assert.equal(done.primaryAssumption.validated, false);
    assert.equal(done.program.percent, Math.round((1 / 3) * 100));
  });

  it('rejects duplicate interview fingerprints without double-counting', () => {
    const state = seedE3Workspace();
    const a = chain.attachDiscoveryInterview(state, {
      title: 'Interview — same contact',
      contactId: 'crm_dup_1',
      contactName: 'Ada',
    });
    assert.equal(a.duplicate, false);
    assertAligned(state, 1, 'first');

    const b = chain.attachDiscoveryInterview(state, {
      title: 'Interview — duplicate attempt',
      contactId: 'crm_dup_1',
      contactName: 'Ada',
    });
    assert.equal(b.duplicate, true);
    assert.equal(b.evidence.id, a.evidence.id);
    assertAligned(state, 1, 'after duplicate');
    assert.equal(state.evidence.filter((e) => !e.revoked).length, 1);
  });

  it('recalculates downstream status when evidence is revoked', () => {
    const state = seedE3Workspace();
    const ids = [];
    for (let i = 1; i <= 3; i += 1) {
      const r = chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_rev_${i}`,
      });
      ids.push(r.evidence.id);
    }
    assertAligned(state, 3, 'before revoke');

    const rev = chain.revokeAndResync(state, ids[1], { reason: 'bad transcript' });
    assert.equal(rev.ok, true);
    assertAligned(state, 2, 'after revoke');
    assert.equal(ledger.isActiveEvidence(ledger.findEvidenceById(state, ids[1])), false);

    const fr = funding.evaluateFundingReadiness(state);
    const item = fr.sections.flatMap((s) => s.items).find((i) => i.key === 'customer_discovery');
    assert.equal(item.count, 2);
  });

  it('does not count interviews attached only to the wrong experiment', () => {
    const state = seedE3Workspace();
    const discovery = chain.findDiscoveryExperiment(state);
    const other = {
      id: 'exp_other',
      title: 'Pricing survey (not discovery interviews)',
      assumptionKey: null,
      status: 'active',
      targetCount: 5,
      completedCount: 0,
      method: 'survey',
    };
    state.experiments.push(other);

    chain.attachEvidence(state, {
      title: 'Interview parked on wrong experiment',
      type: 'interview',
      experimentId: other.id,
      autoLinkDiscovery: false,
    });

    assert.equal(progress.experimentProgress(other, state).count, 1);
    assert.equal(progress.experimentProgress(discovery, state).count, 0);
    assert.equal(
      progress.requirementProgress(
        state,
        state.programs[0].requirements.find((r) => r.key === 'discovery_interviews'),
      ).count,
      0,
    );
    assert.equal(chain.fundingItemByKey(state, 'customer_discovery').count, 0);
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
    assert.equal(chain.fundingItemByKey(mentorHidden, 'customer_discovery').count, 0);
    assert.equal(counts(state).funding, 1, 'founder still sees evidence');

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
    assert.equal(chain.fundingItemByKey(mentorShown, 'customer_discovery').count, 1);
  });

  it('10 qualifying interviews complete the requirement without validating the assumption', () => {
    const state = seedE3Workspace();
    for (let i = 1; i <= 10; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_q_${i}`,
        stance: 'neutral',
      });
    }
    const c = counts(state);
    assert.equal(c.reqComplete, true);
    assert.equal(c.assumption.validated, false);
    assert.notEqual(c.assumption.status, 'validated');
    assert.ok(['insufficient', 'sufficient_to_decide', 'testing'].includes(c.assumption.confidence)
      || c.assumption.confidence === 'sufficient_to_decide');
  });

  it('11th contradicting interview keeps E3 complete while challenging the assumption', () => {
    const state = seedE3Workspace();
    for (let i = 1; i <= 10; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_c_${i}`,
        stance: 'neutral',
      });
    }
    assert.equal(counts(state).reqComplete, true);
    assert.equal(counts(state).assumption.validated, false);

    chain.attachDiscoveryInterview(state, {
      title: 'Interview 11 — contradicts hypothesis',
      contactId: 'crm_c_11',
      stance: 'contradicts',
      notes: 'Schools said recurring AI cost is fine; not a barrier.',
    });

    const after = counts(state);
    assert.equal(after.requirement, 11);
    assert.equal(after.reqComplete, true, 'E3 quantitative requirement stays complete at 10+');
    assert.equal(after.fundingComplete, true);
    assert.equal(after.assumption.validated, false);
    assert.equal(after.assumption.confidence, 'contradicted');
    assert.equal(after.assumption.status, 'challenged');
    assert.ok(after.assumption.contradicts >= 1);
  });

  it('MCP working_set returns compact objective context, not a record dump', () => {
    assert.equal(scopes.requiredScope('business_studio_chain_status'), 'read');
    assert.equal(scopes.requiredScope('business_studio_revoke_evidence'), 'crm_write');
    assert.ok(tools.isBusinessStudioTool('business_studio_revoke_evidence'));

    const state = seedE3Workspace();
    for (let i = 1; i <= 6; i += 1) {
      chain.attachDiscoveryInterview(state, {
        title: `Interview ${i}`,
        contactId: `crm_ws_${i}`,
        stance: 'neutral',
      });
    }
    const ws = chain.workingSetBrief(state);
    assert.match(ws.e3_discovery.label, /6\/10/);
    assert.equal(ws.evidence_count, 6);
    assert.equal(ws.primary_assumption.status, 'unresolved');
    assert.equal(ws.funding_readiness.customer_discovery, 'incomplete');
    assert.ok(ws.blocking_milestone);
    assert.match(ws.recommended_next_action, /4 additional qualifying interview/i);
    assert.match(ws.reason, /requires 10.*count is 6/i);
    // Compact: no full evidence dump
    assert.ok(!Array.isArray(ws.evidence));
    assert.ok((ws.e3_discovery.evidence_ids || []).length === 6);
  });

  it('evidence without funding keys does not move Funding Readiness customer_discovery', () => {
    const state = seedE3Workspace();
    chain.attachEvidence(state, {
      title: 'PAVE draft notes',
      type: 'document',
      requirement_key: 'pave_part_b',
      autoLinkDiscovery: false,
    });
    assert.equal(chain.fundingItemByKey(state, 'customer_discovery').count, 0);
    assert.equal(chain.chainSnapshot(state).program.discoveryRequirement.count, 0);
  });

  it('inflated completedCount cache cannot invent experiment progress', () => {
    const state = seedE3Workspace();
    const exp = chain.findDiscoveryExperiment(state);
    exp.completedCount = 99;
    assert.equal(progress.experimentProgress(exp, state).count, 0);
    chain.attachDiscoveryInterview(state, { title: 'Real interview', contactId: 'crm_real_1' });
    assert.equal(progress.experimentProgress(exp, state).count, 1);
  });
});
