'use strict';

/**
 * Shared auth primitives for demo / Discord / team / MCP-OAuth providers.
 * Session grants and identity lookup live here so providers stay thin.
 */

const crypto = require('node:crypto');
const denizenDb = require('./denizen-db.js');
const sessionAuth = require('./visitor-session-auth.js');

class AuthError extends Error {
  constructor(message, code = 'AUTH_ERROR', status = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function authErrorStatus(err, fallback = 500) {
  if (!err) return fallback;
  if (typeof err.status === 'number') return err.status;
  if (err instanceof AuthError) return err.status || 400;
  switch (err.code) {
    case 'BAD_INPUT': return 400;
    case 'NOT_FOUND': return 404;
    case 'DENIED':
    case 'FORBIDDEN': return 403;
    case 'UNAUTHORIZED': return 401;
    case 'CONFLICT': return 409;
    default: return fallback;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function getIdentityById(identityId) {
  const id = String(identityId || '').trim();
  if (!id) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function getIdentityByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=*&email_normalized=eq.${encodeURIComponent(normalized)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function getIdentityByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=*&username=eq.${encodeURIComponent(normalized)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function getVisitorSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

function issueAccessGrant(opts = {}) {
  return sessionAuth.createAccessGrant(opts);
}

function verifyAccessGrant(token) {
  return sessionAuth.verifyAccessGrant(token);
}

function newAuthNonce(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  AuthError,
  authErrorStatus,
  normalizeEmail,
  normalizeUsername,
  getIdentityById,
  getIdentityByEmail,
  getIdentityByUsername,
  getVisitorSession,
  issueAccessGrant,
  verifyAccessGrant,
  newAuthNonce,
  // Re-export session helpers used by providers
  createAccessGrant: sessionAuth.createAccessGrant,
  verifyAccessGrantToken: sessionAuth.verifyAccessGrant,
};
