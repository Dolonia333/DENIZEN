'use strict';

/**
 * Org-scoped Business Studio workspace persistence (mirrors studio-board-store).
 */

const denizenDb = require('./denizen-db');

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
  return out;
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
  const clean = sanitizeState(state);
  const existing = await getWorkspace(orgId);
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
  sanitizeState,
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
  filterStateForAdvisor,
  filterStateForInvestor,
};
