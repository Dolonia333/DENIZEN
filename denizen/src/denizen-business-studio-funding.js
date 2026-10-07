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
      { key: 'problem_need', title: 'Problem / Need', evidenceTypes: ['interview', 'document', 'survey'], completeLabel: 'Evidence' },
      { key: 'customer_definition', title: 'Customer Definition', evidenceTypes: ['interview', 'document'], completeLabel: 'Evidence' },
      { key: 'customer_discovery', title: 'Customer Discovery', evidenceTypes: ['interview'], targetCount: 10 },
      { key: 'product_solution', title: 'Product / Solution', evidenceTypes: ['document', 'technical_test', 'prototype'], completeLabel: 'Prototype' },
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
      { key: 'som', title: 'SOM', evidenceTypes: ['document', 'metric', 'market_sizing'], warnMode: 'validation' },
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
      sources: {}, // key -> { status, claim, why, copyDifficulty, monthsToCopy, evidenceIds[] }
      primaryClaim: '',
      primaryWhy: '',
      primaryCopyDifficulty: '',
      primaryMonthsToCopy: null,
    },
    capitalPlan: {
      stage: 'pre_revenue',
      amountNeeded: null,
      uses: [],
      types: [],
      notes: '',
      pathwayStep: 'readiness', // readiness|gaps|paths|requirements|application|diligence|outcome
    },
    discoveryLab: {
      personas: [],
      hypotheses: [],
    },
    leanCanvas: emptyLeanCanvas(),
    dataRoom: {
      sharedWithInvestors: {},
    },
    unansweredInvestorQuestions: [],
  };
}

/** Classic Ash Maurya Lean Canvas — nine boxes founders fill in-app. */
function emptyLeanCanvas() {
  return {
    problem: '',
    solution: '',
    uniqueValueProposition: '',
    unfairAdvantage: '',
    customerSegments: '',
    keyMetrics: '',
    channels: '',
    costStructure: '',
    revenueStreams: '',
    updatedAt: null,
  };
}

const LEAN_CANVAS_FIELDS = Object.freeze([
  { key: 'problem', title: 'Problem', hint: 'Top 1–3 problems' },
  { key: 'solution', title: 'Solution', hint: 'Top features for each problem' },
  { key: 'uniqueValueProposition', title: 'Unique Value Proposition', hint: 'Single, clear compelling message' },
  { key: 'unfairAdvantage', title: 'Unfair Advantage', hint: 'Cannot be easily copied or bought' },
  { key: 'customerSegments', title: 'Customer Segments', hint: 'Target customers + early adopters' },
  { key: 'keyMetrics', title: 'Key Metrics', hint: 'Key activities you measure' },
  { key: 'channels', title: 'Channels', hint: 'Path to customers' },
  { key: 'costStructure', title: 'Cost Structure', hint: 'Customer acquisition, distribution, people, etc.' },
  { key: 'revenueStreams', title: 'Revenue Streams', hint: 'Revenue model, life-time value, revenue, gross margin' },
]);

/** DENIZEN / Dolonia draft — so founders can visualize instead of a spreadsheet PDF. */
function denizenLeanCanvasDraft() {
  return {
    problem:
      'Hypothesis to test with school and district buyers: AI work dies in disposable chat, and the buyer cannot see whether an agent did real work. Cost, privacy, and idle hardware are not established facts.',
    solution:
      'DENIZEN is a visual office where named agents keep memory, use allowed tools, and leave receipts. A campus deployment is a separate hypothesis, not a finished infrastructure product.',
    uniqueValueProposition:
      'A buyer could see which agent finished work. Privacy compliance, zero cloud cost, and margin claims are excluded until evidence exists.',
    unfairAdvantage:
      'No unfair advantage is claimed. Copy difficulty and margins stay unsupported until evidence is linked.',
    customerSegments:
      'School and district buyers: CTE, curriculum, and IT decision-makers. The economic buyer is not confirmed by qualifying interviews.',
    keyMetrics:
      'Qualifying school or district buyer interviews, target 10. Contradictory evidence counts. Meetings and CRM contacts do not count.',
    channels:
      'Founder-led discovery with schools and districts. Introductions are channels to test, not a closed pipeline.',
    costStructure:
      'Product development and founder time. Cloud, hardware, and delivery costs are not modeled as zero.',
    revenueStreams:
      'Pricing is not validated. No list price, grant award, or margin until a buyer or a sourced model says so.',
    updatedAt: null,
  };
}

