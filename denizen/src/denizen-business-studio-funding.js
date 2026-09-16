'use strict';

/**
 * Funding Readiness + Market Sizing + Moat builders for Business Studio.
 * Evidence-gated checklist — never invent a mysterious "72% funding ready" score.
 */

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Canonical Funding Readiness rubric (Venture / investor lens). */
const FUNDING_READINESS_SECTIONS = Object.freeze([
  {
    id: 'problem',
    name: 'Problem / Product',
    items: [
      { key: 'problem_need', title: 'Problem / Need', evidenceTypes: ['interview', 'document', 'survey'] },
      { key: 'customer_definition', title: 'Customer Definition', evidenceTypes: ['interview', 'document'] },
      { key: 'customer_discovery', title: 'Customer Discovery', evidenceTypes: ['interview'], targetCount: 10 },
      { key: 'product_solution', title: 'Product / Solution', evidenceTypes: ['document', 'technical_test', 'prototype'] },
      { key: 'pm_validation', title: 'Product-Market Validation', evidenceTypes: ['interview', 'signed_pilot', 'metric'] },
      { key: 'business_model', title: 'Business Model', evidenceTypes: ['document'] },
      { key: 'revenue_model', title: 'Revenue Model', evidenceTypes: ['document', 'metric'] },
      { key: 'pricing_validation', title: 'Pricing Validation', evidenceTypes: ['interview', 'survey', 'metric'] },
    ],
  },
  {
    id: 'market',
    name: 'Market',
    items: [
      { key: 'tam', title: 'TAM', evidenceTypes: ['document', 'metric', 'market_sizing'] },
      { key: 'sam', title: 'SAM', evidenceTypes: ['document', 'metric', 'market_sizing'] },
      { key: 'som', title: 'SOM', evidenceTypes: ['document', 'metric', 'market_sizing'] },
      { key: 'market_growth', title: 'Market Growth', evidenceTypes: ['document', 'metric'] },
      { key: 'beachhead', title: 'Beachhead Market', evidenceTypes: ['interview', 'document'] },
    ],
  },
  {
    id: 'competition',
    name: 'Competition',
    items: [
      { key: 'competitive_matrix', title: 'Competitive Matrix', evidenceTypes: ['document'] },
      { key: 'direct_competitors', title: 'Direct Competitors', evidenceTypes: ['document'] },
      { key: 'indirect_competitors', title: 'Indirect Competitors', evidenceTypes: ['document'] },
      { key: 'moat', title: 'Moat', evidenceTypes: ['document', 'technical_test', 'moat_claim'] },
      { key: 'defensibility_evidence', title: 'Defensibility Evidence', evidenceTypes: ['technical_test', 'interview', 'metric'] },
    ],
  },
  {
    id: 'gtm',
    name: 'Go-to-Market',
    items: [
      { key: 'economic_buyer', title: 'Economic Buyer', evidenceTypes: ['interview', 'document'] },
      { key: 'decision_maker', title: 'Decision Maker', evidenceTypes: ['interview', 'document'] },
      { key: 'sales_cycle', title: 'Sales Cycle', evidenceTypes: ['interview', 'document'] },
      { key: 'channels', title: 'Channels', evidenceTypes: ['document'] },
      { key: 'cac_assumptions', title: 'CAC Assumptions', evidenceTypes: ['document', 'metric'] },
      { key: 'pilot_strategy', title: 'Pilot Strategy', evidenceTypes: ['document', 'signed_pilot'] },
    ],
  },
  {
    id: 'financials',
    name: 'Financials',
    items: [
      { key: 'forecast_3y', title: '3-Year Forecast', evidenceTypes: ['document', 'workbook'] },
      { key: 'cash_flow', title: 'Cash Flow', evidenceTypes: ['document', 'workbook', 'metric'] },
      { key: 'burn', title: 'Burn', evidenceTypes: ['metric', 'workbook'] },
      { key: 'runway', title: 'Runway', evidenceTypes: ['metric', 'workbook'] },
      { key: 'break_even', title: 'Break-Even', evidenceTypes: ['document', 'workbook'] },
      { key: 'unit_economics', title: 'Unit Economics', evidenceTypes: ['document', 'workbook'] },
      { key: 'use_of_funds', title: 'Use of Funds', evidenceTypes: ['document'] },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    items: [
      { key: 'founders', title: 'Founders', evidenceTypes: ['document'] },
      { key: 'roles', title: 'Roles', evidenceTypes: ['document'] },
      { key: 'critical_gaps', title: 'Critical Gaps', evidenceTypes: ['document'] },
      { key: 'hiring_plan', title: 'Hiring Plan', evidenceTypes: ['document'] },
      { key: 'advisors', title: 'Advisors', evidenceTypes: ['document', 'meeting'] },
    ],
  },
  {
    id: 'investor_materials',
    name: 'Investor Materials',
    items: [
      { key: 'lean_canvas', title: 'Lean Canvas', evidenceTypes: ['document'] },
      { key: 'exec_summary', title: 'Executive Summary', evidenceTypes: ['document'] },
      { key: 'pitch_deck', title: 'Pitch Deck', evidenceTypes: ['document'] },
      { key: 'financial_model', title: 'Financial Model', evidenceTypes: ['document', 'workbook'] },
      { key: 'data_room', title: 'Data Room', evidenceTypes: ['document'] },
      { key: 'pitch_90', title: '90-Second Pitch', evidenceTypes: ['document'] },
      { key: 'pitch_5m', title: '5-Minute Pitch', evidenceTypes: ['document'] },
      { key: 'investor_qa', title: 'Investor Q&A', evidenceTypes: ['document'] },
    ],
  },
]);

const MOAT_SOURCES = Object.freeze([
  { key: 'technology_ip', title: 'Technology / IP' },
  { key: 'proprietary_data', title: 'Proprietary Data' },
  { key: 'network_effects', title: 'Network Effects' },
  { key: 'switching_costs', title: 'Switching Costs' },
  { key: 'distribution', title: 'Distribution' },
  { key: 'brand_community', title: 'Brand / Community' },
  { key: 'cost_advantage', title: 'Cost Advantage' },
  { key: 'integrations', title: 'Integrations / Workflow' },
  { key: 'operational_knowhow', title: 'Operational Know-how' },
  { key: 'regulatory', title: 'Regulatory / Compliance' },
]);

function emptyFundingState() {
  return {
    items: {}, // key -> { statusNote, claim, linkedEvidenceIds[], markedComplete }
    marketSizing: {
      tamOrgs: null,
      samOrgs: null,
      somPct: null,
      acv: null,
      geography: '',
      buyerWho: '',
      sources: { tam: '', sam: '', som: '' },
      calculated: null,
    },
    moat: {
      sources: {}, // key -> { status: none|partial|strong, claim, copyDifficulty, monthsToCopy, evidenceIds[] }
      primaryClaim: '',
    },
    capitalPlan: {
      stage: 'pre_revenue',
      amountNeeded: null,
      uses: [],
      types: [],
      notes: '',
    },
    unansweredInvestorQuestions: [],
  };
}

function evidenceForFundingItem(state, item) {
  const evidence = Array.isArray(state.evidence) ? state.evidence : [];
  return evidence.filter((e) => {
    if (!e) return false;
    if (Array.isArray(e.linkedFundingKeys) && e.linkedFundingKeys.includes(item.key)) return true;
    if (e.fundingKey === item.key) return true;
    // Heuristic: type match + optional tag — never invent completeness from tasks
    if (item.evidenceTypes && item.evidenceTypes.includes(e.type)
      && (e.fundingKey === item.key || (Array.isArray(e.tags) && e.tags.includes(item.key)))) {
      return true;
    }
    return false;
  });
}

function evaluateFundingItem(state, item, fundingOverrides = {}) {
  const linked = evidenceForFundingItem(state, item);
  const override = fundingOverrides[item.key] || {};
  const target = Math.max(1, Number(item.targetCount) || 1);
  const count = Math.max(linked.length, Number(override.manualCount) || 0);
  const complete = !!(override.markedComplete) || count >= target;
  let status = 'not_started';
  if (complete) status = 'complete';
  else if (count > 0) status = 'in_progress';
  else if (override.needsEvidence) status = 'needs_evidence';
  else status = 'not_started';

  // Discovery special case: always show X/Y
  const label = item.targetCount
    ? `${count} / ${target}`
    : (complete ? 'Evidence' : (count > 0 ? 'In progress' : 'Not started'));

  return {
    key: item.key,
    title: item.title,
    status,
    count,
    target,
    complete,
    label,
    evidenceIds: linked.map((e) => e.id),
    why: complete
      ? `${count}/${target} linked evidence item(s) — founder may mark ready for investor review.`
      : count > 0
        ? `${count}/${target} evidence linked; still insufficient.`
        : `No evidence linked for "${item.title}". Attach interviews, documents, or metrics.`,
    recommendedAction: complete
      ? 'Keep evidence current; include in mentor/investor share pack.'
      : `Add evidence for ${item.title} (accepted types: ${(item.evidenceTypes || []).join(', ') || 'any'}).`,
  };
}

function evaluateFundingReadiness(state) {
  const funding = state.funding || emptyFundingState();
  const sections = FUNDING_READINESS_SECTIONS.map((sec) => {
    const items = sec.items.map((item) => evaluateFundingItem(state, item, funding.items));
    return {
      id: sec.id,
      name: sec.name,
      items,
      completeCount: items.filter((i) => i.complete).length,
      needsWorkCount: items.filter((i) => !i.complete && i.count > 0).length,
      notStartedCount: items.filter((i) => i.status === 'not_started').length,
    };
  });
  const allItems = sections.flatMap((s) => s.items);
  const complete = allItems.filter((i) => i.complete).length;
  const needsWork = allItems.filter((i) => !i.complete && (i.count > 0 || i.status === 'in_progress' || i.status === 'needs_evidence')).length;
  const notStarted = allItems.filter((i) => i.status === 'not_started').length;
  return {
    generatedAt: new Date().toISOString(),
    sections,
    overall: {
      complete,
      needsWork,
      notStarted,
      total: allItems.length,
      // Explicitly NOT a mysterious readiness %. Counts only.
      summary: `${complete} complete · ${needsWork} need work · ${notStarted} not started`,
      why: 'Counts items with linked evidence (or explicit founder mark). Tasks alone never count as funding readiness.',
    },
  };
}

function calculateMarketSizing(input = {}) {
  const tamOrgs = Number(input.tamOrgs);
  const samOrgs = Number(input.samOrgs);
  const somPct = Number(input.somPct);
  const acv = Number(input.acv);
  const out = {
    inputs: {
      tamOrgs: Number.isFinite(tamOrgs) ? tamOrgs : null,
      samOrgs: Number.isFinite(samOrgs) ? samOrgs : null,
      somPct: Number.isFinite(somPct) ? somPct : null,
      acv: Number.isFinite(acv) ? acv : null,
      geography: String(input.geography || ''),
      buyerWho: String(input.buyerWho || ''),
    },
    tamValue: null,
    samValue: null,
    somOrgs: null,
    somValue: null,
    warnings: [],
  };
  if (out.inputs.tamOrgs != null && out.inputs.acv != null) {
    out.tamValue = out.inputs.tamOrgs * out.inputs.acv;
  }
  if (out.inputs.samOrgs != null && out.inputs.acv != null) {
    out.samValue = out.inputs.samOrgs * out.inputs.acv;
  }
  if (out.inputs.samOrgs != null && out.inputs.somPct != null) {
    out.somOrgs = out.inputs.samOrgs * (out.inputs.somPct / 100);
    if (out.inputs.acv != null) out.somValue = out.somOrgs * out.inputs.acv;
  }
  if (out.inputs.somPct != null && out.inputs.somPct > 5 && !input.somEvidence) {
    out.warnings.push('SOM capture rate above 5% needs supporting evidence — mentors will challenge this.');
  }
  if (!input.sources?.tam) out.warnings.push('TAM source missing.');
  if (!input.sources?.sam) out.warnings.push('SAM source missing.');
  if (!input.sources?.som) out.warnings.push('SOM assumption source missing.');
  return out;
}

function evaluateMoat(state) {
  const moat = state.funding?.moat || emptyFundingState().moat;
  const sources = MOAT_SOURCES.map((src) => {
    const row = moat.sources?.[src.key] || {};
    const evidenceIds = Array.isArray(row.evidenceIds) ? row.evidenceIds : [];
    const linked = (state.evidence || []).filter((e) =>
      evidenceIds.includes(e.id)
      || e.moatKey === src.key
      || (Array.isArray(e.linkedMoatKeys) && e.linkedMoatKeys.includes(src.key))
    );
    let status = row.status || 'none';
    if (linked.length && status === 'none') status = 'partial';
    const copyMonths = Number(row.monthsToCopy);
    let defensibility = 'needs_more_evidence';
    if (linked.length >= 2 && status === 'strong' && Number.isFinite(copyMonths) && copyMonths >= 12) {
      defensibility = 'defensible_claim';
    } else if (linked.length >= 1) {
      defensibility = 'advantage_not_yet_moat';
    }
    return {
      key: src.key,
      title: src.title,
      status,
      claim: row.claim || '',
      copyDifficulty: row.copyDifficulty || '',
      monthsToCopy: Number.isFinite(copyMonths) ? copyMonths : null,
      evidenceIds: linked.map((e) => e.id),
      defensibility,
      why: linked.length
        ? `${linked.length} evidence linked. Advantage ≠ moat until copy difficulty is evidenced.`
        : 'No evidence. First-mover alone is not a long-term advantage.',
    };
  });
  return {
    primaryClaim: moat.primaryClaim || '',
    sources,
    summary: {
      strong: sources.filter((s) => s.status === 'strong').length,
      partial: sources.filter((s) => s.status === 'partial').length,
      none: sources.filter((s) => s.status === 'none').length,
    },
  };
}

function discoveryPatterns(state) {
  const interviews = (state.evidence || []).filter((e) => e.type === 'interview');
  const tags = {};
  for (const ev of interviews) {
    for (const t of (ev.insightTags || ev.findings || [])) {
      const key = String(t).trim();
      if (!key) continue;
      tags[key] = tags[key] || { tag: key, count: 0, evidenceIds: [] };
      tags[key].count += 1;
      tags[key].evidenceIds.push(ev.id);
    }
  }
  const patterns = Object.values(tags).sort((a, b) => b.count - a.count);
  const exp = (state.experiments || []).find((e) => /interview|discovery/i.test(e.title)) || null;
  const target = exp ? Math.max(1, Number(exp.targetCount) || 10) : 10;
  return {
    interviewCount: interviews.length,
    target,
    patterns,
    why: interviews.length
      ? `${interviews.length} interviews tagged. Patterns are counts — not automatic validation.`
      : 'No interview evidence yet. Tag insights on each interview to see patterns.',
  };
}

function defaultFundingSeed() {
  return emptyFundingState();
}

module.exports = {
  FUNDING_READINESS_SECTIONS,
  MOAT_SOURCES,
  emptyFundingState,
  defaultFundingSeed,
  evidenceForFundingItem,
  evaluateFundingItem,
  evaluateFundingReadiness,
  calculateMarketSizing,
  evaluateMoat,
  discoveryPatterns,
  uid,
};
