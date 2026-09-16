'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('business-studio store', () => {
  it('sanitizes known keys and drops junk', () => {
    const store = require('../src/denizen-business-studio-store');
    const clean = store.sanitizeState({
      business: { id: 'b1', name: 'Dolonia' },
      programs: [{ id: 'p1', name: 'E3' }],
      tasks: [{ id: 't1', title: 'Interview' }],
      hacker: true,
      secrets: { token: 'x' },
    });
    assert.equal(clean.business.name, 'Dolonia');
    assert.equal(clean.programs.length, 1);
    assert.equal(clean.tasks[0].title, 'Interview');
    assert.equal(clean.hacker, undefined);
    assert.equal(clean.secrets, undefined);
  });

  it('filters mentor view — hides private tasks and unshared financials by default', () => {
    const store = require('../src/denizen-business-studio-store');
    const state = store.sanitizeState({
      business: { id: 'b1', name: 'Dolonia', founderName: 'Zion', privateNotes: 'secret' },
      programs: [{ id: 'p1', name: 'E3' }],
      milestones: [{ id: 'm1', title: 'Validate' }],
      goals: [{ id: 'g1', title: 'Fit' }],
      experiments: [{ id: 'e1', title: 'Interviews' }],
      evidence: [{ id: 'ev1', title: 'Interview A' }],
      metrics: [
        { id: 'met1', name: 'Interviews', sharedWithAdvisors: true },
        { id: 'met2', name: 'Burn', sharedWithAdvisors: false },
      ],
      tasks: [{ id: 't1', title: 'Private founder task' }],
      comments: [
        { id: 'c1', text: 'Shared', visibility: 'shared' },
        { id: 'c2', text: 'Private', visibility: 'private' },
      ],
      recommendations: [
        { id: 'r1', title: 'Do X', advisorEmail: 'mentor@example.com' },
        { id: 'r2', title: 'Other', advisorEmail: 'other@example.com' },
      ],
    });
    const filtered = store.filterStateForAdvisor(state, {
      email: 'mentor@example.com',
      role: 'mentor',
      share: {
        programs: true,
        roadmap: true,
        goals: true,
        experiments: true,
        evidence: true,
        metrics: true,
        meetings: true,
        financials: false,
        crm: false,
      },
    });
    assert.equal(filtered.business.name, 'Dolonia');
    assert.equal(filtered.business.privateNotes, undefined);
    assert.equal(filtered.programs.length, 1);
    assert.equal(filtered.milestones.length, 1);
    assert.equal(filtered.goals.length, 1);
    assert.equal(filtered.experiments.length, 1);
    assert.equal(filtered.evidence.length, 1);
    assert.equal(filtered.metrics.length, 1);
    assert.equal(filtered.metrics[0].name, 'Interviews');
    assert.equal(filtered.tasks.length, 0);
    assert.equal(filtered.comments.length, 1);
    assert.equal(filtered.recommendations.length, 1);
    assert.equal(filtered.recommendations[0].id, 'r1');
  });

  it('honors share.false for programs', () => {
    const store = require('../src/denizen-business-studio-store');
    const state = store.emptyState();
    state.programs = [{ id: 'p1', name: 'E3' }];
    const filtered = store.filterStateForAdvisor(state, {
      email: 'm@x.com',
      share: { programs: false, roadmap: false, goals: false, experiments: false, evidence: false, metrics: false },
    });
    assert.equal(filtered.programs.length, 0);
  });
});

describe('business-studio E3 template', () => {
  it('builds i2E E3 / PAVE with evidence-gated requirements', () => {
    const e3 = require('../src/denizen-business-studio-e3-template');
    const templates = e3.listProgramTemplates();
    assert.ok(templates.some((t) => t.id === 'i2e-e3-pave'));
    const bundle = e3.applyProgramTemplate('i2e-e3-pave', {
      businessName: 'Dolonia / DENIZEN',
      founderName: 'Zion',
    });
    assert.equal(bundle.templateId, 'i2e-e3-pave');
    assert.equal(bundle.program.name, 'i2E E3');
    assert.ok(bundle.program.requirements.some((r) => r.key === 'discovery_interviews' && r.targetCount === 10));
    assert.ok(bundle.program.pave?.partB);
    assert.ok(bundle.experiments.length >= 1);
    assert.ok(bundle.assumptions.length >= 1);
    assert.ok(bundle.strategyNodes.length >= 5);
    assert.throws(() => e3.applyProgramTemplate('nope'), /Unknown program template/);
  });
});