function sanitizeLeanCanvas(raw) {
  const out = emptyLeanCanvas();
  if (!raw || typeof raw !== 'object') return out;
  for (const f of LEAN_CANVAS_FIELDS) {
    const text = canvasFieldText(raw[f.key]);
    if (text != null) out[f.key] = text;
  }
  if (raw.updatedAt) out.updatedAt = raw.updatedAt;
  return out;
}

function canvasFieldText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(canvasFieldText).filter((line) => line != null && String(line).trim()).join('\n');
  }
  if (typeof value === 'object') {
    const inner = value.text ?? value.body ?? value.content ?? value.value ?? value.notes ?? value.description;
    if (inner != null && inner !== value) return canvasFieldText(inner);
  }
  return null;
}

const LEAN_CANVAS_ALIASES = new Map([
  ['problem', 'problem'],
  ['solution', 'solution'],
  ['uniquevalueproposition', 'uniqueValueProposition'],
  ['valueproposition', 'uniqueValueProposition'],
  ['uvp', 'uniqueValueProposition'],
  ['unfairadvantage', 'unfairAdvantage'],
  ['customersegments', 'customerSegments'],
  ['customersegment', 'customerSegments'],
  ['keymetrics', 'keyMetrics'],
  ['metrics', 'keyMetrics'],
  ['channels', 'channels'],
  ['coststructure', 'costStructure'],
  ['costs', 'costStructure'],
  ['revenuestreams', 'revenueStreams'],
  ['revenue', 'revenueStreams'],
]);

function leanCanvasKey(name) {
  return LEAN_CANVAS_ALIASES.get(String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')) || null;
}

function canvasSourceObject(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
}

function applyLeanCanvasFields(canvas, args = {}) {
  const base = sanitizeLeanCanvas(canvas);
  const applied = [];
  const ignored = [];
  const skip = new Set([
    'canvas', 'fields', 'lean_canvas', 'leanCanvas', 'program_id', 'programId', 'updatedAt', 'updated_at',
  ]);
  const sources = [
    args.canvas,
    args.fields,
    args.lean_canvas,
    args.leanCanvas,
    args,
  ];
  for (const source of sources) {
    const obj = canvasSourceObject(source);
    if (!obj) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (skip.has(key)) continue;
      const mapped = leanCanvasKey(key);
      const text = canvasFieldText(value);
      const present = value != null && (
        (typeof value === 'string' && value.trim().length > 0)
        || typeof value === 'number'
        || typeof value === 'boolean'
        || (Array.isArray(value) && value.length > 0)
        || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0)
      );
      if (!mapped || text == null) {
        if (present) ignored.push(key);
        continue;
      }
      base[mapped] = text;
      applied.push(mapped);
    }
  }
  if (applied.length) base.updatedAt = new Date().toISOString();
  return {
    canvas: sanitizeLeanCanvas(base),
    applied: [...new Set(applied)],
    ignored: [...new Set(ignored)],
  };
}

function leanCanvasFilledCount(canvas) {
  const c = sanitizeLeanCanvas(canvas);
  return LEAN_CANVAS_FIELDS.filter((f) => String(c[f.key] || '').trim().length >= 8).length;
}

function leanCanvasIsSubstantial(canvas) {
  const c = sanitizeLeanCanvas(canvas);
  // Core boxes: problem, UVP, customer segments
  const core = ['problem', 'uniqueValueProposition', 'customerSegments'];
  return core.every((k) => String(c[k] || '').trim().length >= 12);
}

function leanCanvasPlainText(canvas) {
  const c = sanitizeLeanCanvas(canvas);
  return LEAN_CANVAS_FIELDS.map((f) => `${f.title}\n${String(c[f.key] || '').trim() || '—'}`).join('\n\n');
}

function evidenceForFundingItem(state, item) {
  const evidenceLedger = require('./denizen-business-studio-evidence');
  return evidenceLedger.qualifyingEvidence(state, { fundingItem: item }).evidence;
}

