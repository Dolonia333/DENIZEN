'use strict';

/**
 * Cross-office assistant messaging — teammates' assistants coordinate without
 * sharing a single office simulation.
 */

const denizenVisitor = require('./visitors/denizen-visitor');
const userIdentity = require('./auth/denizen-user-identity');
const visitorConnections = require('./visitors/visitor-connections');

const INTENTS = new Set(['status', 'ask_help', 'delegate', 'reply', 'sync']);

async function resolveOfficeAssistant(officeId, deps = {}) {
  if (!officeId) return null;
  const visitor = deps.denizenVisitor || denizenVisitor;
  const identity = deps.userIdentity || userIdentity;

  const sessions = await _sessionsForOffice(officeId, visitor, deps);
  for (const session of sessions) {
    const asst = await visitor.getAssistant(session.id).catch(() => null);
    if (asst?.npc_key) {
      return {
        sessionId: session.id,
        displayName: session.display_name || 'Guest',
        officeId,
        identityId: session.identity_id || officeId,
        npcKey: asst.npc_key,
        assistantName: asst.assistant_name || asst.npc_key,
      };
    }
  }
  return null;
}

async function _sessionsForOffice(officeId, visitor, deps = {}) {
  if (String(officeId).startsWith('session:')) {
    const sid = officeId.slice('session:'.length);
    const s = await visitor.getSession(sid).catch(() => null);
    return s ? [s] : [];
  }
  const out = [];
  const online = deps.listOnlineSessionIds?.() || [];
  for (const sid of online) {
    try {
      const s = await visitor.getSession(sid);
      if (s?.identity_id === officeId) out.push(s);
    } catch (_) {}
  }
  return out;
}

async function sendOfficeBusMessage({
  fromSessionId,
  toOfficeId,
  toSessionId,
  message,
  intent = 'sync',
  fromNpc,
  metadata,
}, deps = {}) {
  const visitor = deps.denizenVisitor || denizenVisitor;
  const connectionApi = deps.visitorConnections || visitorConnections;
  const intentKey = INTENTS.has(intent) ? intent : 'sync';
  let targetSessionId = toSessionId || null;

  if (!targetSessionId && toOfficeId) {
    const targetAsst = await resolveOfficeAssistant(toOfficeId, deps);
    if (!targetAsst?.sessionId) {
      throw new Error('Target office has no online assistant session');
    }
    targetSessionId = targetAsst.sessionId;
  }

  if (!fromSessionId || !targetSessionId || !message) {
    throw new Error('fromSessionId, target, and message required');
  }

  await connectionApi.assertCanMessage({ fromSessionId, toSessionId: targetSessionId }, deps);

  const fromSession = await visitor.getSession(fromSessionId);
  const fromOfficeId = fromSession?.identity_id || `session:${fromSessionId}`;
  const fromAssistant = await visitor.getAssistant(fromSessionId).catch(() => null);

  const handoff = await visitor.sendHandoff({
    fromSessionId,
    toSessionId: targetSessionId,
    fromNpc: fromNpc || fromAssistant?.npc_key || 'assistant',
    toNpc: 'assistant',
    message: String(message).slice(0, 4000),
    metadata: {
      office_bus: true,
      intent: intentKey,
      from_office_id: fromOfficeId,
      to_office_id: toOfficeId || null,
      ...(metadata || {}),
    },
  });

  return {
    ...handoff,
    to_session_id: targetSessionId,
    from_display_name: fromSession?.display_name || null,
    from_office_id: fromOfficeId,
    to_office_id: toOfficeId || null,
    intent: intentKey,
  };
}

async function listOrgOfficePresence(orgId, deps = {}) {
  const visitor = deps.denizenVisitor || denizenVisitor;
  const online = deps.listOnlineSessionIds?.() || new Set();
  if (!orgId) return [];

  const rows = await visitor.listTeammatesWithPresence?.('__self__', online).catch(() => []);
  void rows;
  const out = [];
  for (const sid of online) {
    try {
      const session = await visitor.getSession(sid);
      if (!session || session.org_id !== orgId) continue;
      const asst = await visitor.getAssistant(sid).catch(() => null);
      out.push({
        sessionId: sid,
        displayName: session.display_name,
        officeId: session.identity_id || `session:${sid}`,
        identityId: session.identity_id,
        assistantNpc: asst?.npc_key || null,
        assistantName: asst?.assistant_name || null,
        online: true,
      });
    } catch (_) {}
  }
  return out;
}

module.exports = {
  INTENTS,
  resolveOfficeAssistant,
  sendOfficeBusMessage,
  listOrgOfficePresence,
};
