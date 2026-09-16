'use strict';

/**
 * Explainable progress + business health for Business Studio.
 * Never invent percentages — derive from requirements, evidence, completion.
 */

function evidenceForRequirement(state, req) {
  const evidence = Array.isArray(state.evidence) ? state.evidence : [];
  return evidence.filter((e) => {
    if (!e) return false;
    if (req.evidenceType && e.type && e.type !== req.evidenceType && req.evidenceType !== 'document') {
      // allow linked via requirement key
    }
    if (Array.isArray(e.linkedRequirementIds) && e.linkedRequirementIds.includes(req.id)) return true;
    if (Array.isArray(e.linkedAssumptionKeys) && req.linkedAssumptionKey
      && e.linkedAssumptionKeys.includes(req.linkedAssumptionKey)) return true;
    if (e.requirementKey && e.requirementKey === req.key) return true;
    return false;
  });
}

function requirementProgress(state, req) {
  const linked = evidenceForRequirement(state, req);
  const count = linked.length;
  const target = Math.max(1, Number(req.targetCount) || 1);
  const complete = count >= target;
  return {
    id: req.id,
    key: req.key,
    title: req.title,
    count,
    target,
    complete,
    evidenceIds: linked.map((e) => e.id),
    missing: Math.max(0, target - count),
    why: complete
      ? `${count}/${target} required evidence items attached.`
      : `${count} of ${target} required evidence items attached; ${Math.max(0, target - count)} still missing.`,
  };
}

function programProgress(state, program) {
  if (!program) {
    return {
      percent: null,
      label: 'No program',
      why: 'No active program selected.',
      requirements: [],
      stageStatuses: [],
    };
  }
  const reqs = Array.isArray(program.requirements) ? program.requirements : [];
  const reqProgress = reqs.map((r) => requirementProgress(state, r));
  const done = reqProgress.filter((r) => r.complete).length;
  const total = reqProgress.length;
  const percent = total === 0 ? null : Math.round((done / total) * 100);

  const stages = Array.isArray(program.stages) ? program.stages : [];
  const stageStatuses = stages.map((stage) => {
    const stageReqs = reqProgress.filter((r) => {
      const raw = reqs.find((x) => x.id === r.id);
      return raw && raw.stageId === stage.id;
    });
    let status = stage.status || 'not_started';
    let why = `Stage marked ${status}.`;
    if (stageReqs.length) {
      const sDone = stageReqs.filter((r) => r.complete).length;
      if (sDone === stageReqs.length) {
        status = 'complete';
        why = `All ${stageReqs.length} requirements have enough evidence.`;
      } else if (sDone > 0 || stage.status === 'active') {
        status = 'active';
        why = `${sDone}/${stageReqs.length} requirements evidenced.`;
      } else if (stage.status === 'complete') {
        status = 'complete';
        why = 'Marked complete (no requirements gated).';
      } else {
        status = stage.status || 'not_started';
        why = `0/${stageReqs.length} requirements evidenced.`;
      }
    }
    return { id: stage.id, name: stage.name, status, why, requirements: stageReqs };
  });

  return {
    programId: program.id,
    programName: program.name,
    percent,
    label: percent == null ? 'No gated requirements' : `${done}/${total} requirements evidenced`,
    why: total === 0
      ? 'Program has no evidence-gated requirements yet.'
      : `${done} of ${total} program requirements have sufficient linked evidence.`,
    requirements: reqProgress,
    stageStatuses,
  };
}

function experimentProgress(exp, state) {
  const evidence = (state.evidence || []).filter((e) =>
    (Array.isArray(e.linkedExperimentIds) && e.linkedExperimentIds.includes(exp.id))
    || e.experimentId === exp.id
  );
  const count = Math.max(Number(exp.completedCount) || 0, evidence.length);
  const target = Math.max(1, Number(exp.targetCount) || 1);
  const complete = count >= target;
  return {
    id: exp.id,
    title: exp.title,
    count,
    target,
    complete,
    confidence: complete ? 'sufficient_to_decide' : 'insufficient',
    why: complete
      ? `${count}/${target} experiment samples collected — ready for a decision (not auto-validated).`
      : `${count}/${target} samples — insufficient evidence to validate the linked assumption.`,
    evidenceIds: evidence.map((e) => e.id),
  };
}