function evaluateFundingItem(state, item, fundingOverrides = {}) {
  const linked = evidenceForFundingItem(state, item);
  const override = fundingOverrides[item.key] || {};
  const target = Math.max(1, Number(item.targetCount) || 1);
  // Count ONLY qualifying linked evidence — never invent via manualCount alone for counted items.
  // manualCount may supplement only when founder explicitly marks complete for non-counted items.
  const count = linked.length;
  const autoComplete = item.warnMode === 'validation'
    ? !!(override.markedComplete || override.validated)
    : (count >= target);
  const complete = !!(override.markedComplete) || autoComplete;

  // Display vocabulary matches Founder OS checklist:
  // ✓ Evidence | ✓ Prototype | 3 / 10 | ◐ In progress | ⚠ Needs evidence | ○
  let status = 'not_started';
  let mark = '○';
  let label = '';

  if (item.targetCount) {
    // Counted requirements always show X / Y
    label = `${count} / ${target}`;
    if (complete) {
      status = 'complete';
      mark = '✓';
    } else if (count > 0) {
      status = 'in_progress';
      mark = '◐';
    } else {
      status = 'not_started';
      mark = '○';
    }
  } else if (complete) {
    status = 'complete';
    mark = '✓';
    label = override.completeLabel || item.completeLabel || 'Evidence';
  } else if (override.needsValidation || item.warnMode === 'validation') {
    if (count > 0) {
      status = 'needs_validation';
      mark = '⚠';
      label = 'Needs validation';
    } else {
      status = 'not_started';
      mark = '○';
      label = '';
    }
  } else if (count > 0) {
    status = 'in_progress';
    mark = '◐';
    label = 'In progress';
  } else if (override.needsEvidence) {
    status = 'needs_evidence';
    mark = '⚠';
    label = 'Needs evidence';
  } else {
    status = 'not_started';
    mark = '○';
    label = '';
  }

  // Founder can explicitly flag incomplete items that need evidence
  if (!complete && override.needsEvidence && count === 0 && !item.targetCount) {
    status = 'needs_evidence';
    mark = '⚠';
    label = 'Needs evidence';
  }

  const display = label ? `${mark} ${label}` : mark;

  return {
    key: item.key,
    title: item.title,
    status,
    mark,
    label,
    display,
    count,
    target: item.targetCount ? target : null,
    complete,
    evidenceIds: linked.map((e) => e.id),
    why: complete
      ? `${count || 1} linked evidence item(s) — ${label || 'complete'}.`
      : count > 0
        ? item.targetCount
          ? `${count}/${target} evidence linked; still insufficient.`
          : `${count} evidence linked — in progress, not yet investor-ready.`
        : `No evidence linked for "${item.title}".`,
    recommendedAction: complete
      ? 'Keep evidence current; include in mentor/investor share pack.'
      : `Add evidence for ${item.title} (accepted types: ${(item.evidenceTypes || []).join(', ') || 'any'}).`,
  };
}

