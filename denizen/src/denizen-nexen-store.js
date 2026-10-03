'use strict';

/**
 * Org-scoped NEXEN workspace persistence (mirrors studio-board / business-studio stores).
 * Backs the DENIZEN phone app at /nexen/.
 */

const denizenDb = require('./denizen-db');

const SCHEMA_VERSION = 1;
const TABLE = 'denizen_nexen_workspaces';

const STATE_KEYS = Object.freeze([
  'requests',
  'tasks',
  'checkins',
  'notes',
  'activity',
  'config',
]);

function emptyState() {
  return {
    requests: [],
    tasks: [],
    checkins: [],
    notes: [],
    activity: [],
    config: {
      focusTitle: 'Your next move',
      focusDetail: 'Save a request or mark a priority task from the Command Center.',
      workspaces: [
        { id: 'tasks', label: 'Task room', hint: 'Priorities and follow-ups', icon: '☷' },
        { id: 'money', label: 'Money Engine', hint: 'Plans and next actions', icon: '$' },
        { id: 'voice', label: 'Voice', hint: 'Local command shell', icon: '✦' },
        { id: 'checkin', label: 'Daily check-in', hint: 'Mood and notes', icon: '♡' },
        { id: 'agents', label: 'Agent Desk', hint: 'Team + skills', icon: '⌘' },
        { id: 'city', label: 'WDR City', hint: 'Playable workspace (soon)', icon: '◇' },
      ],
    },
  };
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const out = emptyState();
  for (const key of STATE_KEYS) {
    if (raw[key] === undefined) continue;
    if (key === 'config') {
      if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) {
        out.config = { ...out.config, ...raw.config };
        if (!Array.isArray(out.config.workspaces)) out.config.workspaces = emptyState().config.workspaces;
      }
      continue;
    }
    if (Array.isArray(raw[key])) out[key] = raw[key];
  }
  out.requests = (out.requests || []).filter((r) => r && typeof r === 'object').map((r) => ({
    id: String(r.id || ''),
    text: String(r.text || '').slice(0, 4000),
    status: String(r.status || 'planned'),
    created_at: r.created_at || new Date().toISOString(),
    created_by: r.created_by || null,
  })).filter((r) => r.id && r.text);
  out.tasks = (out.tasks || []).filter((t) => t && typeof t === 'object').map((t) => ({
    id: String(t.id || ''),
    title: String(t.title || '').slice(0, 240),
    status: String(t.status || 'open'),
    priority: String(t.priority || 'normal'),
    notes: String(t.notes || '').slice(0, 4000),
    created_at: t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || t.created_at || new Date().toISOString(),
  })).filter((t) => t.id && t.title);
  out.checkins = (out.checkins || []).filter((c) => c && typeof c === 'object');
  out.notes = (out.notes || []).filter((n) => n && typeof n === 'object');
  out.activity = (out.activity || []).filter((a) => a && typeof a === 'object').slice(0, 200);
  return out;
}

function hasWorkspaceData(state) {
  const s = sanitizeState(state);
  return !!(s.requests.length || s.tasks.length || s.checkins.length || s.notes.length || s.activity.length);
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
  hasWorkspaceData,
  getWorkspace,
  upsertWorkspace,
  patchWorkspace,
};
