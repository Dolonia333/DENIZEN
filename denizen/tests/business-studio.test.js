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

  it('keeps a member studio separate from the founder workspace', () => {
    const store = require('../src/denizen-business-studio-store');
    const founder = store.sanitizeState({
      business: { id: 'b1', name: 'Dolonia' },
      programs: [{ id: 'p1', name: 'E3' }],
    });
    const angela = store.emptyState();
    angela.business = { id: 'a1', name: 'Angela Studio' };
    const stored = store.writePrivateStudio(founder, 'angela', angela);
    const hers = store.readPrivateStudio(stored, 'angela');
    const publicState = store.stripPrivateStudios(stored);
    assert.equal(hers.business.name, 'Angela Studio');
    assert.equal(publicState.business.name, 'Dolonia');
    assert.equal(publicState.config.privateStudios, undefined);
    const kept = store.preservePrivateStudios(stored, store.sanitizeState({
      business: { id: 'b1', name: 'Dolonia updated' },
    }));
    assert.equal(kept.business.name, 'Dolonia updated');
    assert.equal(store.readPrivateStudio(kept, 'angela').business.name, 'Angela Studio');
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

describe('business-studio personal workspace', () => {
  it('keeps every studio private and parks the shared record on the operator', async () => {
    const store = require('../src/denizen-business-studio-store');
    const tools = require('../src/denizen-mcp-business-studio-tools');
    const founder = store.sanitizeState({
      business: { name: 'DENIZEN / Dolonia Data Tech', founderName: 'Zion Alexander Van Zandt' },
      goals: [{ id: 'g1', title: 'Operator goal' }],
    });
    const angela = store.emptyState();
    angela.business = { name: '1921 HOLDING CO., LLC', founderName: 'Angela Van Zandt' };
    const stored = store.writePrivateStudio(founder, 'angela', angela);
    const parked = store.parkOperatorStudio(stored);
    assert.equal(parked.parked, true);
    assert.equal(store.stripPrivateStudios(parked.state).business, null);
    assert.equal(store.readPrivateStudio(parked.state, store.operatorStudioKey()).business.name, 'DENIZEN / Dolonia Data Tech');
    assert.equal(store.readPrivateStudio(parked.state, 'angela').business.name, '1921 HOLDING CO., LLC');
    const stranger = store.selectPersonalState(parked.state, 'email:maddie@example.com');
    assert.equal(stranger.state.business, null);
    assert.equal(stranger.state.config.privateStudios, undefined);
    assert.equal(store.parkOperatorStudio(parked.state).parked, false);
    assert.equal(store.studioKeyForProfile({ email: 'zionvanzandt@gmail.com' }), store.operatorStudioKey());
    const previousHolding = process.env.DENIZEN_HOLDING_EMAILS;
    process.env.DENIZEN_HOLDING_EMAILS = 'angelavanzandt1921@gmail.com';
    try {
      assert.equal(store.studioKeyForProfile({ email: 'angelavanzandt1921@gmail.com' }), 'angela');
    } finally {
      if (previousHolding == null) delete process.env.DENIZEN_HOLDING_EMAILS;
      else process.env.DENIZEN_HOLDING_EMAILS = previousHolding;
    }
    assert.equal(store.studioKeyForProfile({ email: 'maddie@example.com' }), 'email:maddie@example.com');
    assert.equal(tools.studioKeyFromAccount('founder'), store.operatorStudioKey());
    assert.equal(tools.studioKeyFromAccount('angela'), 'angela');
    assert.equal(await tools.resolveStudioKey({ npc_key: '_team', scope_mode: 'team' }, {}), 'angela');
    assert.equal(await tools.resolveStudioKey({ npc_key: '_team', scope_mode: 'team' }, { account: 'founder' }), 'angela');
    assert.equal(await tools.resolveStudioKey({ email: 'maddie@example.com' }, { account: 'angela' }), 'email:maddie@example.com');
    assert.equal(await tools.resolveStudioKey({ email: 'zionvanzandt@gmail.com' }, { account: 'angela' }), store.operatorStudioKey());
  });

  it('does not copy another studio canvas into an empty personal page', () => {
    const store = require('../src/denizen-business-studio-store');
    const line = '1921 revenue lines include awards, consulting, compliance, partner delivery, logistics, and DENIZEN.';
    const canvas = {};
    for (const key of ['problem', 'solution', 'uniqueValueProposition', 'unfairAdvantage', 'customerSegments', 'keyMetrics', 'channels', 'costStructure', 'revenueStreams']) {
      canvas[key] = line;
    }
    const root = store.sanitizeState({
      business: { name: 'DENIZEN / Dolonia Data Tech', founderName: 'Zion Alexander Van Zandt' },
      funding: { leanCanvas: canvas },
    });
    const thin = store.emptyState();
    thin.business = { name: '1921 HOLDING CO., LLC', founderName: 'Angela Van Zandt' };
    const stored = store.writePrivateStudio(root, 'angela', thin);
    const selected = store.selectPersonalState(stored, 'angela');
    assert.equal(selected.adopted, false);
    assert.equal(selected.state.business.name, '1921 HOLDING CO., LLC');
    assert.equal(selected.state.funding.leanCanvas.problem, '');
    const other = store.selectPersonalState(stored, 'email:someone@example.com');
    assert.equal(other.state.business, null);
    assert.notEqual(other.state.funding.leanCanvas.problem, line);
  });

  it('saves a phase 2 record without inventing a figure', () => {
    const tools = require('../src/denizen-mcp-business-studio-tools');
    const store = require('../src/denizen-business-studio-store');
    const written = tools.applySectionWrite(store.emptyState(), {
      section: 'financials',
      title: 'Consulting note',
      body: 'No contract value yet',
    });
    assert.equal(written.ok, true);
    assert.equal(written.state.phase2.financials.rows[0].title, 'Consulting note');
    assert.equal(written.state.phase2.financials.rows[0].amount, undefined);
    const empty = tools.applySectionWrite(store.emptyState(), { section: 'reports' });
    assert.equal(empty.ok, false);
  });
});

describe('business-studio company header and holding dashboard', () => {
  it('writes the company name from the field the header was ignoring', () => {
    const store = require('../src/denizen-business-studio-store');
    const profile = store.applyBusinessProfile(
      { name: 'DENIZEN / Dolonia Data Tech Solutions', founderName: 'Angela Van Zandt' },
      { company_name: '1921 HOLDING CO., LLC' },
    );
    assert.equal(profile.business.name, '1921 HOLDING CO., LLC');
    assert.equal(profile.business.founderName, 'Angela Van Zandt');
    assert.equal(profile.business.structure, 'holding');
    assert.deepEqual(profile.applied, ['name', 'structure']);
  });

  it('keeps the product workbook off the company dashboard', () => {
    const store = require('../src/denizen-business-studio-store');
    const e3 = require('../src/denizen-business-studio-e3-template');
    const progress = require('../src/denizen-business-studio-progress');
    const funding = require('../src/denizen-business-studio-funding');
    const bundle = e3.applyProgramTemplate('i2e-e3-pave', { businessName: '1921', founderName: 'Angela' });
    const state = {
      business: { name: '1921 HOLDING CO., LLC', founderName: 'Angela Van Zandt', structure: 'holding' },
      programs: [bundle.program],
      experiments: bundle.experiments,
      milestones: bundle.milestones,
      tasks: [],
      evidence: [],
      metrics: bundle.metrics,
      goals: bundle.goals,
      strategyNodes: bundle.strategyNodes,
    };
    assert.equal(store.strategyMapIsE3Template(state.strategyNodes), true);
    const health = progress.businessHealth(state);
    assert.equal(health.program.percent, null);
    assert.match(health.program.why, /product workbook/i);
    const discovery = health.categories.find((category) => category.id === 'customer_discovery');
    assert.match(discovery.reason, /No discovery experiment/);
    const sized = funding.calculateMarketSizing({
      serviceLines: [
        { name: 'Logistics', tam: 10, sam: 4, som: null },
        { name: 'DENIZEN commercialization', tam: null, sam: null, som: null },
      ],
    });
    assert.equal(sized.serviceRollup.tam, 10);
    assert.equal(sized.serviceRollup.sam, 4);
    assert.equal(sized.serviceRollup.som, null);
    assert.equal(sized.serviceRollup.sizedLines, 1);
    assert.equal(sized.serviceRollup.totalLines, 2);
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
    assert.equal(scopes.requiredScope('business_studio_get_workspace'), 'read');
    assert.equal(scopes.requiredScope('business_studio_patch'), 'crm_write');
    assert.equal(scopes.requiredScope('crm_upsert_company'), 'crm_write');
    assert.ok(tools.isBusinessStudioTool('business_studio_patch'));
    assert.ok(tools.isBusinessStudioTool('business_studio_chain_status'));
    assert.ok(tools.isBusinessStudioTool('business_studio_revoke_evidence'));
  });

  it('patches studio fields and keeps unrelated lists', () => {
    const tools = require('../src/denizen-mcp-business-studio-tools');
    const next = tools.applyStudioPatch({
      business: { id: 'b1', name: 'Dolonia' },
      programs: [{ id: 'p1', name: 'E3' }],
      config: { privateStudios: { angela: { business: { name: 'Hidden' } } } },
    }, {
      business: { founderName: 'Zion' },
      goals: [{ id: 'g1', title: 'Fit' }],
    });
    assert.equal(next.business.name, 'Dolonia');
    assert.equal(next.business.founderName, 'Zion');
    assert.equal(next.programs[0].id, 'p1');
    assert.equal(next.goals[0].title, 'Fit');
    assert.equal(next.config.privateStudios, undefined);
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
    assert.match(html, /id:'pave'/);
    assert.match(html, /PAVE Workbook|pave-wrap|Living section/);
    assert.match(html, /pave-ask-why|Ask WHY/);
    assert.match(html, /font-sheet|Arimo|sc-diagram|salesCycleDiagram/);
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
    assert.match(draft.problem, /school and district/i);
    assert.doesNotMatch(draft.uniqueValueProposition, /guaranteeing|zero marginal cloud cost/i);
    assert.match(funding.leanCanvasPlainText(draft), /Customer Segments/);
  });
});

describe('business-studio living PAVE workbook', () => {
  it('models full Snapshot / A–D / Final and DENIZEN draft', () => {
    const pave = require('../src/denizen-business-studio-pave');
    assert.ok(pave.PAVE_SECTIONS.length >= 6);
    assert.equal(pave.paveFilledCount(pave.emptyPave()), 0);
    const draft = pave.denizenPaveDraft();
    assert.match(draft.snapshot.company, /DENIZEN/);
    assert.match(draft.snapshot.founders, /Zion Alexander Van Zandt/);
    assert.match(draft.partA.customer, /school and district/i);
    assert.doesNotMatch(draft.partA.customer, /Dana/);
    assert.match(draft.partB.targetPersona, /school or district/i);
    assert.ok(draft.living !== false);
    assert.ok(Array.isArray(draft.partC.risks));
    assert.ok(draft.partC.risks.length >= 3);
    assert.doesNotMatch(draft.partD.pitch90, /ten Danas/i);
    assert.ok(pave.paveFilledCount(draft) > 20);
    assert.ok(pave.pavePartBIsSubstantial(draft));
    assert.match(draft.partA.salesCycleDiagram.productTitle, /DENIZEN/);
    assert.equal(draft.partA.salesCycleDiagram.roles.length, 5);
    assert.equal(draft.partA.salesCycleDiagram.cycle.length, 4);
    assert.match(draft.partA.salesCycleDiagram.roles.find((r) => r.id === 'decides').text, /school or district/i);
    assert.doesNotMatch(draft.partA.salesCycleDiagram.roles.find((r) => r.id === 'decides').text, /\$49|\$199/);
  });

  it('keeps Part B living from discovery evidence and mentors ask WHY', () => {
    const pave = require('../src/denizen-business-studio-pave');
    const e3 = require('../src/denizen-business-studio-e3-template');
    const bundle = e3.applyProgramTemplate('i2e-e3-pave', {
      businessName: 'Dolonia / DENIZEN',
      founderName: 'Zion',
    });
    assert.ok(bundle.program.pave?.snapshot);
    assert.ok(bundle.program.pave?.partA?.customer !== undefined);
    assert.equal(bundle.program.pave.partC.risks.length, 3);

    let workbook = pave.denizenPaveDraft();
    const state = {
      programs: [{ ...bundle.program, pave: workbook }],
      evidence: [
        { id: 'ev1', type: 'interview', title: 'Dana #1', notes: 'Wants overnight agent', requirementKey: 'discovery_interviews' },
        { id: 'ev2', type: 'interview', title: 'Dana #2', notes: 'Mail must stay gated', requirementKey: 'discovery_interviews' },
      ],
    };
    workbook = pave.syncPartBFromDiscovery(workbook, state, { force: true, refreshSummary: true });
    assert.match(workbook.partB.interviewsCompletedNote, /2 of 10/);
    assert.match(workbook.partB.summaryOfCalls, /Dana #1/);

    const { pave: withReview, review } = pave.addPaveReview(workbook, {
      fieldPath: 'partA.customer',
      kind: 'why',
      text: 'Why Dana and not a district buyer?',
      authorName: 'Srijita',
    });
    assert.equal(review.kind, 'why');
    assert.equal(pave.openPaveReviews(withReview).length, 1);
    assert.equal(pave.reviewsForField(withReview, 'partA.customer').length, 1);

    const prog = { ...bundle.program, pave: withReview, requirements: bundle.program.requirements };
    pave.syncPavePartBEvidence(state, prog);
    assert.ok(state.evidence.some((e) => e.source === 'pave_part_b' && !e.revoked));
  });

  it('overwrites nested PAVE fields from the shapes an agent actually sends', () => {
    const pave = require('../src/denizen-business-studio-pave');
    const stored = pave.denizenPaveDraft();
    stored.partA.customer = 'Dana — founder-operator of a small shop';
    stored.snapshot.founders = 'Dolonia';
    stored.partD.foundingTeam = 'Shawnaya is co-founder';
    stored.partA.salesCycle = 'Dana pays $49/team or $199/lab';
    stored.partC.directCompetitors = 'Old small-shop competitive positioning';

    const fromRoot = pave.applyPaveFields(stored, {
      snapshot: { founders: 'Zion Alexander Van Zandt', company: 'DENIZEN / Dolonia Data Tech Solutions' },
      partA: { customer: 'School and district economic buyers', salesCycle: 'Price is not validated' },
      partD: { foundingTeam: 'Zion Alexander Van Zandt, founder' },
    });
    assert.ok(fromRoot.applied.includes('partA.customer'));
    assert.equal(fromRoot.pave.partA.customer, 'School and district economic buyers');
    assert.equal(fromRoot.pave.snapshot.founders, 'Zion Alexander Van Zandt');
    assert.equal(fromRoot.pave.partD.foundingTeam, 'Zion Alexander Van Zandt, founder');
    assert.equal(fromRoot.pave.partA.salesCycle, 'Price is not validated');
    assert.equal(fromRoot.pave.partC.directCompetitors, 'Old small-shop competitive positioning');

    const fromLabel = pave.applyPaveFields(stored, {
      fields: {
        'Our customer (the person who pays) is': 'District buyer, unvalidated',
        'partC.directCompetitors': 'Name competitors only from interviews',
      },
    });
    assert.equal(fromLabel.pave.partA.customer, 'District buyer, unvalidated');
    assert.equal(fromLabel.pave.partC.directCompetitors, 'Name competitors only from interviews');

    const fromSnake = pave.applyPaveFields(stored, {
      part_a: { customer: 'One school buyer at a time' },
    });
    assert.equal(fromSnake.pave.partA.customer, 'One school buyer at a time');

    const ignored = pave.applyPaveFields(stored, { program_id: 'prog_1', note: 'hello' });
    assert.equal(ignored.applied.length, 0);
    assert.ok(ignored.ignored.includes('note'));
    assert.match(ignored.pave.partA.customer, /Dana/);

    const fromObjects = pave.applyPaveFields(stored, {
      partA: {
        problem: { text: 'Buyers cannot see which work is actually done.' },
        solution: { body: 'DENIZEN keeps the operating record in one office.' },
      },
      part_b: 'Ten qualifying interviews are still ahead.',
    });
    assert.equal(fromObjects.pave.partA.problem, 'Buyers cannot see which work is actually done.');
    assert.equal(fromObjects.pave.partA.solution, 'DENIZEN keeps the operating record in one office.');
    assert.equal(fromObjects.pave.partB.summaryOfCalls, 'Ten qualifying interviews are still ahead.');
    assert.deepEqual(fromObjects.ignored, []);
  });

  it('keeps every supplied Lean Canvas box and names the ones it cannot store', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const written = funding.applyLeanCanvasFields(funding.emptyLeanCanvas(), {
      problem: { text: 'Operators cannot tell which work is real.' },
      customer_segments: 'Technical founders running a company from chat.',
      unique_value_proposition: { body: 'One office that remembers the company.' },
      solution: ['Capture the work', 'Show the evidence'],
      channels: 'Founder conversations',
      revenue_streams: 'Pilot fees once a buyer commits.',
      cost_structure: 'Founder time and hosting.',
      key_metrics: 'Qualifying interviews completed.',
      unfair_advantage: 'The operating record compounds.',
      keyPartners: 'Not a Lean Canvas box',
    });
    assert.equal(written.canvas.problem, 'Operators cannot tell which work is real.');
    assert.equal(written.canvas.customerSegments, 'Technical founders running a company from chat.');
    assert.equal(written.canvas.uniqueValueProposition, 'One office that remembers the company.');
    assert.equal(written.canvas.solution, 'Capture the work\nShow the evidence');
    assert.equal(written.canvas.channels, 'Founder conversations');
    assert.equal(written.canvas.revenueStreams, 'Pilot fees once a buyer commits.');
    assert.equal(written.canvas.costStructure, 'Founder time and hosting.');
    assert.equal(written.canvas.keyMetrics, 'Qualifying interviews completed.');
    assert.equal(written.canvas.unfairAdvantage, 'The operating record compounds.');
    assert.deepEqual(written.applied.sort(), [
      'channels', 'costStructure', 'customerSegments', 'keyMetrics', 'problem',
      'revenueStreams', 'solution', 'unfairAdvantage', 'uniqueValueProposition',
    ]);
    assert.deepEqual(written.ignored, ['keyPartners']);
  });

  it('overwrites moat and capital fields instead of keeping the stored template', () => {
    const funding = require('../src/denizen-business-studio-funding');
    const moat = funding.applyMoatFields({
      primaryClaim: 'FERPA and zero cloud cost',
      primaryWhy: '80% margins',
      sources: { hardware_sovereignty: { claim: 'old mesh claim' } },
    }, {
      primary_claim: 'No defensibility claim until evidence is linked',
      primary_why: 'Copy difficulty is not established',
      sources: { hardware_sovereignty: { claim: '' } },
    });
    assert.equal(moat.moat.primaryClaim, 'No defensibility claim until evidence is linked');
    assert.equal(moat.moat.primaryWhy, 'Copy difficulty is not established');
    assert.equal(moat.moat.sources.hardware_sovereignty.claim, '');
    assert.equal(funding.applyMoatFields({ primaryClaim: 'keep' }, { program_id: 'x' }).applied.length, 0);

    const capital = funding.applyCapitalFields({
      notes: 'find ten Danas — $49/team or $199/lab',
      stage: 'pre_revenue',
      amountNeeded: 500000,
    }, {
      capital_plan: { notes: 'Pre-revenue. No fundraising amount.', amountNeeded: null },
    });
    assert.equal(capital.capitalPlan.notes, 'Pre-revenue. No fundraising amount.');
    assert.equal(capital.capitalPlan.amountNeeded, null);
    assert.equal(capital.capitalPlan.stage, 'pre_revenue');
  });

  it('sanitizes legacy thin PAVE shapes', () => {
    const pave = require('../src/denizen-business-studio-pave');
    const legacy = pave.sanitizePave({
      snapshot: { company: 'X', founder: 'Y', program: 'E3' },
      partB: { customerDiscovery: 'Heard cost pain', targetPersona: 'CTE director' },
      partC: { risks: 'Burn risk', marketSizing: { tam: 'big', sam: 'med', som: 'small' } },
    });
    assert.equal(legacy.snapshot.founders, 'Y');
    assert.equal(legacy.snapshot.cohort, 'E3');
    assert.match(legacy.partB.summaryOfCalls, /cost pain/);
    assert.match(legacy.partC.risks[0].risk, /Burn/);
    assert.equal(legacy.partC.marketSizing.tam.size, 'big');
  });
});