function classifyBucket(item) {
  if (item.complete) return 'complete';
  if (item.status === 'not_started') return 'not_started';
  return 'needs_work'; // in_progress | needs_evidence | needs_validation | partial counts
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
      needsWorkCount: items.filter((i) => classifyBucket(i) === 'needs_work').length,
      notStartedCount: items.filter((i) => classifyBucket(i) === 'not_started').length,
    };
  });
  const allItems = sections.flatMap((s) => s.items);
  const complete = allItems.filter((i) => classifyBucket(i) === 'complete').length;
  const needsWork = allItems.filter((i) => classifyBucket(i) === 'needs_work').length;
  const notStarted = allItems.filter((i) => classifyBucket(i) === 'not_started').length;
  return {
    generatedAt: new Date().toISOString(),
    sections,
    overall: {
      complete,
      needsWork,
      notStarted,
      total: allItems.length,
      // Explicitly NOT a mysterious readiness %. Counts only.
      summary: `${complete} complete\n${needsWork} need work\n${notStarted} not started`,
      summaryLine: `${complete} complete · ${needsWork} need work · ${notStarted} not started`,
      why: 'Counts items with linked evidence (or explicit founder mark). Tasks alone never count as funding readiness.',
    },
  };
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
  if (!out.inputs.buyerWho) out.warnings.push('Buyer definition missing — who exactly buys this?');
  if (!out.inputs.geography) out.warnings.push('Geography missing — where can you sell today?');
  const serviceLines = Array.isArray(input.serviceLines) ? input.serviceLines : [];
  out.serviceLines = serviceLines.map((line) => ({
    id: line?.id || '',
    name: String(line?.name || ''),
    tam: numberOrNull(line?.tam),
    sam: numberOrNull(line?.sam),
    som: numberOrNull(line?.som),
    source: String(line?.source || ''),
  }));
  const summed = { tam: 0, sam: 0, som: 0, tamLines: 0, samLines: 0, somLines: 0 };
  for (const line of out.serviceLines) {
    if (line.tam != null) { summed.tam += line.tam; summed.tamLines += 1; }
    if (line.sam != null) { summed.sam += line.sam; summed.samLines += 1; }
    if (line.som != null) { summed.som += line.som; summed.somLines += 1; }
  }
  out.serviceRollup = {
    tam: summed.tamLines ? summed.tam : null,
    sam: summed.samLines ? summed.sam : null,
    som: summed.somLines ? summed.som : null,
    sizedLines: out.serviceLines.filter((line) => line.tam != null || line.sam != null || line.som != null).length,
    totalLines: out.serviceLines.length,
    why: 'Adds only the service-line figures entered. It does not add outside industry totals.',
  };
  // Jenny-style challenge lines (advisory, not auto-verdicts)
  out.jenny = out.warnings.map((w) => {
    if (/TAM source/i.test(w)) return 'Jenny: Your TAM number is not sourced yet — investors will ask where it came from.';
    if (/SAM source/i.test(w)) return 'Jenny: SAM needs a source (geography + segment definition).';
    if (/SOM assumption|SOM capture/i.test(w)) {
      return 'Jenny: Your TAM may be sourced, but your SOM assumes a capture rate without supporting evidence.';
    }
    if (/Buyer definition/i.test(w)) return 'Jenny: Who exactly writes the check? Name the economic buyer.';
    if (/Geography/i.test(w)) return 'Jenny: What geography can you currently sell into?';
    return `Jenny: ${w}`;
  });
  return out;
}

const DATA_ROOM_SECTIONS = Object.freeze([
  { id: 'company', name: 'Company', fundingKeys: ['founders', 'roles', 'lean_canvas', 'exec_summary'] },
  { id: 'market', name: 'Market', fundingKeys: ['tam', 'sam', 'som', 'market_growth', 'beachhead'] },
  { id: 'product', name: 'Product', fundingKeys: ['problem_need', 'product_solution', 'pm_validation'] },
  { id: 'customers', name: 'Customers', fundingKeys: ['customer_definition', 'customer_discovery', 'economic_buyer'] },
  { id: 'financials', name: 'Financials', fundingKeys: ['forecast_3y', 'cash_flow', 'burn', 'runway', 'unit_economics', 'financial_model'] },
  { id: 'team', name: 'Team', fundingKeys: ['founders', 'roles', 'critical_gaps', 'hiring_plan', 'advisors'] },
  { id: 'legal', name: 'Legal', fundingKeys: ['use_of_funds'] },
  { id: 'ip', name: 'IP', fundingKeys: ['moat', 'defensibility_evidence'] },
  { id: 'traction', name: 'Traction', fundingKeys: ['pilot_strategy', 'revenue_model', 'pricing_validation'] },
  { id: 'fundraise', name: 'Fundraise', fundingKeys: ['pitch_deck', 'pitch_90', 'pitch_5m', 'investor_qa', 'data_room'] },
]);

const CAPITAL_USES = Object.freeze(['Product', 'Pilot', 'Hiring', 'Sales', 'Equipment', 'Other']);
const CAPITAL_TYPES = Object.freeze([
  'Bootstrapping', 'Customer Revenue', 'Grants', 'Loans', 'Accelerator',
  'Angel', 'SAFE', 'Convertible Note', 'Equity',
]);
const CAPITAL_PATHWAY = Object.freeze([
  { id: 'readiness', label: 'Readiness' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'paths', label: 'Potential Funding Paths' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'application', label: 'Application / Introduction' },
  { id: 'diligence', label: 'Due Diligence' },
  { id: 'outcome', label: 'Outcome' },
]);