describe('business-studio progress + explainability', () => {
  it('derives program percent from evidence, not task completion', () => {
    const e3 = require('../src/denizen-business-studio-e3-template');
    const progress = require('../src/denizen-business-studio-progress');
    const bundle = e3.applyProgramTemplate('i2e-e3-pave', { businessName: 'Dolonia', founderName: 'Zion' });
    const state = {
      programs: [bundle.program],
      experiments: bundle.experiments,
      tasks: bundle.tasks.map((t) => ({ ...t, status: 'done' })),
      evidence: [],
      metrics: bundle.metrics,
    };
    const health0 = progress.businessHealth(state);
    assert.equal(health0.program.percent, 0);
    assert.match(health0.program.why, /0 of 3/);

    const expId = bundle.experiments[0].id;
    state.evidence = [
      {
        id: 'ev1',
        title: 'Interview A',
        type: 'interview',
        requirementKey: 'discovery_interviews',
        linkedExperimentIds: [expId],
        experimentId: expId,
      },
      {
        id: 'ev2',
        title: 'Interview B',
        type: 'interview',
        requirementKey: 'discovery_interviews',
        linkedExperimentIds: [expId],
        experimentId: expId,
      },
      {
        id: 'ev3',
        title: 'Interview C',
        type: 'interview',
        requirementKey: 'discovery_interviews',
        linkedExperimentIds: [expId],
        experimentId: expId,
      },
    ];
    const health = progress.businessHealth(state);
    const discReq = health.program.requirements.find((r) => r.key === 'discovery_interviews');
    assert.equal(discReq.count, 3);
    assert.equal(discReq.target, 10);
    assert.equal(discReq.complete, false);
    // Percent counts fully evidenced requirements only — partial interview progress does not invent %.
    assert.equal(health.program.percent, 0);

    // Completing one full requirement (PAVE Part B) moves program % with explainable why.
    state.evidence.push({
      id: 'ev_pave',
      title: 'PAVE Part B draft',
      type: 'document',
      requirementKey: 'pave_part_b',
    });
    const health2 = progress.businessHealth(state);
    assert.equal(health2.program.percent, Math.round((1 / 3) * 100));
    assert.match(health2.program.why, /1 of 3/);

    const disc = health.categories.find((c) => c.id === 'customer_discovery');
    assert.equal(disc.status, 'needs_attention');
    assert.match(disc.reason, /3\/10/);

    const why = progress.explainStatus(state, 'category:customer_discovery');
    assert.equal(why.status, 'needs_attention');
    assert.ok(why.recommendedAction);

    const expProg = progress.experimentProgress(bundle.experiments[0], state);
    assert.equal(expProg.count, 3);
    assert.equal(expProg.confidence, 'insufficient');
  });

  it('never auto-validates assumptions from completed tasks alone', () => {
    const progress = require('../src/denizen-business-studio-progress');
    const state = {
      programs: [],
      experiments: [{
        id: 'exp1',
        title: 'Interview 10 CTE/IT decision makers',
        targetCount: 10,
        completedCount: 0,
      }],
      tasks: [
        { id: 't1', title: 'Talked to five schools', status: 'done' },
      ],
      evidence: [],
    };
    const health = progress.businessHealth(state);
    const disc = health.categories.find((c) => c.id === 'customer_discovery');
    assert.equal(disc.status, 'needs_attention');
    assert.match(disc.reason, /0\/10/);
  });
});