function businessHealth(state) {
  const programs = Array.isArray(state.programs) ? state.programs : [];
  const activeProgram = programs.find((p) => p.status === 'active') || programs[0] || null;
  const prog = programProgress(state, activeProgram);
  const experiments = (state.experiments || []).map((e) => experimentProgress(e, state));
  const openTasks = (state.tasks || []).filter((t) => t && t.status !== 'done' && t.status !== 'cancelled');
  const overdueTasks = openTasks.filter((t) => t.due && new Date(t.due) < new Date());

  const categories = [];

  // Customer discovery / validation
  const discoveryExp = experiments.find((e) => /interview|discovery/i.test(e.title)) || experiments[0];
  if (discoveryExp) {
    categories.push({
      id: 'customer_discovery',
      name: 'Customer Discovery',
      status: discoveryExp.complete ? 'on_track' : 'needs_attention',
      reason: discoveryExp.why,
      evidenceIds: discoveryExp.evidenceIds,
      missing: discoveryExp.complete ? [] : [`${discoveryExp.target - discoveryExp.count} more interviews/evidence`],
      recommendedAction: discoveryExp.complete
        ? 'Record a decision on the linked assumption.'
        : 'Schedule additional discovery interviews and attach evidence.',
    });
  } else {
    categories.push({
      id: 'customer_discovery',
      name: 'Customer Discovery',
      status: 'unknown',
      reason: 'No discovery experiment defined.',
      evidenceIds: [],
      missing: ['Create a discovery experiment'],
      recommendedAction: 'Create an experiment tied to a core assumption.',
    });
  }

  // Program / accelerator
  if (activeProgram) {
    const behind = (prog.requirements || []).some((r) => !r.complete && r.count < r.target);
    categories.push({
      id: 'program',
      name: 'Program / Accelerator',
      status: behind ? 'needs_attention' : (prog.percent === 100 ? 'on_track' : 'in_progress'),
      reason: prog.why,
      evidenceIds: (prog.requirements || []).flatMap((r) => r.evidenceIds || []),
      missing: (prog.requirements || []).filter((r) => !r.complete).map((r) => r.title),
      recommendedAction: behind
        ? 'Focus on the active stage’s missing evidence requirements.'
        : 'Continue executing active stage deliverables.',
    });
  }

  // Operations / tasks
  categories.push({
    id: 'operations',
    name: 'Operations',
    status: overdueTasks.length ? 'needs_attention' : (openTasks.length ? 'in_progress' : 'on_track'),
    reason: overdueTasks.length
      ? `${overdueTasks.length} overdue task(s); ${openTasks.length} open.`
      : `${openTasks.length} open task(s); none overdue.`,
    evidenceIds: [],
    missing: overdueTasks.map((t) => t.title),
    recommendedAction: overdueTasks.length
      ? 'Reschedule or complete overdue tasks this week.'
      : 'Work the highest-priority open tasks.',
  });

  // Product / technical — only if metrics present
  const techMetric = (state.metrics || []).find((m) => /mesh|technical|benchmark/i.test(m.name || m.key || ''));
  if (techMetric) {
    const ok = Number(techMetric.current) >= Number(techMetric.target || 0);
    categories.push({
      id: 'technical',
      name: 'Technical Validation',
      status: ok ? 'on_track' : 'needs_attention',
      reason: `${techMetric.name}: ${techMetric.current}/${techMetric.target} (${techMetric.source || 'manual'}).`,
      evidenceIds: [],
      missing: ok ? [] : [`Reach target for ${techMetric.name}`],
      recommendedAction: ok ? 'Keep monitoring benchmarks.' : 'Run the next technical validation test and update the metric.',
    });
  }

  // Funding readiness — counts only, never a mysterious score
  let fundingSummary = null;
  try {
    const funding = require('./denizen-business-studio-funding');
    fundingSummary = funding.evaluateFundingReadiness(state);
    const fr = fundingSummary.overall;
    categories.push({
      id: 'funding_readiness',
      name: 'Funding Readiness',
      status: fr.notStarted === fr.total
        ? 'unknown'
        : (fr.needsWork + fr.notStarted > fr.complete ? 'needs_attention' : 'in_progress'),
      reason: fr.summaryLine || fr.summary.replace(/\n/g, ' · '),
      evidenceIds: [],
      missing: fundingSummary.sections
        .flatMap((s) => s.items.filter((i) => !i.complete).map((i) => `${i.title} — ${i.display}`))
        .slice(0, 8),
      recommendedAction: 'Open Funding Readiness and attach evidence to gap items — not a vanity %.',
    });
  } catch (_) { /* optional module */ }

  let milestones = [];
  let goals = [];
  try {
    const chain = require('./denizen-business-studio-chain');
    milestones = (state.milestones || []).map((m) => chain.milestoneProgress(state, m));
    goals = (state.goals || []).map((g) => chain.goalProgress(state, g));
  } catch (_) { /* optional */ }

  return {
    generatedAt: new Date().toISOString(),
    program: prog,
    experiments,
    milestones,
    goals,
    categories,
    funding: fundingSummary,
    openTaskCount: openTasks.length,
    overdueTaskCount: overdueTasks.length,
  };
}

function explainStatus(state, subject) {
  const health = businessHealth(state);
  if (!subject || subject === 'program') {
    return { kind: 'program', ...health.program };
  }
  if (subject.startsWith('category:')) {
    const id = subject.slice('category:'.length);
    const cat = health.categories.find((c) => c.id === id);
    return cat || { kind: 'unknown', why: 'Category not found.' };
  }
  if (subject.startsWith('experiment:')) {
    const id = subject.slice('experiment:'.length);
    const exp = health.experiments.find((e) => e.id === id);
    return exp || { kind: 'unknown', why: 'Experiment not found.' };
  }
  return { kind: 'unknown', why: 'Unknown subject.' };
}

module.exports = {
  evidenceForRequirement,
  requirementProgress,
  programProgress,
  experimentProgress,
  businessHealth,
  explainStatus,
};
