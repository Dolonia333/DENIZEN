'use strict';

/**
 * Visitor connections let assistants message across team boundaries only after
 * the target person accepts the request.
 */

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');
const userIdentity = require('./denizen-user-identity.js');

const STATUSES = new Set(['pending', 'accepted', 'declined', 'blocked']);
const RESPONSES = new Set(['accept', 'decline', 'block']);

class ConnectionError extends Error {
  constructor(message, code = 'BAD_INPUT') {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

function connectionErrorStatus(err) {
  if (!(err instanceof ConnectionError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT':
      return 400;
    case 'TARGET_NOT_FOUND':
      return 404;
    case 'PROFILE_REQUIRED':
      return 409;
    case 'CONNECTION_REQUIRED':
    case 'BLOCKED':
      return 403;
    default:
      return 500;
  }
}

function _ensureDb() {
  if (!denizenDb.enabled) {
    throw new ConnectionError('Connections require the Denizen database', 'PROFILE_REQUIRED');
  }
}

function _meta(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _safeMessage(message) {
  return String(message || '').trim().slice(0, 1000);
}

function _safeEmail(email) {
  const normalized = userIdentity.normalizeEmail(email);
  return normalized && normalized.includes('@') ? normalized : '';
}

function _status(value) {
  const s = String(value || '').toLowerCase();
  return STATUSES.has(s) ? s : 'pending';
}

async function resolveSessionProfile(sessionId, deps = {}) {
  _ensureDb();
  const visitor = deps.denizenVisitor || denizenVisitor;
  const identityApi = deps.userIdentity || userIdentity;
  if (!sessionId) {
    throw new ConnectionError('sessionId required', 'BAD_INPUT');
  }
  const session = await visitor.getSession(sessionId);
  if (!session) {
    throw new ConnectionError('Session not found', 'TARGET_NOT_FOUND');
  }

  let identity = session.identity_id
    ? await identityApi.getIdentityById(session.identity_id).catch(() => null)
    : null;

  if (!identity?.id) {
    identity = await identityApi.ensureIdentityForSession(sessionId, { session }).catch(() => null);
  }

  if (!identity?.id) {
    throw new ConnectionError(
      'Save your email/profile before requesting outside-team connections',
      'PROFILE_REQUIRED',
    );
  }
  return { session, identity };
}

async function _getConnectionById(connectionId) {
  _ensureDb();
  if (!connectionId) {
    throw new ConnectionError('connectionId required', 'BAD_INPUT');
  }
  const rows = await denizenDb._getSoft(
    `denizen_visitor_connections?select=*&id=eq.${encodeURIComponent(connectionId)}&limit=1`,
  );
  const row = rows?.[0] || null;
  if (!row) {
    throw new ConnectionError('Connection request not found', 'TARGET_NOT_FOUND');
  }
  return row;
}

async function _getConnectionDirection(requesterIdentityId, recipientIdentityId) {
  if (!requesterIdentityId || !recipientIdentityId) return null;
  const rows = await denizenDb._getSoft(
    [
      'denizen_visitor_connections?select=*',
      `requester_identity_id=eq.${encodeURIComponent(requesterIdentityId)}`,
      `recipient_identity_id=eq.${encodeURIComponent(recipientIdentityId)}`,
      'order=updated_at.desc',
      'limit=1',
    ].join('&'),
  );
  return rows?.[0] || null;
}

async function getConnectionBetween(identityA, identityB) {
  if (!identityA || !identityB || identityA === identityB) return null;
  const [forward, reverse] = await Promise.all([
    _getConnectionDirection(identityA, identityB),
    _getConnectionDirection(identityB, identityA),
  ]);
  if (!forward) return reverse;
  if (!reverse) return forward;
  const ft = new Date(forward.updated_at || forward.created_at || 0).getTime();
  const rt = new Date(reverse.updated_at || reverse.created_at || 0).getTime();
  return rt > ft ? reverse : forward;
}

async function _sessionForIdentity(identity, deps = {}) {
  if (!identity?.id) return null;
  const visitor = deps.denizenVisitor || denizenVisitor;
  if (identity.primary_session_id) {
    const primary = await visitor.getSession(identity.primary_session_id).catch(() => null);
    if (primary?.id && (!primary.identity_id || primary.identity_id === identity.id)) {
      return primary;
    }
  }
  const rows = await denizenDb._getSoft(
    [
      'denizen_visitor_sessions?select=id,display_name,org_id,identity_id,last_seen_at',
      `identity_id=eq.${encodeURIComponent(identity.id)}`,
      'order=last_seen_at.desc',
      'limit=1',
    ].join('&'),
  );
  return rows?.[0] || null;
}

async function _assistantForSession(sessionId, deps = {}) {
  if (!sessionId) return null;
  const visitor = deps.denizenVisitor || denizenVisitor;
  return visitor.getAssistant(sessionId).catch(() => null);
}

function _clientIdentity(identity) {
  if (!identity) return null;
  return {
    id: identity.id,
    display_name: identity.display_name || null,
    email: identity.email_normalized || identity.email || null,
    org_id: identity.org_id || null,
    tier: identity.tier || null,
  };
}

async function enrichConnection(row, currentIdentityId, deps = {}) {
  if (!row) return null;
  const identityApi = deps.userIdentity || userIdentity;
  const isRequester = row.requester_identity_id === currentIdentityId;
  const otherIdentityId = isRequester ? row.recipient_identity_id : row.requester_identity_id;
  const otherIdentity = otherIdentityId
    ? await identityApi.getIdentityById(otherIdentityId).catch(() => null)
    : null;
  const targetSession = await _sessionForIdentity(otherIdentity, deps);
  const assistant = await _assistantForSession(targetSession?.id, deps);
  const status = _status(row.status);
  return {
    id: row.id,
    status,
    direction: isRequester ? 'outgoing' : 'incoming',
    can_message: status === 'accepted' && !!targetSession?.id,
    requester_identity_id: row.requester_identity_id,
    recipient_identity_id: row.recipient_identity_id,
    requester_org_id: row.requester_org_id || null,
    recipient_org_id: row.recipient_org_id || null,
    other_identity: _clientIdentity(otherIdentity),
    other_identity_id: otherIdentityId || null,
    other_display_name: otherIdentity?.display_name || targetSession?.display_name || 'Connection',
    other_email: otherIdentity?.email_normalized || otherIdentity?.email || null,
    other_org_id: otherIdentity?.org_id || (isRequester ? row.recipient_org_id : row.requester_org_id) || null,
    target_session_id: targetSession?.id || null,
    target_office_id: targetSession?.identity_id || otherIdentityId || null,
    target_display_name: targetSession?.display_name || otherIdentity?.display_name || 'Connection',
    assistant_npc: assistant?.npc_key || null,
    assistant_name: assistant?.assistant_name || assistant?.display_name || null,
    request_message: row.message || null,
    metadata: _meta(row.metadata),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    accepted_at: row.accepted_at || null,
  };
}

async function listConnections(sessionId, deps = {}) {
  const { identity } = await resolveSessionProfile(sessionId, deps);
  const rows = await denizenDb._getSoft(
    [
      'denizen_visitor_connections?select=*',
      `or=(requester_identity_id.eq.${encodeURIComponent(identity.id)},recipient_identity_id.eq.${encodeURIComponent(identity.id)})`,
      'order=updated_at.desc',
    ].join('&'),
  );
  const enriched = [];
  for (const row of rows || []) {
    const item = await enrichConnection(row, identity.id, deps);
    if (item) enriched.push(item);
  }
  return {
    identity_id: identity.id,
    connections: enriched.filter((c) => c.status === 'accepted'),
    incoming: enriched.filter((c) => c.status === 'pending' && c.direction === 'incoming'),
    outgoing: enriched.filter((c) => c.status === 'pending' && c.direction === 'outgoing'),
    all: enriched,
  };
}

async function _targetIdentityForRequest({ targetEmail, targetSessionId } = {}, deps = {}) {
  const visitor = deps.denizenVisitor || denizenVisitor;
  const identityApi = deps.userIdentity || userIdentity;
  if (targetSessionId) {
    const session = await visitor.getSession(targetSessionId);
    if (!session) throw new ConnectionError('Target office not found', 'TARGET_NOT_FOUND');
    let identity = session.identity_id
      ? await identityApi.getIdentityById(session.identity_id).catch(() => null)
      : null;
    if (!identity?.id) {
      identity = await identityApi.ensureIdentityForSession(targetSessionId, { session }).catch(() => null);
    }
    if (!identity?.id) {
      throw new ConnectionError('That office does not have a profile to accept connections yet', 'PROFILE_REQUIRED');
    }
    return { identity, session };
  }

  const email = _safeEmail(targetEmail);
  if (!email) throw new ConnectionError('Target email required', 'BAD_INPUT');
  const identity = await identityApi.getIdentityByEmail(email);
  if (!identity?.id) {
    throw new ConnectionError('No Denizen profile found for that email yet', 'TARGET_NOT_FOUND');
  }
  const session = await _sessionForIdentity(identity, deps);
  return { identity, session };
}

async function _recordFact(factType, fromSessionId, targetIdentityId, payload = {}) {
  if (typeof denizenDb.recordFact !== 'function') return;
  try {
    await denizenDb.recordFact({
      factType,
      actorType: 'human',
      actorId: fromSessionId,
      entityType: 'user_identity',
      entityId: targetIdentityId || null,
      payload,
      tags: ['visitor', 'connection'],
    });
  } catch (_) {
    /* non-fatal */
  }
}

async function _upsertExistingForRequest(existing, fromProfile, target, message) {
  const now = new Date().toISOString();
  const fromIdentityId = fromProfile.identity.id;
  const targetIdentityId = target.identity.id;
  if (_status(existing.status) === 'blocked') {
    throw new ConnectionError('This connection is blocked', 'BLOCKED');
  }
  if (_status(existing.status) === 'accepted') {
    return existing;
  }
  if (
    existing.requester_identity_id === targetIdentityId
    && existing.recipient_identity_id === fromIdentityId
  ) {
    const rows = await denizenDb._patch(
      `denizen_visitor_connections?id=eq.${encodeURIComponent(existing.id)}`,
      {
        status: 'accepted',
        accepted_at: now,
        updated_at: now,
        metadata: {
          ..._meta(existing.metadata),
          accepted_by_session_id: fromProfile.session.id,
          accepted_by_reverse_request: true,
        },
      },
      { prefer: 'return=representation' },
    );
    return rows?.[0] || { ...existing, status: 'accepted', accepted_at: now, updated_at: now };
  }

  const rows = await denizenDb._patch(
    `denizen_visitor_connections?id=eq.${encodeURIComponent(existing.id)}`,
    {
      requester_identity_id: fromIdentityId,
      recipient_identity_id: targetIdentityId,
      requester_org_id: fromProfile.session.org_id || fromProfile.identity.org_id || null,
      recipient_org_id: target.session?.org_id || target.identity.org_id || null,
      requester_session_id: fromProfile.session.id,
      recipient_session_id: target.session?.id || target.identity.primary_session_id || null,
      status: 'pending',
      message,
      updated_at: now,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || existing;
}

async function requestConnection({
  fromSessionId,
  targetEmail,
  targetSessionId,
  message,
} = {}, deps = {}) {
  const fromProfile = await resolveSessionProfile(fromSessionId, deps);
  const target = await _targetIdentityForRequest({ targetEmail, targetSessionId }, deps);
  if (target.identity.id === fromProfile.identity.id) {
    throw new ConnectionError('Choose someone else to connect with', 'BAD_INPUT');
  }
  const note = _safeMessage(message);
  const existing = await getConnectionBetween(fromProfile.identity.id, target.identity.id);
  let row;
  if (existing?.id) {
    row = await _upsertExistingForRequest(existing, fromProfile, target, note);
  } else {
    const now = new Date().toISOString();
    const rows = await denizenDb._post(
      'denizen_visitor_connections',
      {
        requester_identity_id: fromProfile.identity.id,
        recipient_identity_id: target.identity.id,
        requester_org_id: fromProfile.session.org_id || fromProfile.identity.org_id || null,
        recipient_org_id: target.session?.org_id || target.identity.org_id || null,
        requester_session_id: fromProfile.session.id,
        recipient_session_id: target.session?.id || target.identity.primary_session_id || null,
        status: 'pending',
        message: note,
        updated_at: now,
      },
      { prefer: 'return=representation' },
    );
    row = rows?.[0] || null;
  }
  await _recordFact('visitor.connection.requested', fromSessionId, target.identity.id, {
    connection_id: row?.id || null,
    target_email: target.identity.email_normalized || target.identity.email || null,
    target_session_id: target.session?.id || null,
  });
  return enrichConnection(row, fromProfile.identity.id, deps);
}

async function respondConnection({ sessionId, connectionId, action } = {}, deps = {}) {
  const response = String(action || '').toLowerCase();
  if (!RESPONSES.has(response)) {
    throw new ConnectionError('action must be accept, decline, or block', 'BAD_INPUT');
  }
  const profile = await resolveSessionProfile(sessionId, deps);
  const row = await _getConnectionById(connectionId);
  if (row.recipient_identity_id !== profile.identity.id) {
    throw new ConnectionError('Only the invited person can answer this connection request', 'CONNECTION_REQUIRED');
  }
  const now = new Date().toISOString();
  const status = response === 'accept'
    ? 'accepted'
    : (response === 'block' ? 'blocked' : 'declined');
  const rows = await denizenDb._patch(
    `denizen_visitor_connections?id=eq.${encodeURIComponent(row.id)}`,
    {
      status,
      accepted_at: status === 'accepted' ? now : row.accepted_at || null,
      updated_at: now,
      metadata: {
        ..._meta(row.metadata),
        responded_by_session_id: sessionId,
        response,
      },
    },
    { prefer: 'return=representation' },
  );
  const updated = rows?.[0] || { ...row, status, updated_at: now };
  await _recordFact(`visitor.connection.${status}`, sessionId, row.requester_identity_id, {
    connection_id: row.id,
    requester_identity_id: row.requester_identity_id,
  });
  return enrichConnection(updated, profile.identity.id, deps);
}

async function hasAcceptedConnection(identityA, identityB) {
  const row = await getConnectionBetween(identityA, identityB);
  return _status(row?.status) === 'accepted';
}

async function canMessage({ fromSessionId, toSessionId } = {}, deps = {}) {
  if (!fromSessionId || !toSessionId) return false;
  if (fromSessionId === toSessionId) return true;
  const visitor = deps.denizenVisitor || denizenVisitor;
  const [fromSession, toSession] = await Promise.all([
    visitor.getSession(fromSessionId).catch(() => null),
    visitor.getSession(toSessionId).catch(() => null),
  ]);
  if (!fromSession?.id || !toSession?.id) return false;
  if (fromSession.org_id && toSession.org_id && fromSession.org_id === toSession.org_id) {
    return true;
  }
  if (!fromSession.identity_id || !toSession.identity_id) return false;
  return hasAcceptedConnection(fromSession.identity_id, toSession.identity_id);
}

async function assertCanMessage(args, deps = {}) {
  const ok = await canMessage(args, deps);
  if (!ok) {
    throw new ConnectionError(
      'Ask this person to accept your Denizen connection before assistants can message across teams',
      'CONNECTION_REQUIRED',
    );
  }
  return true;
}

module.exports = {
  ConnectionError,
  connectionErrorStatus,
  resolveSessionProfile,
  enrichConnection,
  listConnections,
  requestConnection,
  respondConnection,
  getConnectionBetween,
  hasAcceptedConnection,
  canMessage,
  assertCanMessage,
};