function evaluateDataRoom(state) {
  const readiness = evaluateFundingReadiness(state);
  const byKey = Object.fromEntries(
    readiness.sections.flatMap((s) => s.items).map((i) => [i.key, i]),
  );
  const share = state.funding?.dataRoom?.sharedWithInvestors || {};
  const sections = DATA_ROOM_SECTIONS.map((sec) => {
    const items = (sec.fundingKeys || []).map((key) => {
      const item = byKey[key] || {
        key, title: key, complete: false, display: '○', status: 'not_started',
      };
      return {
        ...item,
        sharedWithInvestors: share[key] === true,
      };
    });
    const present = items.filter((i) => i.complete).length;
    const missing = items.filter((i) => !i.complete);
    return {
      id: sec.id,
      name: sec.name,
      items,
      present,
      total: items.length,
      missingTitles: missing.map((m) => m.title),
      status: present === items.length ? 'ready' : (present > 0 ? 'partial' : 'empty'),
    };
  });
  const ready = sections.filter((s) => s.status === 'ready').length;
  const partial = sections.filter((s) => s.status === 'partial').length;
  const empty = sections.filter((s) => s.status === 'empty').length;
  return {
    sections,
    overall: {
      ready,
      partial,
      empty,
      total: sections.length,
      summary: `${ready} sections ready · ${partial} partial · ${empty} empty`,
      why: 'Data Room readiness mirrors Funding Readiness evidence — never invents diligence completeness.',
    },
  };
}

function capitalPathwayBrief(state) {
  const plan = state.funding?.capitalPlan || emptyFundingState().capitalPlan;
  const readiness = evaluateFundingReadiness(state);
  const unanswered = (state.funding?.unansweredInvestorQuestions || []).filter((q) => !q.answered);
  const gaps = [
    ...readiness.sections.flatMap((s) => s.items.filter((i) => !i.complete).map((i) => i.title)).slice(0, 8),
    ...unanswered.map((q) => `Unanswered: ${q.question}`),
  ];
  const suggestedTypes = [];
  if (plan.stage === 'pre_revenue' || plan.stage === 'validation') {
    suggestedTypes.push('Bootstrapping', 'Grants', 'Accelerator', 'Angel');
  } else if (plan.stage === 'pilot') {
    suggestedTypes.push('Customer Revenue', 'Accelerator', 'SAFE', 'Angel');
  } else {
    suggestedTypes.push('SAFE', 'Convertible Note', 'Equity', 'Customer Revenue');
  }
  return {
    plan,
    uses: CAPITAL_USES,
    types: CAPITAL_TYPES,
    pathway: CAPITAL_PATHWAY,
    gaps,
    suggestedTypes,
    note: 'E3 does not guarantee investment — this organizes pathway readiness and next introductions.',
  };
}

