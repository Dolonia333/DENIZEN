'use strict';

/**
 * Soft in-memory presence for Studio Board (per org).
 * Heartbeats expire after TTL_MS — no DB persistence.
 */

const TTL_MS = 30_000;
const byOrg = new Map(); // orgId -> Map(key -> presence)

function keyFor(identityId, sessionId, displayName) {
  return String(identityId || sessionId || displayName || 'anon').slice(0, 120);
}

function prune(orgMap, now = Date.now()) {
  for (const [k, row] of orgMap) {
    if (!row || now - Number(row.ts || 0) > TTL_MS) orgMap.delete(k);
  }
}

function heartbeat(orgId, payload = {}) {
  if (!orgId) return [];
  let orgMap = byOrg.get(orgId);
  if (!orgMap) {
    orgMap = new Map();
    byOrg.set(orgId, orgMap);
  }
  const now = Date.now();
  prune(orgMap, now);
  const displayName = String(payload.displayName || payload.display_name || payload.name || 'Teammate').slice(0, 64);
  const identityId = payload.identityId || payload.identity_id || null;
  const sessionId = payload.sessionId || payload.session_id || null;
  const k = keyFor(identityId, sessionId, displayName);
  orgMap.set(k, {
    key: k,
    displayName,
    identityId,
    sessionId,
    viewing: payload.viewing !== false,
    editingTaskId: payload.editingTaskId || payload.editing_task_id || null,
    editingTitle: payload.editingTitle || payload.editing_title || null,
    ts: now,
  });
  return list(orgId);
}

function list(orgId) {
  if (!orgId) return [];
  const orgMap = byOrg.get(orgId);
  if (!orgMap) return [];
  prune(orgMap);
  return [...orgMap.values()]
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)))
    .map((r) => ({
      display_name: r.displayName,
      identity_id: r.identityId,
      viewing: !!r.viewing,
      editing_task_id: r.editingTaskId || null,
      editing_title: r.editingTitle || null,
      last_seen_ms: r.ts,
    }));
}

module.exports = {
  TTL_MS,
  heartbeat,
  list,
};
