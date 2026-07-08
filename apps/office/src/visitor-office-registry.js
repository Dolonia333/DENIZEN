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
]);

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
  let payload = msg;
  if (officeId) payload = attachOfficeId(payload, officeId);
  if (orgId && typeof payload === 'object' && payload) {
    payload = { ...payload, org_id: orgId };
  }
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  forEachAgentClient(clients, (ws) => {
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
  normalizeOfficeId,
  resolveOfficeFromSession,
  attachOfficeId,
  shouldDeliverToSocket,
  broadcastAgent,
  listOfficesOnline,
  lucyRoleForOffice,
  isLucyCeoInOffice,
};
