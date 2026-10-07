'use strict';

/**
 * i2E E3 / PAVE program template for Business Studio.
 * Template-driven — not hard-coded into the UI shell.
 */

const paveMod = require('./denizen-business-studio-pave');

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildE3Template(opts = {}) {
  const businessName = opts.businessName || 'DENIZEN / Dolonia Data Tech Solutions';
  const founderName = opts.founderName || 'Founder';
  const now = new Date().toISOString();
  const programId = uid('prog');

  const stages = [
    { id: 'idea', name: 'Idea', order: 1, status: 'complete' },
    { id: 'prototype', name: 'Prototype', order: 2, status: 'complete' },
    { id: 'validate', name: 'Customer Validation', order: 3, status: 'active' },
    { id: 'pilot', name: 'Pilot', order: 4, status: 'not_started' },
    { id: 'revenue', name: 'Revenue', order: 5, status: 'not_started' },
  ];

  const requirements = [
    {
      id: uid('req'),
      programId,
      stageId: 'validate',
      key: 'discovery_interviews',
      title: 'Customer discovery interviews',
      description: 'Complete 10 qualifying interviews with school or district buyers. Meetings and CRM contacts do not count. Contradictory evidence counts.',
      evidenceType: 'interview',
      targetCount: 10,
      linkedAssumptionKey: 'sessions_die_no_office',
    },
    {
      id: uid('req'),
      programId,
      stageId: 'validate',
      key: 'pave_part_b',
      title: 'PAVE Part B — Discovery findings',
      description: 'Document persona, expected/unexpected findings, persona decision.',
      evidenceType: 'document',
      targetCount: 1,
    },
    {
      id: uid('req'),
      programId,
      stageId: 'pilot',
      key: 'pilot_agreement',
      title: 'Pilot evaluation agreement',
      description: 'At least one school or district economic buyer agrees to evaluate a pilot. Not assumed.',
      evidenceType: 'signed_pilot',
      targetCount: 1,
    },
  ];

  const deliverables = [
    { id: uid('del'), programId, title: 'Company Snapshot', section: 'snapshot', status: 'todo' },
    { id: uid('del'), programId, title: 'PAVE Part A — Customer / Problem / Solution', section: 'part_a', status: 'todo' },
    { id: uid('del'), programId, title: 'PAVE Part B — Customer Discovery', section: 'part_b', status: 'todo' },
    { id: uid('del'), programId, title: 'PAVE Part C — Competition & Market', section: 'part_c', status: 'todo' },
    { id: uid('del'), programId, title: 'PAVE Part D — Team & Pitch', section: 'part_d', status: 'todo' },
    { id: uid('del'), programId, title: 'Final PAVE — Risks & Next Steps', section: 'final', status: 'todo' },
  ];

  const milestones = [
    {
      id: uid('ms'),
      programId,
      stageId: 'validate',
      title: '10 discovery interviews complete',
      status: 'active',
      due: null,
      requirementKeys: ['discovery_interviews'],
    },
    {
      id: uid('ms'),
      programId,
      stageId: 'validate',
      title: 'PAVE Part B drafted',
      status: 'todo',
      due: null,
      requirementKeys: ['pave_part_b'],
    },
    {
      id: uid('ms'),
      programId,
      stageId: 'pilot',
      title: 'First pilot commitment',
      status: 'blocked',
      due: null,
      requirementKeys: ['pilot_agreement'],
      blockedReason: 'Requires validated discovery evidence first',
    },
  ];

  const tasks = [
    {
      id: uid('task'),
      title: 'Schedule two customer discovery interviews',
      status: 'todo',
      priority: 'high',
      due: null,
      programId,
      stageId: 'validate',
      owner: founderName,
      source: 'e3_template',
    },
    {
      id: uid('task'),
      title: 'Update PAVE Part B with interview findings',
      status: 'todo',
      priority: 'medium',
      due: null,
      programId,
      stageId: 'validate',
      owner: founderName,
      source: 'e3_template',
    },
    {
      id: uid('task'),
      title: 'Follow up with mentor on discovery plan',
      status: 'todo',
      priority: 'medium',
      due: null,
      programId,
      stageId: 'validate',
      owner: founderName,
      source: 'e3_template',
    },
  ];

  const assumptions = [
    {
      id: uid('asm'),
      key: 'sessions_die_no_office',
      title: 'Founder-operators lose work when AI chat sessions die — no shared memory or receipts',
      status: 'testing',
      confidence: 'insufficient',
      programId,
      createdAt: now,
    },
  ];

  const experiments = [
    {
      id: uid('exp'),
      title: '10 qualifying school or district buyer interviews',
      assumptionKey: 'sessions_die_no_office',
      status: 'active',
      targetCount: 10,
      completedCount: 0,
      programId,
      method: 'customer_interview',
      createdAt: now,
    },
  ];

  const goals = [
    {
      id: uid('goal'),
      title: 'Validate DENIZEN with 10 qualifying school or district buyer interviews',
      status: 'active',
      programId,
      metricKeys: ['discovery_interviews'],
      createdAt: now,
    },
  ];

  const metrics = [
    {
      id: uid('met'),
      key: 'discovery_interviews',
      name: 'Customer discovery interviews',
      category: 'customer_discovery',
      current: 0,
      target: 10,
      unit: 'count',
      source: 'evidence',
      sharedWithAdvisors: true,
      updatedAt: now,
    },
    {
      id: uid('met'),
      key: 'active_pilots',
      name: 'Active pilots',
      category: 'sales',
      current: 0,
      target: 1,
      unit: 'count',
      source: 'manual',
      sharedWithAdvisors: true,
      updatedAt: now,
    },
  ];

  const strategyNodes = [
    { id: 'n_vision', type: 'vision', label: 'Vision', x: 80, y: 40, text: `${businessName} as the AI business OS` },
    { id: 'n_market', type: 'market', label: 'Market', x: 80, y: 120, text: 'Education / CTE operators + founder teams' },
    { id: 'n_problem', type: 'problem', label: 'Problem', x: 80, y: 200, text: 'Recurring cloud AI cost + fragmented ops tools' },
    { id: 'n_customer', type: 'customer', label: 'Customer', x: 80, y: 280, text: 'CTE / IT decision makers' },
    { id: 'n_assumption', type: 'assumption', label: 'Assumption', x: 80, y: 360, text: 'Cost + fragmentation are buying triggers' },
    { id: 'n_experiment', type: 'experiment', label: 'Experiment', x: 80, y: 440, text: '10 discovery interviews' },
    { id: 'n_evidence', type: 'evidence', label: 'Evidence', x: 80, y: 520, text: 'Interview ledger' },
    { id: 'n_decision', type: 'decision', label: 'Decision', x: 80, y: 600, text: 'Persona + pilot path' },
    { id: 'n_milestone', type: 'milestone', label: 'Milestone', x: 80, y: 680, text: 'Validation complete' },
    { id: 'n_outcome', type: 'outcome', label: 'Outcome', x: 80, y: 760, text: 'Pilot commitment' },
  ];

  const strategyEdges = [
    ['n_vision', 'n_market'],
    ['n_market', 'n_problem'],
    ['n_problem', 'n_customer'],
    ['n_customer', 'n_assumption'],
    ['n_assumption', 'n_experiment'],
    ['n_experiment', 'n_evidence'],
    ['n_evidence', 'n_decision'],
    ['n_decision', 'n_milestone'],
    ['n_milestone', 'n_outcome'],
  ].map(([from, to], i) => ({ id: `e_${i}`, from, to }));

  const pave = paveMod.sanitizePave({
    ...paveMod.emptyPave(),
    snapshot: {
      company: businessName,
      founders: founderName,
      i2eAdvisor: opts.advisor || '',
      cohort: opts.cohort || 'i2E E3',
      productDescription: '',
    },
    partB: {
      ...paveMod.emptyPave().partB,
      interviewGoal: '10+',
    },
    partD: {
      ...paveMod.emptyPave().partD,
      foundingTeam: founderName,
    },
    living: true,
  });

  return {
    templateId: 'i2e-e3-pave',
    templateName: 'i2E E3 / PAVE',
    program: {
      id: programId,
      name: 'i2E E3',
      templateId: 'i2e-e3-pave',
      cohort: opts.cohort || '',
      advisor: opts.advisor || '',
      startDate: opts.startDate || null,
      endDate: opts.endDate || null,
      status: 'active',
      stages,
      requirements,
      deliverables,
      pave,
      createdAt: now,
      sharedWithAdvisors: true,
    },
    milestones,
    tasks,
    assumptions,
    experiments,
    goals,
    metrics,
    strategyNodes,
    strategyEdges,
  };
}

