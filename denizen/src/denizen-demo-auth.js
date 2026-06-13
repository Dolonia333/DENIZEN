'use strict';

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');
const promptTuning = require('./prompt-tuning.js');
const visitorAccess = require('./visitor-access.js');
const userIdentity = require('./denizen-user-identity.js');
const { createAccessGrant } = require('./visitor-session-auth.js');
const { hashPassword, verifyPassword, assertPasswordMinLength } = require('./denizen-team-password.js');

class DemoAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DemoAuthError';
    this.code = code;
  }
}

function demoAuthErrorStatus(err) {
  if (!(err instanceof DemoAuthError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT': return 400;
    case 'NOT_FOUND': return 404;
    case 'DENIED': return 403;
    default: return 500;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveDemoOrg() {
  const org = await denizenVisitor.resolveOrgBySlug(promptTuning.demoOrgSlug);
  if (!org?.id) throw new DemoAuthError('Demo org not configured', 'NOT_FOUND');
  return org;
}

async function findIdentityByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=*&username=eq.${encodeURIComponent(normalized)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function registerDemoAccount({
  sessionId,
  sessionToken,
  username,
  password,
} = {}) {
  const user = String(username || '').trim().slice(0, 64);
  const pass = String(password || '');
  if (!sessionId || !user || !pass) {
    throw new DemoAuthError('session_id, username, and password required', 'BAD_INPUT');
  }
  try {
    assertPasswordMinLength(pass);
  } catch (err) {
    throw new DemoAuthError(err.message, err.code || 'BAD_INPUT');
  }
  if (!/^[a-z0-9._-]+$/i.test(user)) {
    throw new DemoAuthError('username may only use letters, numbers, dots, dashes, and underscores', 'BAD_INPUT');
  }

  await visitorAccess.assertSessionToken(sessionId, sessionToken);
  const access = await visitorAccess.resolveSessionAccess(sessionId);
  if (!access.isDemo) {
    throw new DemoAuthError('demo session required', 'DENIED');
  }

  const identity = await userIdentity.getIdentityBySession(sessionId);
  if (!identity) {
    throw new DemoAuthError('identity not found for this demo session', 'NOT_FOUND');
  }
  if (identity.password_hash) {
    throw new DemoAuthError('Demo account already created for this profile', 'DENIED');
  }

  const normalizedUsername = normalizeUsername(user);
  const taken = await findIdentityByUsername(normalizedUsername);
  if (taken && taken.id !== identity.id) {
    throw new DemoAuthError('Username already taken', 'DENIED');
  }

  const rows = await denizenDb._patch(
    `denizen_user_identities?id=eq.${encodeURIComponent(identity.id)}`,
    {
      username: normalizedUsername,
      password_hash: hashPassword(pass),
      display_name: user,
      metadata: {
        ...(identity.metadata && typeof identity.metadata === 'object' ? identity.metadata : {}),
        demo_account: true,
      },
    },
    { prefer: 'return=representation' },
  );
  const updated = rows?.[0] || {
    ...identity,
    username: normalizedUsername,
    display_name: user,
  };

  return {
    username: normalizedUsername,
    display_name: updated.display_name || user,
    email: updated.email_normalized || updated.email || identity.email_normalized,
    tier: 'demo',
    identity: userIdentity.toClientIdentity({
      ...updated,
      username: normalizedUsername,
    }),
  };
}

async function loginDemoAccount({ username, password } = {}) {
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) {
    throw new DemoAuthError('username and password required', 'BAD_INPUT');
  }

  const identity = await findIdentityByUsername(user);
  if (!identity) {
    throw new DemoAuthError('Demo account not found', 'NOT_FOUND');
  }
  if (!identity.password_hash) {
    throw new DemoAuthError('This profile has no password yet — start from Demo', 'DENIED');
  }
  if (!verifyPassword(pass, identity.password_hash)) {
    throw new DemoAuthError('Invalid password', 'DENIED');
  }
  if (String(identity.tier || '').toLowerCase() !== 'demo') {
    throw new DemoAuthError('Use team login for this account', 'DENIED');
  }

  const org = await resolveDemoOrg();
  const access_grant = createAccessGrant({
    tier: 'demo',
    orgSlug: org.slug,
    accessMethod: 'demo_login',
    email: identity.email_normalized || identity.email,
  });

  await denizenDb._patch(
    `denizen_user_identities?id=eq.${encodeURIComponent(identity.id)}`,
    { last_login_at: new Date().toISOString(), login_count: (identity.login_count || 0) + 1 },
    { prefer: 'return=minimal' },
  ).catch(() => {});

  return {
    org_slug: org.slug,
    tier: 'demo',
    access_grant,
    display_name: identity.display_name,
    username: identity.username,
    identity: userIdentity.toClientIdentity(identity),
  };
}

async function getDemoAccountStatus(sessionId) {
  if (!sessionId) return { has_account: false, username: null };
  const identity = await userIdentity.getIdentityBySession(sessionId);
  if (!identity) return { has_account: false, username: null };
  return {
    has_account: !!identity.password_hash,
    username: identity.username || null,
  };
}

module.exports = {
  DemoAuthError,
  demoAuthErrorStatus,
  registerDemoAccount,
  loginDemoAccount,
  getDemoAccountStatus,
};
