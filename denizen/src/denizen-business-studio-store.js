'use strict';

/**
 * Org-scoped Business Studio workspace persistence (mirrors studio-board-store).
 */

const denizenDb = require('./denizen-db');
const approvalsScope = require('./denizen-approvals-scope');

const OPERATOR_STUDIO_EMAIL = 'zionvanzandt@gmail.com';

const SCHEMA_VERSION = 1;
const TABLE = 'denizen_business_studio_workspaces';

const STATE_KEYS = Object.freeze([
  'business',
  'programs',
  'goals',
  'milestones',
  'projects',
  'tasks',
  'strategyNodes',
  'strategyEdges',
  'assumptions',
  'experiments',
  'evidence',
  'findings',
  'decisions',
  'metrics',
  'metricValues',
  'advisors',
  'comments',
  'meetings',
  'recommendations',
  'relations',
  'documents',
  'workbooks',
  'funding',
  'activity',
  'notifications',
  'config',
]);

function emptyPhase2() {
  return {
    templates: [],
    financials: { notes: '', rows: [] },
    diagrams: [],
    reports: [],
  };
}

function sanitizePhase2(raw) {
  const out = emptyPhase2();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (Array.isArray(raw.templates)) out.templates = raw.templates;
  if (Array.isArray(raw.diagrams)) out.diagrams = raw.diagrams;
  if (Array.isArray(raw.reports)) out.reports = raw.reports;
  if (raw.financials && typeof raw.financials === 'object' && !Array.isArray(raw.financials)) {
    out.financials = {
      notes: raw.financials.notes != null ? String(raw.financials.notes) : '',
      rows: Array.isArray(raw.financials.rows) ? raw.financials.rows : [],
    };
  }
  return out;
}

function emptyState() {
  const fundingMod = (() => {
    try { return require('./denizen-business-studio-funding'); } catch (_) { return null; }
  })();
  return {
    business: null,
    programs: [],
    goals: [],
    milestones: [],
    projects: [],
    tasks: [],
    strategyNodes: [],
    strategyEdges: [],
    assumptions: [],
    experiments: [],
    evidence: [],
    findings: [],
    decisions: [],
    metrics: [],
    metricValues: [],
    advisors: [],
    comments: [],
    meetings: [],
    recommendations: [],
    relations: [],
    documents: [],
    workbooks: [],
    funding: fundingMod ? fundingMod.emptyFundingState() : {
      items: {},
      marketSizing: {},
      moat: { sources: {}, primaryClaim: '' },
      capitalPlan: {},
      unansweredInvestorQuestions: [],
    },
    activity: [],
    notifications: [],
    phase2: emptyPhase2(),
    config: {
      healthCategories: [
        'product',
        'customer_discovery',
        'market_validation',
        'sales',
        'financial',
        'operations',
        'program',
        'technical',
        'funding_readiness',
      ],
      mentorShareDefaults: {
        programs: true,
        roadmap: true,
        goals: true,
        experiments: true,
        evidence: true,
        metrics: true,
        pave: true,
        deliverables: true,
        meetings: true,
        founderQuestions: true,
        funding: true,
        financials: false,
        crm: false,
        privateNotes: false,
      },
    },
  };
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const out = emptyState();
  if (raw.business && typeof raw.business === 'object') out.business = { ...raw.business };
  for (const key of STATE_KEYS) {
    if (key === 'business' || key === 'config' || key === 'funding') continue;
    if (Array.isArray(raw[key])) out[key] = raw[key];
  }
  if (raw.funding && typeof raw.funding === 'object' && !Array.isArray(raw.funding)) {
    out.funding = {
      ...out.funding,
      ...raw.funding,
      items: { ...(out.funding.items || {}), ...(raw.funding.items || {}) },
      marketSizing: { ...(out.funding.marketSizing || {}), ...(raw.funding.marketSizing || {}) },
      moat: {
        ...(out.funding.moat || {}),
        ...(raw.funding.moat || {}),
        sources: { ...(out.funding.moat?.sources || {}), ...(raw.funding.moat?.sources || {}) },
      },
      capitalPlan: { ...(out.funding.capitalPlan || {}), ...(raw.funding.capitalPlan || {}) },
      discoveryLab: {
        personas: Array.isArray(raw.funding.discoveryLab?.personas)
          ? raw.funding.discoveryLab.personas
          : (out.funding.discoveryLab?.personas || []),
        hypotheses: Array.isArray(raw.funding.discoveryLab?.hypotheses)
          ? raw.funding.discoveryLab.hypotheses
          : (out.funding.discoveryLab?.hypotheses || []),
      },
      leanCanvas: (() => {
        try {
          const funding = require('./denizen-business-studio-funding');
          return funding.sanitizeLeanCanvas(raw.funding.leanCanvas || out.funding.leanCanvas);
        } catch (_) {
          return raw.funding.leanCanvas || out.funding.leanCanvas || {};
        }
      })(),
      dataRoom: {
        sharedWithInvestors: {
          ...(out.funding.dataRoom?.sharedWithInvestors || {}),
          ...(raw.funding.dataRoom?.sharedWithInvestors || {}),
        },
      },
      unansweredInvestorQuestions: Array.isArray(raw.funding.unansweredInvestorQuestions)
        ? raw.funding.unansweredInvestorQuestions
        : (out.funding.unansweredInvestorQuestions || []),
    };
  }
  if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) {
    out.config = { ...out.config, ...raw.config };
  }
  if (raw.phase2 && typeof raw.phase2 === 'object') out.phase2 = sanitizePhase2(raw.phase2);
  return out;
}