const PROGRAM_TEMPLATES = Object.freeze([
  {
    id: 'i2e-e3-pave',
    name: 'i2E E3 / PAVE',
    category: 'accelerators',
    description: 'Customer discovery, PAVE workflow, mentor checkpoints for i2E E3.',
    build: buildE3Template,
  },
  {
    id: '90-day-launch',
    name: '90-Day Launch',
    category: 'start',
    description: 'Generic 90-day launch roadmap (structure only — customize goals).',
    build: (opts = {}) => {
      const base = buildE3Template(opts);
      base.templateId = '90-day-launch';
      base.templateName = '90-Day Launch';
      base.program.name = '90-Day Launch';
      base.program.templateId = '90-day-launch';
      base.program.pave = null;
      return base;
    },
  },
]);

function listProgramTemplates() {
  return PROGRAM_TEMPLATES.map(({ id, name, category, description }) => ({
    id, name, category, description,
  }));
}

function applyProgramTemplate(templateId, opts = {}) {
  const tpl = PROGRAM_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) {
    const err = new Error(`Unknown program template: ${templateId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return tpl.build(opts);
}

module.exports = {
  buildE3Template,
  listProgramTemplates,
  applyProgramTemplate,
  PROGRAM_TEMPLATES,
  emptyPave: paveMod.emptyPave,
  sanitizePave: paveMod.sanitizePave,
  denizenPaveDraft: paveMod.denizenPaveDraft,
};
