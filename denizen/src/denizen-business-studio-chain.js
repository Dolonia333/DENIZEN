'use strict';

/**
 * Business Studio evidence chain — one source of truth for linking
 * discovery interviews across experiment → requirement → milestone → goal → funding.
 * Assumptions are never auto-validated; only confidence / counts move.
 */

const progress = require('./denizen-business-studio-progress');
const funding = require('./denizen-business-studio-funding');

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function activeProgram(state) {
  const programs = Array.isArray(state.programs) ? state.programs : [];
  return programs.find((p) => p.status === 'active') || programs[0] || null;
}

function findDiscoveryExperiment(state) {
  const list = Array.isArray(state.experiments) ? state.experiments : [];
  return list.find((e) => /interview|discovery/i.test(e.title || ''))
    || list.find((e) => e.method === 'customer_interview')
    || list[0]
    || null;
}

function findRequirement(state, key) {
  const prog = activeProgram(state);
  if (!prog) return null;
  return (prog.requirements || []).find((r) => r.key === key) || null;
}

/**
 * Resolve default links for a discovery interview so one write touches the full chain.
 */
function resolveDiscoveryLinks(state, input = {}) {
  const exp = input.experimentId
    ? (state.experiments || []).find((e) => e.id === input.experimentId)
    : findDiscoveryExperiment(state);
  const req = findRequirement(state, input.requirementKey || 'discovery_interviews');
  const assumptionKey = input.assumptionKey
    || exp?.assumptionKey
    || req?.linkedAssumptionKey
    || null;
  const fundingKeys = Array.isArray(input.fundingKeys) && input.fundingKeys.length
    ? input.fundingKeys
    : (input.fundingKey ? [input.fundingKey] : ['customer_discovery']);
  return {
    experimentId: exp?.id || null,
    requirementKey: req?.key || input.requirementKey || 'discovery_interviews',
    requirementId: req?.id || null,
    assumptionKey,
    fundingKeys,
  };
}

function syncMetricsFromEvidence(state) {
  const metrics = Array.isArray(state.metrics) ? state.metrics : [];
  const evidence = Array.isArray(state.evidence) ? state.evidence : [];
  const interviewCount = evidence.filter((e) => e && e.type === 'interview').length;
  for (const met of metrics) {
    if (!met || met.source !== 'evidence') continue;
    if (met.key === 'discovery_interviews') {
      met.current = interviewCount;
      met.updatedAt = new Date().toISOString();
    }
  }
  return state;
}

function syncExperimentCounts(state) {
  for (const exp of state.experiments || []) {
    if (!exp) continue;
    const ep = progress.experimentProgress(exp, state);
    exp.completedCount = ep.count;
    if (exp.assumptionKey) {
      const asm = (state.assumptions || []).find((a) => a.key === exp.assumptionKey);
      if (asm) {
        asm.confidence = ep.complete ? 'sufficient_to_decide' : 'insufficient';
        // status stays testing / founder-decided — never auto-validate
        if (asm.status !== 'validated') {
          asm.status = 'testing';
        }
      }
    }
  }
  return state;
}

function milestoneProgress(state, milestone) {
  const prog = activeProgram(state);
  const keys = Array.isArray(milestone?.requirementKeys) ? milestone.requirementKeys : [];
  if (!prog || !keys.length) {
    return {
      id: milestone?.id,
      title: milestone?.title,
      status: milestone?.status || 'todo',
      derived: false,
      complete: false,
      why: 'Milestone has no evidence-gated requirement keys.',
      requirements: [],
    };
  }
  const reqs = (prog.requirements || []).filter((r) => keys.includes(r.key));
  const reqProgress = reqs.map((r) => progress.requirementProgress(state, r));
  const complete = reqProgress.length > 0 && reqProgress.every((r) => r.complete);
  const any = reqProgress.some((r) => r.count > 0);
  let status = 'todo';
  if (complete) status = 'complete';
  else if (any || milestone.status === 'active') status = 'active';
  else if (milestone.status === 'blocked' && !any) status = 'blocked';
  return {
    id: milestone.id,
    title: milestone.title,
    status,
    derived: true,
    complete,
    why: complete
      ? `All linked requirements evidenced (${reqProgress.map((r) => `${r.count}/${r.target}`).join(', ')}).`
      : `Waiting on: ${reqProgress.filter((r) => !r.complete).map((r) => r.title).join('; ') || 'requirements'}`,
    requirements: reqProgress,
  };
}