describe('business-studio MCP tools + scopes', () => {
  it('exposes tools for team and office NPCs', () => {
    const tools = require('../src/denizen-mcp-business-studio-tools');
    assert.ok(tools.BUSINESS_STUDIO_TOOL_DEFINITIONS.length >= 8);
    assert.ok(tools.isBusinessStudioTool('business_studio_working_set'));
    assert.ok(tools.isBusinessStudioTool('business_studio_add_evidence'));
    assert.ok(tools.toolsForNpc('_team').length >= 8);
    assert.ok(tools.toolsForNpc('jenny').length >= 8);
    assert.equal(tools.toolsForNpc('bouncer').length, 0);
  });

  it('callTool fails closed without org', async () => {
    const tools = require('../src/denizen-mcp-business-studio-tools');
    const res = await tools.callTool({ npc_key: 'jenny' }, 'business_studio_working_set', {});
    assert.equal(res.ok, false);
    assert.match(String(res.error), /org_id/i);
  });

  it('maps business studio tools into read / crm_write scopes', () => {
    const scopes = require('../src/denizen-mcp-scopes');
    const tools = require('../src/denizen-mcp-business-studio-tools');
    assert.equal(scopes.requiredScope('business_studio_working_set'), 'read');
    assert.equal(scopes.requiredScope('business_studio_brief'), 'read');
    assert.equal(scopes.requiredScope('business_studio_explain'), 'read');
    assert.equal(scopes.requiredScope('business_studio_list_programs'), 'read');
    assert.equal(scopes.requiredScope('business_studio_funding_readiness'), 'read');
    assert.equal(scopes.requiredScope('business_studio_chain_status'), 'read');
    assert.equal(scopes.requiredScope('business_studio_apply_program_template'), 'crm_write');
    assert.equal(scopes.requiredScope('business_studio_add_evidence'), 'crm_write');
    assert.equal(scopes.requiredScope('business_studio_revoke_evidence'), 'crm_write');
    assert.equal(scopes.requiredScope('business_studio_upsert_task'), 'crm_write');
    assert.equal(scopes.requiredScope('business_studio_create_experiment'), 'crm_write');
    assert.ok(tools.isBusinessStudioTool('business_studio_chain_status'));
    assert.ok(tools.isBusinessStudioTool('business_studio_revoke_evidence'));
  });
});

describe('business-studio route helpers', () => {
  it('classifies advisor roles', () => {
    const routes = require('../src/denizen-business-studio-routes');
    assert.equal(routes.isAdvisorRole('mentor'), true);
    assert.equal(routes.isAdvisorRole('advisor'), true);
    assert.equal(routes.isAdvisorRole('investor'), true);
    assert.equal(routes.isAdvisorRole('viewer'), true);
    assert.equal(routes.isAdvisorRole('owner'), false);
    assert.equal(routes.isAdvisorRole('admin'), false);
    assert.equal(routes.isFounderCapable({}, null), true);
    assert.equal(routes.isFounderCapable({}, { role: 'mentor' }), false);
  });
});

