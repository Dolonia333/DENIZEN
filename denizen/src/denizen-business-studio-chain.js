'use strict';

/**
 * Business Studio evidence chain — single writer + derived views.
 *
 * Downstream systems ask "what qualifying evidence exists?" via the ledger.
 * This module attaches/revokes evidence and syncs *derived* display fields only.
 * Assumptions are never auto-validated.
 */

const progress = require('./denizen-business-studio-progress');
const funding = require('./denizen-business-studio-funding');
const ledger = require('./denizen-business-studio-evidence');

function uid(prefix) {
  return ledger.uid(prefix);
}

function activeProgram(state) {
  const programs = Array.isArray(state.programs) ? state.programs : [];
  return programs.find((p) => p.status === 'active') || programs[0] || null;
}

function findDiscoveryExperiment(state) {
  const list = Array.isArray(state.experiments) ? state.experiments : [];
  return list.find((e) => /interview|discovery/i.test(e.title || ''))
    || list.find((e) => e.method === 'customer_interview')
    || null;
}

function findRequirement(state, key) {
  const prog = activeProgram(state);
  if (!prog) return null;
  return (prog.requirements || []).find((r) => r.key === key) || null;
}

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

/** Derived display caches only — never authoritative. */
function syncMetricsFromEvidence(state) {
  const metrics = Array.isArray(state.metrics) ? state.metrics : [];
  const req = findRequirement(state, 'discovery_interviews');
  const q = req
    ? ledger.qualifyingEvidence(state, { requirement: req })
    : ledger.qualifyingEvidence(state, { type: 'interview', fundingKey: 'customer_discovery' });
  for (const met of metrics) {
    if (!met || met.source !== 'evidence') continue;
    if (met.key === 'discovery_interviews') {
      met.current = q.count;
      met.updatedAt = new Date().toISOString();
    }
  }
  return state;
}