function stripPrivateStudios(state) {
  const out = sanitizeState(state);
  if (out.config && out.config.privateStudios) {
    const config = { ...out.config };
    delete config.privateStudios;
    out.config = config;
  }
  return out;
}

function readPrivateStudio(state, key) {
  const slice = state?.config?.privateStudios?.[key];
  return stripPrivateStudios(slice || emptyState());
}

function writePrivateStudio(fullState, key, slice) {
  const base = sanitizeState(fullState);
  const cleanSlice = stripPrivateStudios(slice);
  const prev = fullState?.config?.privateStudios && typeof fullState.config.privateStudios === 'object'
    ? fullState.config.privateStudios
    : {};
  base.config = { ...(base.config || {}), privateStudios: { ...prev, [key]: cleanSlice } };
  return base;
}

function preservePrivateStudios(existingState, nextState) {
  const prev = existingState?.config?.privateStudios;
  if (!prev || typeof prev !== 'object') return nextState;
  const incoming = nextState?.config?.privateStudios;
  nextState.config = { ...(nextState.config || {}) };
  nextState.config.privateStudios = { ...prev, ...(incoming && typeof incoming === 'object' ? incoming : {}) };
  return nextState;
}

function firstDefined(...vals) {
  for (const value of vals) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function applyBusinessProfile(business, args = {}) {
  const next = { ...(business || {}) };
  const nested = args.business && typeof args.business === 'object' ? args.business : {};
  const applied = [];
  const name = firstDefined(
    args.business_name, args.businessName, args.company_name, args.companyName,
    args.company, args.legal_name, args.legalName, args.workspace_name, args.workspace,
    args.name, nested.name, nested.company, nested.company_name, nested.companyName,
    nested.legal_name, nested.legalName, nested.business_name, nested.businessName,
  );
  if (name !== undefined && String(name).trim()) {
    next.name = String(name).trim();
    applied.push('name');
  }
  const founder = firstDefined(
    args.founder_name, args.founderName, args.founder,
    nested.founderName, nested.founder_name, nested.founder,
  );
  if (founder !== undefined && String(founder).trim()) {
    next.founderName = String(founder).trim();
    applied.push('founderName');
  }
  const structure = firstDefined(args.structure, args.company_structure, nested.structure);
  if (structure !== undefined && String(structure).trim()) {
    next.structure = String(structure).trim();
    applied.push('structure');
  } else if (applied.includes('name') && !/^DENIZEN\s*\/\s*Dolonia/i.test(next.name)) {
    if (!next.structure) {
      next.structure = 'holding';
      applied.push('structure');
    }
  }
  return { business: next, applied };
}

const E3_TEMPLATE_STRATEGY_IDS = new Set([
  'n_vision', 'n_market', 'n_problem', 'n_customer', 'n_assumption',
  'n_experiment', 'n_evidence', 'n_decision', 'n_milestone', 'n_outcome',
]);

function strategyMapIsE3Template(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.length > 0 && list.every((node) => node && E3_TEMPLATE_STRATEGY_IDS.has(node.id));
}

function operatorStudioKey() {
  return `email:${OPERATOR_STUDIO_EMAIL}`;
}

function studioKeyForProfile(profile = {}) {
  if (approvalsScope.isAngelaHoldingPrincipal({
    email: profile.email,
    display_name: profile.display_name || profile.displayName,
    username: profile.username,
    name: profile.name,
  })) return 'angela';
  const email = String(profile.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const identityId = String(profile.identityId || profile.identity_id || '').trim();
  if (identityId) return `id:${identityId}`;
  return null;
}

function selectPersonalState(full, key) {
  if (!key) return { state: emptyState(), adopted: false, studioKey: null };
  return {
    state: readPrivateStudio(full, key),
    adopted: false,
    studioKey: key,
  };
}

function blankSharedRoot(full) {
  const studios = full?.config?.privateStudios;
  const empty = emptyState();
  if (studios && typeof studios === 'object') {
    empty.config = { ...(empty.config || {}), privateStudios: studios };
  }
  return empty;
}

function parkOperatorStudio(full) {
  const root = stripPrivateStudios(full);
  const key = operatorStudioKey();
  if (!hasWorkspaceData(root)) return { state: full, parked: false, studioKey: key };
  const personal = readPrivateStudio(full, key);
  const withOwner = hasWorkspaceData(personal) ? full : writePrivateStudio(full, key, root);
  return { state: blankSharedRoot(withOwner), parked: true, studioKey: key };
}

async function loadIsolatedWorkspace(orgId, identityId) {
  const row = await getWorkspace(orgId);
  const current = row?.state || emptyState();
  const parked = parkOperatorStudio(current);
  if (!parked.parked) {
    return { state: current, updated_at: row?.updated_at || null, parked: false };
  }
  const saved = await upsertWorkspace(orgId, parked.state, identityId || null);
  return {
    state: saved?.state || parked.state,
    updated_at: saved?.updated_at || row?.updated_at || null,
    parked: true,
  };
}

function hasWorkspaceData(state) {
  const s = sanitizeState(state);
  if (s.business && (s.business.name || s.business.id)) return true;
  return STATE_KEYS.some((k) => Array.isArray(s[k]) && s[k].length > 0);
}

async function getWorkspace(orgId) {
  if (!orgId || !denizenDb.enabled) return null;
  const rows = await denizenDb._get(
    `${TABLE}?select=org_id,state,schema_version,updated_at,updated_by&org_id=eq.${encodeURIComponent(orgId)}&limit=1`,
  ).catch(() => null);
  const row = rows?.[0];
  if (!row) return null;
  return {
    ...row,
    state: sanitizeState(row.state),
    schema_version: Math.max(Number(row.schema_version) || 1, SCHEMA_VERSION),
  };
}

async function upsertWorkspace(orgId, state, identityId, opts = {}) {
  if (!orgId || !denizenDb.enabled) return null;
  const existing = await getWorkspace(orgId);
  const clean = preservePrivateStudios(existing?.state, sanitizeState(state));
  const ifUpdatedAt = opts.ifUpdatedAt || null;

  if (ifUpdatedAt && existing?.updated_at && existing.updated_at !== ifUpdatedAt) {
    return {
      conflict: true,
      org_id: orgId,
      state: existing.state,
      updated_at: existing.updated_at,
      schema_version: existing.schema_version || SCHEMA_VERSION,
    };
  }

  const row = {
    org_id: orgId,
    state: clean,
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    updated_by: identityId || null,
  };

  if (existing) {
    await denizenDb._patch(
      `${TABLE}?org_id=eq.${encodeURIComponent(orgId)}`,
      {
        state: clean,
        schema_version: SCHEMA_VERSION,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      },
    );
  } else {
    await denizenDb._post(TABLE, row);
  }

  return {
    org_id: orgId,
    state: clean,
    updated_at: row.updated_at,
    schema_version: SCHEMA_VERSION,
    updated_by: row.updated_by,
  };
}

/** Filter workspace for mentor / investor roles — never trust UI alone. */
function filterStateForAdvisor(state, advisor) {
  const s = sanitizeState(state);
  const share = {
    ...(s.config?.mentorShareDefaults || {}),
    ...(advisor?.share || {}),
  };
  const out = emptyState();
  out.business = s.business ? {
    id: s.business.id,
    name: s.business.name,
    founderName: s.business.founderName,
  } : null;
  out.config = { mentorShareDefaults: share };

  if (share.programs) out.programs = s.programs;
  if (share.roadmap) {
    out.milestones = s.milestones;
    out.strategyNodes = s.strategyNodes;
    out.strategyEdges = s.strategyEdges;
  }
  if (share.goals) out.goals = s.goals;
  if (share.experiments) {
    out.assumptions = s.assumptions;
    out.experiments = s.experiments;
    out.findings = s.findings;
    out.decisions = s.decisions;
  }
  if (share.evidence) out.evidence = s.evidence;
  if (share.metrics) {
    out.metrics = (s.metrics || []).filter((m) => m.sharedWithAdvisors !== false);
    out.metricValues = s.metricValues;
  }
  if (share.funding !== false) out.funding = s.funding;
  if (share.meetings) out.meetings = s.meetings;
  if (share.deliverables || share.pave) {
    // programs already copied; pave lives on program
  }
  out.comments = (s.comments || []).filter((c) => c.visibility !== 'private');
  out.recommendations = (s.recommendations || []).filter((r) =>
    !advisor?.email || r.advisorEmail === advisor.email || r.toRole === 'founder'
  );
  out.tasks = []; // mentors suggest; do not see full private task list by default
  out.activity = (s.activity || []).slice(0, 50);
  return out;
}

/** Investor view — only diligence items explicitly shared in Data Room. */
function filterStateForInvestor(state, advisor) {
  const s = sanitizeState(state);
  const shareMap = s.funding?.dataRoom?.sharedWithInvestors || {};
  const out = emptyState();
  out.business = s.business ? {
    id: s.business.id,
    name: s.business.name,
    founderName: s.business.founderName,
  } : null;
  out.config = {
    investorMode: true,
    mentorShareDefaults: s.config?.mentorShareDefaults || {},
  };
  // Funding readiness items that are shared; strip private capital notes by default
  const funding = s.funding || emptyState().funding;
  out.funding = {
    ...emptyState().funding,
    items: Object.fromEntries(
      Object.entries(funding.items || {}).filter(([key]) => shareMap[key] === true),
    ),
    marketSizing: shareMap.tam || shareMap.sam || shareMap.som ? funding.marketSizing : emptyState().funding.marketSizing,
    moat: shareMap.moat || shareMap.defensibility_evidence ? funding.moat : emptyState().funding.moat,
    capitalPlan: shareMap.use_of_funds ? funding.capitalPlan : emptyState().funding.capitalPlan,
    dataRoom: { sharedWithInvestors: { ...shareMap } },
    unansweredInvestorQuestions: [],
  };
  out.evidence = (s.evidence || []).filter((e) => {
    const keys = [].concat(e.fundingKey || [], e.linkedFundingKeys || []);
    return keys.some((k) => shareMap[k] === true);
  });
  out.metrics = (s.metrics || []).filter((m) => m.sharedWithInvestors === true || m.sharedWithAdvisors === true);
  out.programs = shareMap.lean_canvas || shareMap.exec_summary
    ? (s.programs || []).map((p) => ({
      id: p.id,
      name: p.name,
      templateId: p.templateId,
      status: p.status,
      pave: advisor?.share?.pave === false ? null : p.pave,
    }))
    : [];
  out.comments = (s.comments || []).filter((c) => c.visibility === 'investor' || c.visibility === 'shared');
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  TABLE,
  STATE_KEYS,
  emptyState,
  emptyPhase2,
  sanitizePhase2,
  sanitizeState,
  selectPersonalState,
  operatorStudioKey,
  studioKeyForProfile,
  parkOperatorStudio,
  loadIsolatedWorkspace,
  applyBusinessProfile,
  strategyMapIsE3Template,
  stripPrivateStudios,
  readPrivateStudio,
  writePrivateStudio,
  preservePrivateStudios,
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
  filterStateForAdvisor,
  filterStateForInvestor,
};
