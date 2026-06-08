'use strict';

const crypto = require('node:crypto');

/** In-memory pending permission prompts keyed by session_id (desktop polls). */
const pendingBySession = new Map();
/** Resolvers waiting for user respond() — key: `${sessionId}:${requestId}` */
const responseWaiters = new Map();
const MAX_PENDING_AGE_MS = 10 * 60 * 1000;
const DEFAULT_WAIT_MS = 5 * 60 * 1000;

function pruneExpired() {
  const now = Date.now();
  for (const [sessionId, entry] of pendingBySession.entries()) {
    if (!entry || now - entry.created_at > MAX_PENDING_AGE_MS) {
      pendingBySession.delete(sessionId);
    }
  }
}

function requestPermission(sessionId, {
  title = 'Allow Denizen?',
  detail = '',
  capability = 'action',
  npc = null,
  action = null,
} = {}) {
  if (!sessionId) return null;
  pruneExpired();
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    session_id: String(sessionId),
    title: String(title || 'Allow Denizen?'),
    detail: String(detail || ''),
    capability: String(capability || 'action'),
    npc: npc || null,
    action: action || null,
    created_at: Date.now(),
  };
  pendingBySession.set(String(sessionId), entry);
  return entry;
}

function getPending(sessionId) {
  if (!sessionId) return null;
  pruneExpired();
  const entry = pendingBySession.get(String(sessionId));
  if (!entry) return null;
  if (Date.now() - entry.created_at > MAX_PENDING_AGE_MS) {
    pendingBySession.delete(String(sessionId));
    return null;
  }
  return entry;
}

function _waiterKey(sessionId, requestId) {
  return `${String(sessionId)}:${String(requestId || '')}`;
}

function _notifyWaiter(sessionId, requestId, result) {
  const key = _waiterKey(sessionId, requestId);
  const resolve = responseWaiters.get(key);
  if (typeof resolve === 'function') {
    responseWaiters.delete(key);
    resolve(result);
  }
}

function waitForResponse(sessionId, requestId, { timeoutMs = DEFAULT_WAIT_MS } = {}) {
  const sid = String(sessionId || '');
  const rid = String(requestId || '');
  if (!sid || !rid) {
    return Promise.reject(new Error('sessionId and requestId required'));
  }
  const key = _waiterKey(sid, rid);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      responseWaiters.delete(key);
      reject(new Error('Permission request timed out'));
    }, timeoutMs);
    responseWaiters.set(key, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function respond(sessionId, requestId, approved) {
  const entry = getPending(sessionId);
  if (!entry || entry.id !== String(requestId || '')) {
    return { ok: false, error: 'No matching permission request' };
  }
  pendingBySession.delete(String(sessionId));
  const result = {
    ok: true,
    approved: !!approved,
    request_id: entry.id,
    capability: entry.capability,
  };
  _notifyWaiter(sessionId, requestId, result);
  return result;
}

module.exports = {
  requestPermission,
  getPending,
  respond,
  waitForResponse,
};
