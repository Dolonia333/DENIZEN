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
  'activity',
  'notifications',
  'config',
]);

function emptyState() {
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
    if (key === 'business' || key === 'config') continue;
    if (Array.isArray(raw[key])) out[key] = raw[key];
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
};
