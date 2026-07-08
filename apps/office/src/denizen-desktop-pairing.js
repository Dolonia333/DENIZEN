'use strict';

const crypto = require('node:crypto');

const PAIR_TTL_MS = 5 * 60 * 1000;
const usedPairingJtis = new Set();

function createPairingToken({ sessionId, sessionToken, serverUrl } = {}) {
  if (!sessionId) throw new Error('session_id required');
  const payload = {
    typ: 'desktop_pair',
    session_id: String(sessionId),
    session_token: sessionToken ? String(sessionToken) : null,
    server_url: serverUrl ? String(serverUrl).replace(/\/+$/, '') : null,
    exp: Date.now() + PAIR_TTL_MS,
    jti: crypto.randomBytes(10).toString('hex'),
  };
  return signPayload(payload);
}

function signingKey() {
  return String(
    process.env.DENIZEN_SESSION_SIGNING_KEY
    || process.env.AGENT_TOKEN
    || 'denizen-dev-signing-key-change-me',
  );
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function claimPairingToken(token) {
  const payload = verifySignedToken(token);
  if (!payload || payload.typ !== 'desktop_pair') return null;
  if (payload.jti && usedPairingJtis.has(payload.jti)) return null;
  if (payload.jti) usedPairingJtis.add(payload.jti);
  return {
    session_id: payload.session_id,
    session_token: payload.session_token || null,
    server_url: payload.server_url || null,
    expires_at: payload.exp,
  };
}

function buildPairingResponse(token, serverUrl) {
  const server = serverUrl ? String(serverUrl).replace(/\/+$/, '') : null;
  const deepLink = `denizen://pair?token=${encodeURIComponent(token)}${server ? `&server=${encodeURIComponent(server)}` : ''}`;
  return {
    ok: true,
    token,
    server_url: server,
    deep_link: deepLink,
    expires_in_sec: Math.floor(PAIR_TTL_MS / 1000),
  };
}

module.exports = {
  PAIR_TTL_MS,
  createPairingToken,
  claimPairingToken,
  buildPairingResponse,
};