function discoveryPatterns(state) {
  const interviews = (state.evidence || []).filter((e) => e.type === 'interview');
  const tags = {};
  let pricingAsked = 0;
  let pilotRequested = 0;
  let economicBuyers = 0;
  for (const ev of interviews) {
    const tagList = [...(ev.insightTags || []), ...(ev.findings || [])].map((t) => String(t).trim()).filter(Boolean);
    for (const key of tagList) {
      tags[key] = tags[key] || { tag: key, count: 0, evidenceIds: [] };
      tags[key].count += 1;
      tags[key].evidenceIds.push(ev.id);
      if (/pric/i.test(key)) pricingAsked += 1;
      if (/pilot/i.test(key)) pilotRequested += 1;
    }
    if (ev.economicBuyer || /economic|buyer|writes the check/i.test(String(ev.persona || ''))) {
      economicBuyers += 1;
    }
  }
  const patterns = Object.values(tags).sort((a, b) => b.count - a.count);
  const exp = (state.experiments || []).find((e) => /interview|discovery/i.test(e.title)) || null;
  const target = exp ? Math.max(1, Number(exp.targetCount) || 10) : 10;
  const hypotheses = state.funding?.discoveryLab?.hypotheses || state.assumptions || [];
  const hypothesisSupport = hypotheses.map((h) => {
    const key = h.key || h.id || h.title;
    const match = patterns.find((p) =>
      String(p.tag).toLowerCase().includes(String(h.title || h.key || '').toLowerCase().slice(0, 12))
      || (h.key && String(p.tag).toLowerCase().includes(String(h.key).toLowerCase()))
    );
    const count = match?.count || 0;
    return {
      id: h.id || h.key,
      title: h.title || h.key,
      mentionCount: count,
      interviewCount: interviews.length,
      support: count === 0 ? 'weak' : (count / Math.max(1, interviews.length) < 0.3 ? 'weak' : 'emerging'),
      note: count === 0
        ? `Your hypothesis "${h.title || h.key}" currently has weak interview support.`
        : `${count}/${interviews.length} interviews mentioned related signals — not auto-validated.`,
    };
  });
  return {
    interviewCount: interviews.length,
    target,
    patterns: patterns.map((p) => ({
      ...p,
      ratioLabel: `${p.count}/${interviews.length || target} mentioned ${p.tag}`,
    })),
    signals: {
      pricingAsked,
      pilotRequested,
      economicBuyers,
    },
    hypothesisSupport,
    personas: state.funding?.discoveryLab?.personas || [],
    why: interviews.length
      ? `${interviews.length} interviews tagged. Patterns are counts — DENIZEN does not decide viability.`
      : 'No interview evidence yet. Tag insights on each interview to see patterns.',
  };
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
    const mark = status === 'strong' ? '✓' : (status === 'partial' ? '◐' : '○');
    return {
      key: src.key,
      title: src.title,
      status,
      mark,
      claim: row.claim || '',
      why: row.why || '',
      copyDifficulty: row.copyDifficulty || '',
      monthsToCopy: Number.isFinite(copyMonths) ? copyMonths : null,
      evidenceIds: linked.map((e) => e.id),
      defensibility,
      note: linked.length
        ? `${linked.length} evidence linked. Advantage ≠ moat until copy difficulty is evidenced.`
        : 'No evidence. First-mover alone is not a long-term advantage.',
    };
  });

  const primaryEvidence = (state.evidence || []).filter((e) =>
    e.moatKey === 'primary' || (Array.isArray(e.linkedMoatKeys) && e.linkedMoatKeys.includes('primary'))
  );
  const primaryMonths = Number(moat.primaryMonthsToCopy);
  let primaryDefensibility = 'needs_more_evidence';
  if (primaryEvidence.length >= 2 && Number.isFinite(primaryMonths) && primaryMonths >= 12 && moat.primaryCopyDifficulty) {
    primaryDefensibility = 'defensible_claim';
  } else if (primaryEvidence.length >= 1 || moat.primaryClaim) {
    primaryDefensibility = 'advantage_not_yet_moat';
  }

  return {
    primaryClaim: moat.primaryClaim || '',
    primaryWhy: moat.primaryWhy || '',
    primaryCopyDifficulty: moat.primaryCopyDifficulty || '',
    primaryMonthsToCopy: Number.isFinite(primaryMonths) ? primaryMonths : null,
    primaryEvidenceIds: primaryEvidence.map((e) => e.id),
    primaryDefensibility,
    primaryNote: primaryDefensibility === 'defensible_claim'
      ? 'Claim has evidence and copy difficulty — still founder/mentor judgment.'
      : 'Something can be an advantage without being a moat. First-mover does not count.',
    sources,
    summary: {
      strong: sources.filter((s) => s.status === 'strong').length,
      partial: sources.filter((s) => s.status === 'partial').length,
      none: sources.filter((s) => s.status === 'none').length,
    },
  };
}

function defaultFundingSeed() {
  return emptyFundingState();
}