describe('business-studio funding readiness', () => {
  it('counts evidence-gated items without inventing a readiness %', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const state = {
      evidence: [
        { id: 'ev1', type: 'interview', fundingKey: 'customer_discovery', title: 'A' },
        { id: 'ev2', type: 'interview', fundingKey: 'customer_discovery', title: 'B' },
        { id: 'ev3', type: 'interview', fundingKey: 'customer_discovery', title: 'C' },
        { id: 'ev4', type: 'document', fundingKey: 'problem_need', title: 'Problem brief' },
        { id: 'ev5', type: 'prototype', fundingKey: 'product_solution', title: 'Mesh prototype' },
      ],
      funding: funding.emptyFundingState(),
      tasks: [{ id: 't1', title: 'Contacted five schools', status: 'done' }],
    };
    const ready = funding.evaluateFundingReadiness(state);
    assert.match(ready.overall.summaryLine, /complete/);
    assert.equal(ready.overall.total, funding.FUNDING_READINESS_SECTIONS.flatMap((s) => s.items).length);
    const disc = ready.sections
      .flatMap((s) => s.items)
      .find((i) => i.key === 'customer_discovery');
    assert.equal(disc.count, 3);
    assert.equal(disc.target, 10);
    assert.equal(disc.complete, false);
    assert.equal(disc.display, '◐ 3 / 10');
    const problem = ready.sections.flatMap((s) => s.items).find((i) => i.key === 'problem_need');
    assert.equal(problem.display, '✓ Evidence');
    const product = ready.sections.flatMap((s) => s.items).find((i) => i.key === 'product_solution');
    assert.equal(product.display, '✓ Prototype');
    assert.equal(ready.overall.complete, 2);
    assert.equal(ready.overall.needsWork, 1); // discovery 3/10
    assert.equal(ready.overall.notStarted, ready.overall.total - 3);
  });

  it('shows SOM as needs validation when partial evidence exists', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const state = {
      evidence: [{ id: 'ev', type: 'market_sizing', fundingKey: 'som', title: 'SOM draft' }],
      funding: funding.emptyFundingState(),
    };
    const som = funding.evaluateFundingReadiness(state).sections
      .flatMap((s) => s.items)
      .find((i) => i.key === 'som');
    assert.equal(som.display, '⚠ Needs validation');
    assert.equal(som.status, 'needs_validation');
  });

  it('calculates TAM/SAM/SOM and warns on weak SOM', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const calc = funding.calculateMarketSizing({
      tamOrgs: 10000,
      samOrgs: 1000,
      somPct: 10,
      acv: 12000,
      sources: {},
    });
    assert.equal(calc.tamValue, 10000 * 12000);
    assert.equal(calc.samValue, 1000 * 12000);
    assert.equal(calc.somOrgs, 100);
    assert.ok(calc.warnings.some((w) => /SOM/i.test(w)));
  });

  it('builds data room readiness from funding evidence', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const state = {
      evidence: [
        { id: '1', type: 'document', fundingKey: 'founders', title: 'Team' },
        { id: '2', type: 'document', fundingKey: 'tam', title: 'TAM' },
      ],
      funding: funding.emptyFundingState(),
    };
    const room = funding.evaluateDataRoom(state);
    assert.ok(room.sections.some((s) => s.id === 'company'));
    assert.match(room.overall.summary, /ready|partial|empty/);
  });

  it('capital pathway suggests types by stage', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const brief = funding.capitalPathwayBrief({
      funding: { ...funding.emptyFundingState(), capitalPlan: { stage: 'pre_revenue', uses: [], types: [] } },
      evidence: [],
    });
    assert.ok(brief.suggestedTypes.includes('Accelerator'));
    assert.ok(brief.pathway.some((p) => p.id === 'diligence'));
  });
});

describe('business-studio static shell', () => {
  it('ships index.html with founder nav + advisor mode', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../business-studio/index.html'), 'utf8');
    assert.match(html, /Business Studio/);
    assert.match(html, /id:'overview'/);
    assert.match(html, /id:'leancanvas'/);
    assert.match(html, /lean-canvas/);
    assert.match(html, /Load DENIZEN draft/);
    assert.match(html, /uniqueValueProposition/);
    assert.match(html, /id:'roadmap'/);
    assert.match(html, /id:'strategy'/);
    assert.match(html, /id:'evidence'/);
    assert.match(html, /id:'mentors'/);
    assert.match(html, /id:'funding'/);
    assert.match(html, /Funding Readiness/);
    assert.match(html, /fr-board|FUNDING READINESS/);
    assert.match(html, /Market Sizing/);
    assert.match(html, /ms-nest|ms-tam/);
    assert.match(html, /Moat/);
    assert.match(html, /CAN A COMPETITOR COPY IT/);
    assert.match(html, /Discovery Lab/);
    assert.match(html, /Data Room/);
    assert.match(html, /Capital Pathway|id:'capital'/);
    assert.match(html, /✓ Evidence|completeLabel:'Evidence'/);
    assert.match(html, /advisorMode|Advisor mode/);
    assert.match(html, /i2e-e3-pave|i2E E3/);
    assert.match(html, /data-why/);
    assert.match(html, /\/api\/business-studio\/recommendations/);
  });
});

describe('business-studio lean canvas', () => {
  it('models a 9-box canvas and DENIZEN draft', () => {
    const funding = require('../src/denizen-business-studio-funding');
    assert.equal(funding.LEAN_CANVAS_FIELDS.length, 9);
    assert.equal(funding.leanCanvasFilledCount(funding.emptyLeanCanvas()), 0);
    const draft = funding.denizenLeanCanvasDraft();
    assert.ok(funding.leanCanvasIsSubstantial(draft));
    assert.equal(funding.leanCanvasFilledCount(draft), 9);
    assert.match(draft.problem, /API Cost Trap/);
    assert.match(draft.uniqueValueProposition, /zero marginal cloud cost/i);
    assert.match(funding.leanCanvasPlainText(draft), /Customer Segments/);
  });
});