function goalProgress(state, goal) {
  const keys = Array.isArray(goal?.metricKeys) ? goal.metricKeys : [];
  const metrics = [];
  const requirements = [];
  for (const key of keys) {
    const met = (state.metrics || []).find((m) => m.key === key);
    if (met) {
      const current = Number(met.current) || 0;
      const target = Math.max(1, Number(met.target) || 1);
      metrics.push({
        key,
        name: met.name,
        current,
        target,
        complete: current >= target,
      });
    }
    const req = findRequirement(state, key);
    if (req) requirements.push(progress.requirementProgress(state, req));
  }
  const parts = [...metrics, ...requirements];
  const complete = parts.length > 0 && parts.every((p) => p.complete);
  const any = parts.some((p) => (p.current || p.count || 0) > 0);
  return {
    id: goal?.id,
    title: goal?.title,
    status: complete ? 'complete' : (any ? 'active' : (goal?.status || 'active')),
    complete,
    derived: parts.length > 0,
    why: parts.length
      ? parts.map((p) => {
        if (p.target != null && p.current != null && p.name) return `${p.name}: ${p.current}/${p.target}`;
        if (p.target != null && p.current != null) return `${p.key}: ${p.current}/${p.target}`;
        return `${p.title || p.key}: ${p.count}/${p.target}`;
      }).join(' · ')
      : 'Goal has no metricKeys linked to metrics or requirements.',
    metrics,
    requirements,
  };
}

function syncDerivedStatuses(state) {
  syncMetricsFromEvidence(state);
  syncExperimentCounts(state);
  for (const m of state.milestones || []) {
    const mp = milestoneProgress(state, m);
    if (mp.derived) m.status = mp.status;
  }
  for (const g of state.goals || []) {
    const gp = goalProgress(state, g);
    if (gp.derived && gp.complete) g.status = 'complete';
    else if (gp.derived && g.status === 'complete' && !gp.complete) g.status = 'active';
  }
  return state;
}

/**
 * Attach evidence and wire the discovery chain when appropriate.
 * Mutates state in place; returns { evidence, links, chain }.
 */
function attachEvidence(state, input = {}) {
  if (!state || typeof state !== 'object') throw new Error('state required');
  const type = String(input.type || 'manual').trim() || 'manual';
  const isDiscovery = type === 'interview'
    || input.kind === 'discovery_interview'
    || input.autoLinkDiscovery === true;

  let links = {
    experimentId: input.experimentId || input.experiment_id || null,
    requirementKey: input.requirementKey || input.requirement_key || null,
    requirementId: input.requirementId || input.requirement_id || null,
    assumptionKey: input.assumptionKey || input.assumption_key || null,
    fundingKeys: [].concat(
      input.fundingKeys || input.funding_keys || [],
      input.fundingKey || input.funding_key || [],
    ).filter(Boolean),
  };

  if (isDiscovery) {
    const resolved = resolveDiscoveryLinks(state, {
      experimentId: links.experimentId,
      requirementKey: links.requirementKey,
      assumptionKey: links.assumptionKey,
      fundingKeys: links.fundingKeys,
      fundingKey: links.fundingKeys[0],
    });
    links = {
      experimentId: links.experimentId || resolved.experimentId,
      requirementKey: links.requirementKey || resolved.requirementKey,
      requirementId: links.requirementId || resolved.requirementId,
      assumptionKey: links.assumptionKey || resolved.assumptionKey,
      fundingKeys: links.fundingKeys.length ? links.fundingKeys : resolved.fundingKeys,
    };
  }

  const title = String(input.title || '').trim();
  if (!title) throw new Error('title required');

  const evidence = {
    id: input.id || uid('ev'),
    title,
    type,
    notes: String(input.notes || input.description || ''),
    description: String(input.description || input.notes || ''),
    persona: input.persona || null,
    insightTags: Array.isArray(input.insightTags) ? input.insightTags : (input.insight_tags || []),
    findings: Array.isArray(input.findings) ? input.findings : (input.insightTags || input.insight_tags || []),
    experimentId: links.experimentId,
    linkedExperimentIds: links.experimentId ? [links.experimentId] : [],
    requirementKey: links.requirementKey,
    linkedRequirementIds: links.requirementId ? [links.requirementId] : [],
    linkedAssumptionKeys: links.assumptionKey ? [links.assumptionKey] : [],
    fundingKey: links.fundingKeys[0] || null,
    linkedFundingKeys: links.fundingKeys,
    contactId: input.contactId || input.contact_id || null,
    contactName: input.contactName || input.contact_name || null,
    createdAt: input.createdAt || new Date().toISOString(),
    source: input.source || 'chain',
  };

  state.evidence = [evidence, ...(state.evidence || [])];

  if (evidence.contactId) {
    state.relations = Array.isArray(state.relations) ? state.relations : [];
    const exists = state.relations.some((r) =>
      r && r.kind === 'crm_contact' && r.contactId === evidence.contactId && r.evidenceId === evidence.id
    );
    if (!exists) {
      state.relations.unshift({
        id: uid('rel'),
        kind: 'crm_contact',
        contactId: evidence.contactId,
        contactName: evidence.contactName,
        evidenceId: evidence.id,
        createdAt: evidence.createdAt,
      });
    }
  }

  syncDerivedStatuses(state);
  return { evidence, links, chain: chainSnapshot(state) };
}