function firstDefined(...vals) {
  for (const value of vals) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function applyMoatFields(moat, args = {}) {
  const base = {
    ...emptyFundingState().moat,
    ...(moat || {}),
    sources: { ...((moat && moat.sources) || {}) },
  };
  const patch = {
    ...(args.moat && typeof args.moat === 'object' ? args.moat : {}),
    ...(args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields) ? args.fields : {}),
  };
  const applied = [];
  const claim = firstDefined(args.primaryClaim, args.primary_claim, args.claim, patch.primaryClaim, patch.primary_claim, patch.claim);
  if (claim !== undefined) {
    base.primaryClaim = claim == null ? '' : String(claim);
    applied.push('primaryClaim');
  }
  const why = firstDefined(args.primaryWhy, args.primary_why, args.why, patch.primaryWhy, patch.primary_why, patch.why);
  if (why !== undefined) {
    base.primaryWhy = why == null ? '' : String(why);
    applied.push('primaryWhy');
  }
  const copy = firstDefined(
    args.primaryCopyDifficulty, args.primary_copy_difficulty, args.copyDifficulty,
    patch.primaryCopyDifficulty, patch.primary_copy_difficulty, patch.copyDifficulty,
  );
  if (copy !== undefined) {
    base.primaryCopyDifficulty = copy == null ? '' : String(copy);
    applied.push('primaryCopyDifficulty');
  }
  const months = firstDefined(
    args.primaryMonthsToCopy, args.primary_months_to_copy, args.monthsToCopy,
    patch.primaryMonthsToCopy, patch.primary_months_to_copy, patch.monthsToCopy,
  );
  if (months !== undefined) {
    const num = months === '' || months == null ? null : Number(months);
    base.primaryMonthsToCopy = Number.isFinite(num) ? num : null;
    applied.push('primaryMonthsToCopy');
  }
  const sources = firstDefined(args.sources, patch.sources);
  if (sources !== undefined) {
    base.sources = {};
    if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
      for (const [key, row] of Object.entries(sources)) {
        base.sources[key] = typeof row === 'string' ? { claim: row } : { ...(row || {}) };
      }
    }
    applied.push('sources');
  }
  return { moat: base, applied };
}

function applyCapitalFields(plan, args = {}) {
  const base = { ...emptyFundingState().capitalPlan, ...(plan || {}) };
  const patch = {
    ...(args.capitalPlan && typeof args.capitalPlan === 'object' ? args.capitalPlan : {}),
    ...(args.capital_plan && typeof args.capital_plan === 'object' ? args.capital_plan : {}),
    ...(args.plan && typeof args.plan === 'object' ? args.plan : {}),
    ...(args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields) ? args.fields : {}),
  };
  const applied = [];
  const notes = firstDefined(args.notes, patch.notes, patch.capital_notes);
  if (notes !== undefined) {
    base.notes = notes == null ? '' : String(notes);
    applied.push('notes');
  }
  const stage = firstDefined(args.stage, patch.stage);
  if (stage !== undefined && stage !== null && stage !== '') {
    base.stage = String(stage);
    applied.push('stage');
  }
  const amount = firstDefined(
    args.amountNeeded, args.amount_needed, args.raiseTarget, args.raise_target,
    patch.amountNeeded, patch.amount_needed, patch.raiseTarget, patch.raise_target,
  );
  if (amount !== undefined) {
    if (amount === '' || amount == null) base.amountNeeded = null;
    else {
      const num = Number(amount);
      base.amountNeeded = Number.isFinite(num) ? num : null;
    }
    applied.push('amountNeeded');
  }
  const uses = firstDefined(args.uses, patch.uses);
  if (uses !== undefined) {
    base.uses = Array.isArray(uses) ? uses : [];
    applied.push('uses');
  }
  const types = firstDefined(args.types, patch.types);
  if (types !== undefined) {
    base.types = Array.isArray(types) ? types : [];
    applied.push('types');
  }
  const step = firstDefined(args.pathwayStep, args.pathway_step, patch.pathwayStep, patch.pathway_step);
  if (step !== undefined && step !== null && step !== '') {
    base.pathwayStep = String(step);
    applied.push('pathwayStep');
  }
  return { capitalPlan: base, applied };
}

module.exports = {
  FUNDING_READINESS_SECTIONS,
  MOAT_SOURCES,
  DATA_ROOM_SECTIONS,
  CAPITAL_USES,
  CAPITAL_TYPES,
  CAPITAL_PATHWAY,
  LEAN_CANVAS_FIELDS,
  emptyFundingState,
  emptyLeanCanvas,
  denizenLeanCanvasDraft,
  sanitizeLeanCanvas,
  applyLeanCanvasFields,
  leanCanvasFilledCount,
  leanCanvasIsSubstantial,
  leanCanvasPlainText,
  defaultFundingSeed,
  evidenceForFundingItem,
  evaluateFundingItem,
  classifyBucket,
  evaluateFundingReadiness,
  calculateMarketSizing,
  evaluateMoat,
  applyMoatFields,
  applyCapitalFields,
  discoveryPatterns,
  evaluateDataRoom,
  capitalPathwayBrief,
  uid,
};
