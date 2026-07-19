'use strict';

/**
 * Per-identity virtual offices within a team org.
 * office_id === identity_id for team members; ceo-operator for host CEO view.
 */

const CEO_OFFICE_ID = 'ceo-operator';

/** WS payloads with office_id are delivered only to matching clients. */
const OFFICE_SCOPED_WS_TYPES = new Set([
  'npc_decision',
  'npc_think_wake',
  'npc_work_output',
  'npc_cascade',
  'npc_response',
  'furniture_placed',
  'furniture_removed',
  'npc_skill_start',
  'npc_skill_result',
  'npc_hallucination_flag',
  'office_bus_message',
  'assistant_handoff',
  // Multiplayer world-sync
  'player_pose',
  'players_snapshot',
  'player_left',
  'sim_host',
  'npc_poses',
]);

/** Min ms between accepted player_pose updates per presence key (~15 Hz). */
const POSE_MIN_INTERVAL_MS = 66;

/** officeId -> Map(presenceKey -> pose) */
const officePresence = new Map();
/** officeId -> { presenceKey, joinedAt, interactive } */
const officeSimHosts = new Map();
/** presenceKey -> last accepted pose timestamp */
const poseThrottleAt = new Map();
let _anonSeq = 0;

function ensurePresenceKey(ws) {
  if (!ws) return null;
  const prev = ws._denizenPresenceKey || null;
  let next = null;
  if (ws._denizenSessionId) {
    next = `sess:${ws._denizenSessionId}`;
  } else if (prev) {
    next = prev;
  } else {
    _anonSeq += 1;
    next = `anon:${Date.now().toString(36)}-${_anonSeq}`;
  }
  ws._denizenPresenceKey = next;

  // Re-register often upgrades anon:* → sess:* — drop the ghost pose so
  // peers (and this client) don't keep a second "me" in the room.
  if (prev && prev !== next && ws._denizenOfficeId) {
    const removed = removePlayerFromOffice(ws._denizenOfficeId, prev);
    if (removed) {
      ws._denizenPresenceKeyMigrated = { from: prev, to: next, removed };
    }
    const ghosts = Array.isArray(ws._denizenPresenceGhosts) ? ws._denizenPresenceGhosts : [];
    if (!ghosts.includes(prev)) ghosts.push(prev);
    ws._denizenPresenceGhosts = ghosts.slice(-12);
  }
  return next;
}

function _officeMap(officeId) {
  const id = normalizeOfficeId(officeId);
  if (!officePresence.has(id)) officePresence.set(id, new Map());
  return officePresence.get(id);
}

function listPlayersInOffice(officeId) {
  const map = officePresence.get(normalizeOfficeId(officeId));
  if (!map) return [];
  return [...map.values()];
}

function upsertPlayerPose(officeId, pose, opts = {}) {
  const id = normalizeOfficeId(officeId);
  const key = String(pose?.sessionId || pose?.presenceKey || '').trim();
  if (!key || !id) return { ok: false, reason: 'missing_key' };

  const now = Date.now();
  const throttleKey = `${id}:${key}`;
  if (!opts.force) {
    const last = poseThrottleAt.get(throttleKey) || 0;
    if (now - last < POSE_MIN_INTERVAL_MS) return { ok: false, reason: 'throttled' };
  }
  poseThrottleAt.set(throttleKey, now);

  const entry = {
    sessionId: key,
    visitorId: pose.visitorId || pose.identityId || null,
    displayName: String(pose.displayName || pose.display_name || 'Guest').slice(0, 48),
    x: Number(pose.x) || 0,
    y: Number(pose.y) || 0,
    facing: pose.facing || 'down',
    anim: pose.anim || 'idle',
    room: pose.room || null,
    interactive: pose.interactive !== false,
    spectator: !!pose.spectator,
    ts: now,
  };
  _officeMap(id).set(key, entry);
  return { ok: true, pose: entry, officeId: id };
}

function removePlayerFromOffice(officeId, presenceKey) {
  const id = normalizeOfficeId(officeId);
  const key = String(presenceKey || '').trim();
  if (!key || !id) return null;
  const map = officePresence.get(id);
  if (!map || !map.has(key)) return null;
  const removed = map.get(key);
  map.delete(key);
  if (map.size === 0) officePresence.delete(id);
  poseThrottleAt.delete(`${id}:${key}`);
  return removed;
}

function getSimHost(officeId) {
  return officeSimHosts.get(normalizeOfficeId(officeId)) || null;
}