function attachDiscoveryInterview(state, input = {}) {
  return attachEvidence(state, {
    ...input,
    type: 'interview',
    kind: 'discovery_interview',
    autoLinkDiscovery: true,
  });
}

function fundingItemByKey(state, key) {
  const ready = funding.evaluateFundingReadiness(state);
  for (const section of ready.sections || []) {
    const item = (section.items || []).find((i) => i.key === key);
    if (item) return item;
  }
  return null;
}

/** Compact snapshot Jenny / tests can assert against. */
function chainSnapshot(state) {
  const health = progress.businessHealth(state);
  const prog = health.program;
  const milestones = (state.milestones || []).map((m) => milestoneProgress(state, m));
  const goals = (state.goals || []).map((g) => goalProgress(state, g));
  const discoveryExp = (health.experiments || []).find((e) => /interview|discovery/i.test(e.title))
    || health.experiments?.[0]
    || null;
  const frDiscovery = fundingItemByKey(state, 'customer_discovery');
  const metric = (state.metrics || []).find((m) => m.key === 'discovery_interviews');
  const crmLinked = (state.evidence || []).filter((e) => e && e.contactId).length;

  return {
    generatedAt: new Date().toISOString(),
    program: {
      percent: prog?.percent ?? null,
      label: prog?.label || null,
      why: prog?.why || null,
      discoveryRequirement: (prog?.requirements || []).find((r) => r.key === 'discovery_interviews') || null,
    },
    experiment: discoveryExp,
    milestones,
    goals,
    fundingCustomerDiscovery: frDiscovery
      ? {
        key: frDiscovery.key,
        count: frDiscovery.count,
        target: frDiscovery.target,
        complete: frDiscovery.complete,
        display: frDiscovery.display,
        status: frDiscovery.status,
      }
      : null,
    metricDiscoveryInterviews: metric
      ? { key: metric.key, current: metric.current, target: metric.target }
      : null,
    crmLinkedEvidenceCount: crmLinked,
    relationsCount: (state.relations || []).length,
    nextActions: (health.categories || [])
      .filter((c) => c.status === 'needs_attention' || c.status === 'in_progress')
      .map((c) => ({
        category: c.id,
        name: c.name,
        action: c.recommendedAction,
        why: c.reason,
      })),
    healthCategories: health.categories,
  };
}

module.exports = {
  uid,
  activeProgram,
  findDiscoveryExperiment,
  findRequirement,
  resolveDiscoveryLinks,
  syncMetricsFromEvidence,
  syncExperimentCounts,
  syncDerivedStatuses,
  milestoneProgress,
  goalProgress,
  attachEvidence,
  attachDiscoveryInterview,
  chainSnapshot,
  fundingItemByKey,
};
