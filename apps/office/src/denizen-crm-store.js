'use strict';

const denizenDb = require('./denizen-db');
const crmSpine = require('./denizen-crm-spine');
const { applyServerAutomations } = require('./denizen-crm-automations');
const { syncPortalTokenIndex } = require('./denizen-crm-portal');
const { emitCrmWebhooks } = require('./denizen-crm-webhooks');

const SCHEMA_VERSION = 1;

const STATE_KEYS = [
  'contacts',
  'deals',
  'notes',
  'tasks',
  'companies',
  'goals',
  'sequences',
  'sequenceEnrollments',
  'submissions',
  'quotes',
  'packages',
  'meetings',
  'automations',
  'emailTemplates',
  'emailLog',
  'auditLog',
  'noteBoards',
  'industryConfig',
  'contactGroups',
  'contactGroupMap',
  'crmQuotas',
  'userPrefs',
  'onboarding',
  'availability',
  'calendarConnections',
  'integrations',
  'metricSnapshots',
  'automationRuns',
  'dealComments',
  'aiThreads',
  'supportTickets',
  'marketingCampaigns',
  'teamPolicy',
  'usageLog',
];

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of STATE_KEYS) {
    if (raw[key] === undefined) continue;
    if (key === 'industryConfig') {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
        out[key] = raw[key];
      }
      continue;
    }
    if (key === 'contactGroupMap' || key === 'userPrefs' || key === 'calendarConnections' || key === 'integrations') {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
        out[key] = raw[key];
      }
      continue;
    }
    if (key === 'onboarding') {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
        out[key] = raw[key];
      }
      continue;
    }
    if (key === 'teamPolicy') {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
        out[key] = raw[key];
      }
      continue;
    }
    if (Array.isArray(raw[key])) out[key] = raw[key];
  }
  return out;
}

function hasWorkspaceData(state) {
  const s = sanitizeState(state);
  return STATE_KEYS.some((key) => {
    const v = s[key];
    if (Array.isArray(v)) return v.length > 0;
    if (key === 'industryConfig' && v && typeof v === 'object') {
      return Object.keys(v).length > 0;
    }
    if (key === 'contactGroupMap' && v && typeof v === 'object') {
      return Object.keys(v).length > 0;
    }
    return false;
  });
}

async function getWorkspace(orgId) {
  if (!orgId || !denizenDb.enabled) return null;
  const rows = await denizenDb._get(
    `denizen_crm_workspaces?select=org_id,state,schema_version,updated_at,updated_by&org_id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    ...row,
    state: sanitizeState(row.state),
  };
}

async function upsertWorkspace(orgId, state, identityId, opts = {}) {
  if (!orgId || !denizenDb.enabled) return null;
  let clean = sanitizeState(state);
  const existing = await getWorkspace(orgId);
  const ifUpdatedAt = opts.ifUpdatedAt || null;
  // Callers that already ran the automation engine (e.g. the scheduler's timer
  // pass) set skipAutomations to avoid a redundant second run on every save.
  if (!opts.skipAutomations) {
    const auto = await applyServerAutomations(clean, existing?.state || {});
    if (auto.changed) clean = sanitizeState(auto.state);
  }

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
    updated_by: identityId || null,
    updated_at: new Date().toISOString(),
  };
  const inserted = await denizenDb._post(
    'denizen_crm_workspaces?on_conflict=org_id',
    row,
    { prefer: 'resolution=merge-duplicates,return=representation' },
  );
  const saved = inserted?.[0] || row;
  crmSpine.syncSpine(orgId, clean);
  syncPortalTokenIndex(orgId, clean).catch(() => {});
  emitCrmWebhooks(existing?.state || {}, clean, orgId).catch(() => {});
  return saved;
}

module.exports = {
  SCHEMA_VERSION,
  STATE_KEYS,
  sanitizeState,
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
};