function _pickOldestInteractive(officeId, clients) {
  const id = normalizeOfficeId(officeId);
  let best = null;
  forEachAgentClient(clients, (ws) => {
    if (ws._denizenOfficeId !== id) return;
    if (ws._denizenSpectator || ws._denizenDemoMode) return;
    if (ws._denizenInteractive === false) return;
    const key = ensurePresenceKey(ws);
    const joined = ws._denizenJoinedAt || 0;
    if (!best || joined < best.joinedAt) {
      best = { presenceKey: key, joinedAt: joined, interactive: true };
    }
  });
  return best;
}

/**
 * Ensure an office has a sim host. Elects first interactive client if none.
 * Returns { host, changed, message } where message is a sim_host payload or null.
 */
function ensureSimHost(officeId, clients, preferKey = null) {
  const id = normalizeOfficeId(officeId);
  const current = officeSimHosts.get(id);

  const stillConnected = (key) => {
    if (!key) return false;
    let found = false;
    forEachAgentClient(clients, (ws) => {
      if (ws._denizenOfficeId !== id) return;
      if (ensurePresenceKey(ws) === key && !ws._denizenSpectator && !ws._denizenDemoMode) {
        found = true;
      }
    });
    return found;
  };

  if (current && stillConnected(current.presenceKey)) {
    return {
      host: current,
      changed: false,
      message: {
        type: 'sim_host',
        office_id: id,
        sessionId: current.presenceKey,
        ts: Date.now(),
      },
    };
  }

  let next = null;
  if (preferKey && stillConnected(preferKey)) {
    next = { presenceKey: preferKey, joinedAt: Date.now(), interactive: true };
  } else {
    next = _pickOldestInteractive(id, clients);
  }

  if (!next) {
    officeSimHosts.delete(id);
    return {
      host: null,
      changed: !!current,
      message: { type: 'sim_host', office_id: id, sessionId: null, ts: Date.now() },
    };
  }

  officeSimHosts.set(id, next);
  return {
    host: next,
    changed: !current || current.presenceKey !== next.presenceKey,
    message: {
      type: 'sim_host',
      office_id: id,
      sessionId: next.presenceKey,
      ts: Date.now(),
    },
  };
}

function clearSimHostIf(presenceKey, officeId, clients) {
  const id = normalizeOfficeId(officeId);
  const current = officeSimHosts.get(id);
  if (!current || current.presenceKey !== presenceKey) {
    return ensureSimHost(id, clients);
  }
  officeSimHosts.delete(id);
  return ensureSimHost(id, clients);
}

/** Test helper — wipe in-memory multiplayer state. */
function _resetMultiplayerStateForTests() {
  officePresence.clear();
  officeSimHosts.clear();
  poseThrottleAt.clear();
  _anonSeq = 0;
}

/** Org-scoped — fan-out only to sockets with matching org_id. */
const ORG_SCOPED_WS_TYPES = new Set([
  'world_state',
  'world_state_batch',
]);

/** Always delivered to every connected client (security, operator alerts). */
const GLOBAL_WS_TYPES = new Set([
  'threat',
  'threat-cleared',
  'presence',
  'bouncer_security',
  'bouncer_linux_result',
  'lucy_handoff_alert',
  'npc_report_to_ceo',
  'research_brief_done',
  'daily_digest_sent',
  'lucy_browser_mirror',
  'lucy_browser_frame',
  'player_chat_response',
  'agent_command',
  'spawn_agent',
  'cofounder_speak',
  'assign_task',
]);

function normalizeOfficeId(id) {
  const s = String(id || '').trim();
  return s || CEO_OFFICE_ID;
}

/**
 * Resolve office from DB session row + WS flags.
 */
function resolveOfficeFromSession(session, opts = {}) {
  const isCeoWs = !!opts.isCeoWs;
  const isCeoPrincipal = !!(
    opts.isCeoPrincipal
    || session?.metadata?.is_ceo_principal
    || session?.metadata?.access_method === 'ceo_code'
  );

  if (isCeoWs && !session?.id) {
    return {
      officeId: CEO_OFFICE_ID,
      identityId: null,
      sessionId: null,
      isOperatorOffice: true,
      isCeoPrincipal: true,
    };
  }

  if (session?.identity_id) {
    const officeId = session.identity_id;
    return {
      officeId,
      identityId: session.identity_id,
      sessionId: session.id,
      isOperatorOffice: isCeoPrincipal,
      isCeoPrincipal,
    };
  }

  if (session?.id) {
    return {
      officeId: `session:${session.id}`,
      identityId: null,
      sessionId: session.id,
      isOperatorOffice: false,
      isCeoPrincipal: false,
    };
  }

  return {
    officeId: CEO_OFFICE_ID,
    identityId: null,
    sessionId: null,
    isOperatorOffice: isCeoWs,
    isCeoPrincipal: isCeoWs,
  };
}