function syncExperimentCounts(state) {
  for (const exp of state.experiments || []) {
    if (!exp) continue;
    const ep = progress.experimentProgress(exp, state);
    // Cache only — progress always re-derives from qualifying evidence
    exp.completedCount = ep.count;
    if (exp.assumptionKey) {
      const asm = (state.assumptions || []).find((a) => a.key === exp.assumptionKey);
      if (asm && asm.status !== 'validated') {
        const stance = ledger.assumptionStance(state, asm);
        asm.confidence = stance.confidence;
        asm.status = stance.status === 'validated' ? 'validated' : stance.status;
        asm.stanceSummary = {
          supports: stance.supports,
          contradicts: stance.contradicts,
          neutral: stance.neutral,
        };
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
    const req = findRequirement(state, key);
    if (req) {
      const rp = progress.requirementProgress(state, req);
      requirements.push(rp);
      metrics.push({
        key,
        name: req.title,
        current: rp.count,
        target: rp.target,
        complete: rp.complete,
      });
      continue;
    }
    const met = (state.metrics || []).find((m) => m.key === key);
    if (met) {
      // Prefer qualifying evidence over stale metric.current when source=evidence
      let current = Number(met.current) || 0;
      if (met.source === 'evidence' && met.key === 'discovery_interviews') {
        const q = ledger.qualifyingEvidence(state, {
          requirementKey: 'discovery_interviews',
          type: 'interview',
        });
        current = q.count;
      }
      const target = Math.max(1, Number(met.target) || 1);
      metrics.push({
        key,
        name: met.name,
        current,
        target,
        complete: current >= target,
      });
    }
  }
  const parts = metrics.length ? metrics : requirements;
  const complete = parts.length > 0 && parts.every((p) => p.complete);
  const any = parts.some((p) => (p.current || p.count || 0) > 0);
  return {
    id: goal?.id,
    title: goal?.title,
    status: complete ? 'complete' : (any ? 'active' : (goal?.status || 'active')),
    complete,
    derived: parts.length > 0,
    why: parts.length
      ? parts.map((p) => `${p.name || p.title || p.key}: ${p.current ?? p.count}/${p.target}`).join(' · ')
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

function attachEvidence(state, input = {}) {
  if (!state || typeof state !== 'object') throw new Error('state required');
  const type = String(input.type || 'manual').trim() || 'manual';
  const autoLink = input.autoLinkDiscovery !== false
    && (type === 'interview'
      || input.kind === 'discovery_interview'
      || input.autoLinkDiscovery === true);

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

  if (autoLink) {
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
    stance: input.stance || input.hypothesisStance || 'neutral',
    experimentId: links.experimentId,
    linkedExperimentIds: links.experimentId ? [links.experimentId] : [],
    requirementKey: links.requirementKey,
    linkedRequirementIds: links.requirementId ? [links.requirementId] : [],
    linkedAssumptionKeys: links.assumptionKey ? [links.assumptionKey] : [],
    fundingKey: links.fundingKeys[0] || null,
    linkedFundingKeys: links.fundingKeys,
    contactId: input.contactId || input.contact_id || null,
    contactName: input.contactName || input.contact_name || null,
    qualifying: input.qualifying === false ? false : (input.qualifying === true ? true : undefined),
    createdAt: input.createdAt || new Date().toISOString(),
    source: input.source || 'chain',
    revoked: false,
    status: 'active',
  };
  evidence.fingerprint = ledger.evidenceFingerprint(evidence);

  const dup = ledger.findDuplicate(state, evidence);
  if (dup) {
    syncDerivedStatuses(state);
    return {
      evidence: dup,
      links,
      duplicate: true,
      chain: chainSnapshot(state),
    };
  }

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
  return { evidence, links, duplicate: false, chain: chainSnapshot(state) };
}

function attachDiscoveryInterview(state, input = {}) {
  return attachEvidence(state, {
    ...input,
    type: 'interview',
    kind: 'discovery_interview',
    autoLinkDiscovery: true,
  });
}

function linkValidatedInterview(state, input = {}) {
  const qualifying = input.qualifying === true || input.validated === true;
  if (!qualifying) {
    throw new Error('qualifying: true required — an unvalidated conversation is not interview evidence');
  }
  const contactId = input.contactId || input.contact_id;
  if (contactId == null || contactId === '') throw new Error('contact_id required');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title required');
  const result = attachEvidence(state, {
    ...input,
    title,
    contactId,
    type: 'interview',
    kind: 'discovery_interview',
    qualifying: true,
    stance: input.stance || 'validated',
    autoLinkDiscovery: true,
  });
  const nextTask = {
    title: `Review qualifying interview: ${result.evidence.title}`,
    contactId,
    evidenceId: result.evidence.id,
    experimentId: result.evidence.experimentId || null,
    source: 'evidence-chain',
  };
  return { ...result, nextTask, counted: result.duplicate !== true };
}

function revokeAndResync(state, evidenceId, opts = {}) {
  const result = ledger.revokeEvidence(state, evidenceId, opts);
  if (!result.ok) return result;
  syncDerivedStatuses(state);
  return { ok: true, evidence: result.evidence, chain: chainSnapshot(state) };
}

function fundingItemByKey(state, key) {
  const ready = funding.evaluateFundingReadiness(state);
  for (const section of ready.sections || []) {
    const item = (section.items || []).find((i) => i.key === key);
    if (item) return item;
  }
  return null;
}

function primaryAssumption(state) {
  const asm = (state.assumptions || []).find((a) => a.status !== 'validated')
    || (state.assumptions || [])[0]
    || null;
  if (!asm) return null;
  return ledger.assumptionStance(state, asm);
}

function blockingMilestone(state) {
  const milestones = (state.milestones || []).map((m) => milestoneProgress(state, m));
  return milestones.find((m) => !m.complete && (m.status === 'active' || m.status === 'blocked' || m.status === 'todo'))
    || null;
}

/**
 * Compact agent working set — minimum authoritative context for the current objective.
 * Not a dump of the company database.
 */
function workingSetBrief(state) {
  const prog = progress.programProgress(state, activeProgram(state));
  const disc = (prog.requirements || []).find((r) => r.key === 'discovery_interviews') || null;
  const fr = fundingItemByKey(state, 'customer_discovery');
  const asm = primaryAssumption(state);
  const block = blockingMilestone(state);
  const discoveryExpEntity = findDiscoveryExperiment(state);
  const experiment = discoveryExpEntity
    ? progress.experimentProgress(discoveryExpEntity, state)
    : null;
  const missing = disc ? Math.max(0, disc.target - disc.count) : 0;
  const objective = (state.goals || []).find((g) => g.status !== 'complete')?.title
    || 'Validate customer segment with qualifying evidence';

  let recommended = 'Record qualifying discovery evidence linked to the active experiment.';
  let reason = 'No discovery requirement found.';
  if (disc && !disc.complete) {
    recommended = `Conduct ${missing} additional qualifying interview${missing === 1 ? '' : 's'}`;
    reason = `E3 requirement requires ${disc.target}; current qualifying evidence count is ${disc.count}.`;
  } else if (disc?.complete && asm && !asm.validated && asm.confidence !== 'contradicted') {
    recommended = 'Review interview findings and decide on the primary assumption (do not auto-validate).';
    reason = `Program discovery is ${disc.count}/${disc.target}, but the hypothesis remains unresolved.`;
  } else if (asm?.confidence === 'contradicted') {
    recommended = 'Revisit the primary assumption — evidence currently contradicts the thesis.';
    reason = asm.why;
  } else if (fr && !fr.complete) {
    recommended = 'Attach evidence to remaining Funding Readiness gaps.';
    reason = fr.display || fr.why || 'Customer discovery funding item incomplete.';
  }

  return {
    current_objective: objective,
    e3_discovery: disc
      ? {
        count: disc.count,
        target: disc.target,
        complete: disc.complete,
        label: `${disc.count}/${disc.target} qualifying interviews`,
        evidence_ids: disc.evidenceIds || [],
      }
      : null,
    evidence_count: disc?.count ?? ledger.qualifyingEvidence(state, { type: 'interview' }).count,
    primary_assumption: asm
      ? {
        key: asm.key,
        title: asm.title,
        status: asm.validated ? 'validated' : (asm.confidence === 'contradicted' ? 'challenged' : 'unresolved'),
        confidence: asm.confidence,
        supports: asm.supports,
        contradicts: asm.contradicts,
        why: asm.why,
      }
      : { status: 'none' },
    funding_readiness: fr
      ? {
        customer_discovery: fr.complete ? 'complete' : 'incomplete',
        count: fr.count,
        target: fr.target,
        display: fr.display,
      }
      : null,
    blocking_milestone: block
      ? { title: block.title, status: block.status, why: block.why }
      : null,
    recommended_next_action: recommended,
    reason,
    program_percent: prog.percent,
    experiment: experiment
      ? { id: experiment.id, title: experiment.title, count: experiment.count, target: experiment.target }
      : null,
  };
}

function chainSnapshot(state) {
  const health = progress.businessHealth(state);
  const prog = health.program;
  const milestones = (state.milestones || []).map((m) => milestoneProgress(state, m));
  const goals = (state.goals || []).map((g) => goalProgress(state, g));
  const discoveryExpEntity = findDiscoveryExperiment(state);
  const discoveryExp = discoveryExpEntity
    ? progress.experimentProgress(discoveryExpEntity, state)
    : ((health.experiments || [])[0] || null);
  const frDiscovery = fundingItemByKey(state, 'customer_discovery');
  const discReq = (prog?.requirements || []).find((r) => r.key === 'discovery_interviews') || null;
  const metricCount = discReq
    ? discReq.count
    : ledger.qualifyingEvidence(state, { type: 'interview', fundingKey: 'customer_discovery' }).count;
  const metric = (state.metrics || []).find((m) => m.key === 'discovery_interviews');
  const crmLinked = ledger.qualifyingEvidence(state, {}).evidence.filter((e) => e.contactId).length;
  const asm = primaryAssumption(state);
  const block = blockingMilestone(state);

  return {
    generatedAt: new Date().toISOString(),
    program: {
      percent: prog?.percent ?? null,
      label: prog?.label || null,
      why: prog?.why || null,
      discoveryRequirement: discReq,
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
    metricDiscoveryInterviews: {
      key: 'discovery_interviews',
      current: metricCount,
      target: metric?.target || discReq?.target || 10,
    },
    primaryAssumption: asm,
    blockingMilestone: block,
    crmLinkedEvidenceCount: crmLinked,
    relationsCount: (state.relations || []).filter((r) => {
      if (!r?.evidenceId) return true;
      const ev = ledger.findEvidenceById(state, r.evidenceId);
      return !ev || ledger.isActiveEvidence(ev);
    }).length,
    nextActions: (health.categories || [])
      .filter((c) => c.status === 'needs_attention' || c.status === 'in_progress')
      .map((c) => ({
        category: c.id,
        name: c.name,
        action: c.recommendedAction,
        why: c.reason,
      })),
    workingSet: workingSetBrief(state),
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
  linkValidatedInterview,
  revokeAndResync,
  chainSnapshot,
  workingSetBrief,
  fundingItemByKey,
  primaryAssumption,
  blockingMilestone,
};
