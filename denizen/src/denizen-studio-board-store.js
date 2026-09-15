'use strict';

/**
 * Org-scoped Studio Board persistence (mirrors denizen-crm-store).
 * State shape matches studio-board/index.html shared board blob.
 */

const denizenDb = require('./denizen-db');

const SCHEMA_VERSION = 1;
const TABLE = 'denizen_studio_board_workspaces';

const STATE_KEYS = Object.freeze([
  'tasks',
  'people',
  'events',
  'templates',
  'notes',
  'config',
]);

function emptyState() {
  return {
    tasks: [],
    people: [],
    events: [],
    templates: [],
    notes: [],
    config: null,
  };
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const out = emptyState();
  for (const key of STATE_KEYS) {
    if (raw[key] === undefined) continue;
    if (key === 'config') {
      if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) {
        out.config = raw.config;
      }
      continue;
    }
    if (Array.isArray(raw[key])) out[key] = raw[key];
  }
  return out;
}

function hasWorkspaceData(state) {
  const s = sanitizeState(state);
  if (Array.isArray(s.tasks) && s.tasks.length) return true;
  if (Array.isArray(s.people) && s.people.length) return true;
  if (Array.isArray(s.events) && s.events.length) return true;
  if (Array.isArray(s.notes) && s.notes.length) return true;
  if (s.config && typeof s.config === 'object') {
    const cats = s.config.categories;
    const stages = s.config.stages;
    if (Array.isArray(cats) && cats.length) return true;
    if (Array.isArray(stages) && stages.length) return true;
  }
  return false;
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
    updated_by: identityId || null,
    updated_at: new Date().toISOString(),
  };
  const inserted = await denizenDb._post(
    `${TABLE}?on_conflict=org_id`,
    row,
    { prefer: 'resolution=merge-duplicates,return=representation' },
  );
  return inserted?.[0] || row;
}

module.exports = {
  SCHEMA_VERSION,
  STATE_KEYS,
  TABLE,
  emptyState,
  sanitizeState,
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
};
