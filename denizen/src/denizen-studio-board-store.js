'use strict';

/**
 * Org-scoped Studio Board persistence (mirrors denizen-crm-store).
 * State shape matches studio-board/index.html shared board blob.
 */

const denizenDb = require('./denizen-db');
const acl = require('./denizen-studio-board-acl');

const SCHEMA_VERSION = 2;
const TABLE = 'denizen_studio_board_workspaces';

const STATE_KEYS = Object.freeze([
  'tasks',
  'people',
  'events',
  'templates',
  'notes',
  'activity',
  'config',
]);

function emptyState() {
  return {
    tasks: [],
    people: [],
    events: [],
    templates: [],
    notes: [],
    activity: [],
    config: null,
  };
}

function migrateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  acl.ensureAcl(config);
  if (!Array.isArray(config.columns)) config.columns = [];
  if (!Array.isArray(config.groups)) {
    config.groups = [
      { id: 'active', name: 'Active' },
      { id: 'backlog', name: 'Backlog' },
    ];
  }
  if (!Array.isArray(config.automations)) config.automations = [];
  return config;
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const out = emptyState();
  for (const key of STATE_KEYS) {
    if (raw[key] === undefined) continue;
    if (key === 'config') {
      if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) {
        out.config = migrateConfig({ ...raw.config });
      }
      continue;
    }
    if (Array.isArray(raw[key])) out[key] = raw[key];
  }
  // Ensure tasks have fields / groupId defaults
  out.tasks = (out.tasks || []).map((t) => {
    if (!t || typeof t !== 'object') return t;
    const task = { ...t };
    if (!task.fields || typeof task.fields !== 'object') task.fields = {};
    if (!Array.isArray(task.blockedBy)) task.blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : [];
    return task;
  });
  return out;
}

function hasWorkspaceData(state) {
  const s = sanitizeState(state);
  if (Array.isArray(s.tasks) && s.tasks.length) return true;
  if (Array.isArray(s.people) && s.people.length) return true;
  if (Array.isArray(s.events) && s.events.length) return true;
  if (Array.isArray(s.notes) && s.notes.length) return true;
  if (Array.isArray(s.activity) && s.activity.length) return true;
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

/**
 * Load → mutator(state) → upsert with conflict detection.
 * mutator may return false to abort without write.
 */
async function patchWorkspace(orgId, mutator, identityId, opts = {}) {
  if (!orgId || !denizenDb.enabled) {
    return { ok: false, error: 'database unavailable' };
  }
  const existing = await getWorkspace(orgId);
  const ifUpdatedAt = opts.ifUpdatedAt || null;
  if (ifUpdatedAt && existing?.updated_at && existing.updated_at !== ifUpdatedAt) {
    return {
      ok: false,
      conflict: true,
      org_id: orgId,
      state: existing.state,
      updated_at: existing.updated_at,
      schema_version: existing.schema_version || SCHEMA_VERSION,
    };
  }
  const state = existing?.state ? sanitizeState(existing.state) : emptyState();
  const result = await mutator(state);
  if (result === false) {
    return { ok: false, error: opts.abortError || 'patch aborted', state };
  }
  const saved = await upsertWorkspace(orgId, state, identityId, {
    ifUpdatedAt: existing?.updated_at || null,
  });
  if (saved?.conflict) {
    return {
      ok: false,
      conflict: true,
      org_id: orgId,
      state: saved.state,
      updated_at: saved.updated_at,
      schema_version: saved.schema_version,
    };
  }
  return {
    ok: true,
    state: sanitizeState(saved?.state || state),
    updated_at: saved?.updated_at || new Date().toISOString(),
    schema_version: saved?.schema_version || SCHEMA_VERSION,
    result: result === true ? null : result,
  };
}

module.exports = {
  SCHEMA_VERSION,
  STATE_KEYS,
  TABLE,
  emptyState,
  sanitizeState,
  migrateConfig,
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
  patchWorkspace,
};