function attachOfficeId(payload, officeId) {
  if (!payload || typeof payload !== 'object') return payload;
  const id = officeId ? normalizeOfficeId(officeId) : null;
  if (!id || id === CEO_OFFICE_ID && payload.office_id) return payload;
  return { ...payload, office_id: id };
}

/**
 * Should this socket receive a WS message?
 */
function shouldDeliverToSocket(msg, ws) {
  if (!msg || typeof msg !== 'object') return true;
  const type = msg.type;

  const targetOrg = msg.org_id ?? msg.orgId ?? null;
  if (targetOrg && (ORG_SCOPED_WS_TYPES.has(type) || type === 'presence')) {
    const mineOrg = ws?._denizenOrgId ?? null;
    if (mineOrg && mineOrg !== targetOrg) return false;
  }

  if (GLOBAL_WS_TYPES.has(type)) return true;
  if (!OFFICE_SCOPED_WS_TYPES.has(type)) {
    const target = msg.office_id ?? msg.officeId ?? null;
    if (!target) return true;
  }

  const targetOffice = msg.office_id ?? msg.officeId ?? null;
  if (!targetOffice) return true;

  const mine = ws?._denizenOfficeId || (ws?._denizenIsCeo ? CEO_OFFICE_ID : null);
  if (!mine) return false;

  if (targetOffice === CEO_OFFICE_ID) {
    return !!(ws._denizenIsCeo || ws._denizenIsOperatorOffice);
  }
  return mine === targetOffice;
}

function forEachAgentClient(clients, fn) {
  const set = clients || new Set();
  for (const ws of set) {
    if (ws?.readyState === 1) fn(ws);
  }
}

function broadcastAgent(clients, msg, opts = {}) {
  const officeId = opts.officeId ?? msg?.office_id ?? msg?.officeId ?? null;
  const orgId = opts.orgId ?? msg?.org_id ?? msg?.orgId ?? null;
  const excludeWs = opts.excludeWs || null;
  const excludePresenceKey = opts.excludePresenceKey
    || (excludeWs && (excludeWs._denizenPresenceKey || null))
    || null;
  let payload = msg;
  if (officeId) payload = attachOfficeId(payload, officeId);
  if (orgId && typeof payload === 'object' && payload) {
    payload = { ...payload, org_id: orgId };
  }
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  forEachAgentClient(clients, (ws) => {
    if (excludeWs && ws === excludeWs) return;
    if (excludePresenceKey && ws._denizenPresenceKey === excludePresenceKey) return;
    if (!shouldDeliverToSocket(typeof payload === 'object' ? payload : msg, ws)) return;
    try { ws.send(raw); } catch (_) {}
  });
}

function listOfficesOnline(clients) {
  const out = new Map();
  forEachAgentClient(clients, (ws) => {
    const id = ws._denizenOfficeId;
    if (!id || id === CEO_OFFICE_ID) return;
    if (!out.has(id)) {
      out.set(id, {
        officeId: id,
        sessionId: ws._denizenSessionId || null,
        displayName: ws._denizenDisplayName || 'Guest',
        isOperatorOffice: !!ws._denizenIsOperatorOffice,
      });
    }
  });
  return [...out.values()];
}

function lucyRoleForOffice(isOperatorOffice) {
  return isOperatorOffice
    ? 'CEO / Chief of Staff — you run company operations for the host principal'
    : 'Office NPC — this visitor is the CEO of their own virtual team; you are not the company CEO here';
}

function isLucyCeoInOffice(isOperatorOffice) {
  return !!isOperatorOffice;
}

module.exports = {
  CEO_OFFICE_ID,
  OFFICE_SCOPED_WS_TYPES,
  ORG_SCOPED_WS_TYPES,
  GLOBAL_WS_TYPES,
  POSE_MIN_INTERVAL_MS,
  normalizeOfficeId,
  resolveOfficeFromSession,
  attachOfficeId,
  shouldDeliverToSocket,
  broadcastAgent,
  listOfficesOnline,
  lucyRoleForOffice,
  isLucyCeoInOffice,
  ensurePresenceKey,
  listPlayersInOffice,
  upsertPlayerPose,
  removePlayerFromOffice,
  getSimHost,
  ensureSimHost,
  clearSimHostIf,
  _resetMultiplayerStateForTests,
};
