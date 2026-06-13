'use strict';

const crypto = require('node:crypto');

const GRANT_TTL_MS = 15 * 60 * 1000;

function signingKey() {
  return String(
    process.env.DENIZEN_SESSION_SIGNING_KEY
    || process.env.AGENT_TOKEN
    || 'denizen-dev-signing-key-change-me',
  );
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signPayload(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function createAccessGrant({ tier, orgSlug, accessMethod = 'team_code', email = null } = {}) {
  const payload = {
    typ: 'access_grant',
    tier: String(tier || 'team'),
    org_slug: String(orgSlug || 'zion'),
    access_method: accessMethod,
    email: email || null,
    exp: Date.now() + GRANT_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  return signPayload(payload);
}

function verifyAccessGrant(grant) {
  const payload = verifySignedToken(grant);
  if (!payload || payload.typ !== 'access_grant') return null;
  return payload;
}

function createCeoGrant() {
  const payload = {
    typ: 'ceo_grant',
    // 7 days; the server re-issues a fresh grant on every verified session
    // touch, so an active CEO never goes stale.
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  return signPayload(payload);
}

function verifyCeoGrant(grant) {
  const payload = verifySignedToken(grant);
  if (!payload || payload.typ !== 'ceo_grant') return null;
  return payload;
}

function createSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = hashSessionToken(token);
  return { token, hash };
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function verifySessionToken(token, storedHash) {
  if (!token || !storedHash) return false;
  const hash = hashSessionToken(token);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
  } catch (_) {
    return false;
  }
}

function extractSessionAuth(req, body = {}) {
  const header = req.headers['x-session-token'] || req.headers['x-denizen-session-token'];
  const fromBody = body.session_token || body.sessionToken;
  let fromCookie = null;
  try {
    const cookie = require('./visitor-session-cookie');
    fromCookie = cookie.sessionTokenFromCookies(req);
  } catch (_) {}
  return String(header || fromBody || fromCookie || '').trim() || null;
}

module.exports = {
  createAccessGrant,
  verifyAccessGrant,
  createCeoGrant,
  verifyCeoGrant,
  createSessionToken,
  hashSessionToken,
  verifySessionToken,
  extractSessionAuth,
  GRANT_TTL_MS,
};
