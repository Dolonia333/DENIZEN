'use strict';

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');
const promptTuning = require('./prompt-tuning.js');
const authBase = require('./denizen-auth-base.js');
const { createAccessGrant } = authBase;
const { createCeoGrant } = require('./visitor-session-auth.js');
const { verifyAccessCode } = require('./visitor-access.js');
const userIdentity = require('./denizen-user-identity.js');
const { hashPassword, verifyPassword, assertPasswordMinLength } = require('./denizen-team-password.js');

class TeamAuthError extends authBase.AuthError {
  constructor(message, code) {
    super(message, code, authBase.authErrorStatus({ code }, 500));
    this.name = 'TeamAuthError';
  }
}

function teamAuthErrorStatus(err) {
  return authBase.authErrorStatus(err, 500);
}

function generateTeamCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function slugifyTeamName(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `team-${Date.now().toString(36)}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  const s = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function resolveTeamOrg() {
  const org = await denizenDb._get(
    `denizen_organizations?select=id,slug,display_name,settings&slug=eq.${encodeURIComponent(promptTuning.teamOrgSlug)}&limit=1`,
  );
  if (!org?.[0]) throw new TeamAuthError('Team org not configured', 'NOT_FOUND');
  return org[0];
}

async function resolveOrgByTeamCode(teamCode) {
  const normalized = String(teamCode || '').trim();
  if (!normalized) return null;

  const legacy = verifyAccessCode(normalized, 'team');
  if (legacy.ok) {
    const org = await resolveTeamOrg().catch(() => null);
    if (org) return org;
  }

  const rows = await denizenDb._get(
    `denizen_organizations?select=id,slug,display_name,settings&settings->>team_code=eq.${encodeURIComponent(normalized)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

function configuredOwnerEmail() {
  return String(process.env.DENIZEN_TEAM_OWNER_EMAIL || '').trim().toLowerCase();
}

function isConfiguredOwnerEmail(email) {
  const owner = configuredOwnerEmail();
  return !!owner && String(email || '').trim().toLowerCase() === owner;
}

async function orgHasSkillApprover(orgId) {
  if (!orgId || !denizenDb.enabled) return false;
  const rows = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${encodeURIComponent(orgId)}&role=in.(owner,admin)&limit=1`,
  ).catch(() => []);
  return !!rows?.length;
}

async function resolveTeamMemberRole(email, orgId) {
  if (isConfiguredOwnerEmail(email)) return 'owner';
  if (configuredOwnerEmail()) return 'member';
  const hasApprover = await orgHasSkillApprover(orgId);
  return hasApprover ? 'member' : 'owner';
}

async function ensureOwnerRoleIfConfigured(account, orgId) {
  if (!account?.id || !isConfiguredOwnerEmail(account.email)) return account;
  if (account.role === 'owner') return account;
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${encodeURIComponent(account.id)}`,
    { role: 'owner' },
    { prefer: 'return=minimal' },
  ).catch(() => {});
  return { ...account, role: 'owner' };
}

async function findTeamAccount({ orgId, email, username } = {}) {
  if (!orgId) return null;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedUsername = normalizeUsername(username);
  // Prefer email when provided — unique per org and avoids binding the wrong
  // row when the typed username belongs to a different teammate.
  if (normalizedEmail) {
    const byEmail = await denizenDb._get(
      `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
    );
    if (byEmail?.[0]) return byEmail[0];
  }
  if (normalizedUsername) {
    const byUser = await denizenDb._get(
      `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(orgId)}&username=eq.${encodeURIComponent(normalizedUsername)}&limit=1`,
    );
    if (byUser?.[0]) return byUser[0];
  }
  return null;
}

async function findTeamAccountByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];
  return denizenDb._get(
    `denizen_team_accounts?select=*,org_id&email=eq.${encodeURIComponent(normalizedEmail)}&limit=5`,
  ).catch(() => []);
}

function assertPassword(account, password) {
  const pass = String(password || '');
  if (account?.password_hash) {
    if (!pass) throw new TeamAuthError('password required', 'BAD_INPUT');
    if (!verifyPassword(pass, account.password_hash)) {
      throw new TeamAuthError('Invalid password', 'DENIED');
    }
    return;
  }
  if (pass) return;
}

function isTeamOwnerAccount(account) {
  if (!account) return false;
  if (isConfiguredOwnerEmail(account.email)) return true;
  return String(account.role || '').toLowerCase() === 'owner';
}

function toPublicTeamAccount(account) {
  if (!account) return null;
  const {
    password_hash: _passwordHash,
    ...safe
  } = account;
  return safe;
}

async function sessionBundle(account, org, accessMethod, source) {
  const isOwner = isTeamOwnerAccount(account);
  const grantAccessMethod = isOwner ? 'owner_login' : accessMethod;

  const access_grant = createAccessGrant({
    tier: 'team',
    orgSlug: org.slug,
    accessMethod: grantAccessMethod,
    email: account.email,
  });

  const identity = await userIdentity.upsertIdentity({
    email: account.email,
    displayName: account.display_name,
    tier: isOwner ? 'ceo' : 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source,
    teamAccountId: account.id,
    updateDisplayName: accessMethod !== 'website_login',
  });

  if (isOwner && identity?.id) {
    userIdentity.markCeoPrincipal(identity.id);
  }

  return {
    account: toPublicTeamAccount(account),
    org_slug: org.slug,
    tier: isOwner ? 'ceo' : 'team',
    access_grant,
    ceo_grant: isOwner ? createCeoGrant() : null,
    display_name: account.display_name,
    identity: userIdentity.toClientIdentity(identity),
    team_role: account.role || null,
    is_owner: isOwner,
  };
}

async function createTeam({ teamName, username, email, password, displayName } = {}) {
  const name = String(teamName || '').trim().slice(0, 120);
  const user = String(username || displayName || '').trim().slice(0, 64);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!name || !user || !normalizedEmail || !pass) {
    throw new TeamAuthError('team name, username, email, and password required', 'BAD_INPUT');
  }
  try {
    assertPasswordMinLength(pass);
  } catch (err) {
    throw new TeamAuthError(err.message, err.code || 'BAD_INPUT');
  }

  let slug = slugifyTeamName(name);
  for (let i = 0; i < 6; i += 1) {
    const taken = await denizenVisitor.resolveOrgBySlug(slug).catch(() => null);
    if (!taken) break;
    slug = `${slugifyTeamName(name)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const teamCode = generateTeamCode();
  const orgRows = await denizenDb._post(
    'denizen_organizations',
    {
      slug,
      display_name: name,
      plan: 'team',
      settings: { tier: 'team', team_code: teamCode },
    },
    { prefer: 'return=representation' },
  );
  const org = orgRows?.[0];
  if (!org?.id) throw new TeamAuthError('Could not create team', 'DENIED');

  const normalizedUsername = normalizeUsername(user);
  const accountRows = await denizenDb._post(
    'denizen_team_accounts',
    {
      org_id: org.id,
      email: normalizedEmail,
      display_name: user,
      username: normalizedUsername,
      password_hash: hashPassword(pass),
      role: 'owner',
    },
    { prefer: 'return=representation' },
  );
  const account = accountRows?.[0];
  const bundle = await sessionBundle(account, org, 'team_create', 'team_create');
  return { ...bundle, team_code: teamCode, team_name: name };
}

async function joinTeamAccount({
  email,
  displayName,
  username,
  password,
  teamCode,
} = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const name = String(displayName || username || '').trim().slice(0, 200);
  const user = String(username || displayName || '').trim().slice(0, 64);
  const pass = String(password || '');
  const code = String(teamCode || '').trim();
  if (!normalizedEmail || !name || !pass || !code) {
    throw new TeamAuthError('email, username, password, and team code required', 'BAD_INPUT');
  }
  try {
    assertPasswordMinLength(pass);
  } catch (err) {
    throw new TeamAuthError(err.message, err.code || 'BAD_INPUT');
  }

  const org = await resolveOrgByTeamCode(code);
  if (!org) throw new TeamAuthError('Invalid team code', 'DENIED');

  const existing = await findTeamAccount({ orgId: org.id, email: normalizedEmail, username: user });
  if (existing) {
    throw new TeamAuthError('Account already exists — use login', 'DENIED');
  }

  const role = await resolveTeamMemberRole(normalizedEmail, org.id);
  const rows = await denizenDb._post(
    'denizen_team_accounts',
    {
      org_id: org.id,
      email: normalizedEmail,
      display_name: name,
      username: normalizeUsername(user),
      password_hash: hashPassword(pass),
      role,
    },
    { prefer: 'return=representation' },
  );
  const account = rows?.[0];
  return sessionBundle(account, org, 'website_register', 'website_register');
}

async function registerTeamAccount({ email, displayName, username, password, teamCode } = {}) {
  if (password) {
    return joinTeamAccount({
      email,
      displayName,
      username: username || displayName,
      password,
      teamCode,
    });
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim().slice(0, 200);
  if (!normalizedEmail || !name) {
    throw new TeamAuthError('email and display_name required', 'BAD_INPUT');
  }
  const org = await resolveOrgByTeamCode(teamCode);
  if (!org) throw new TeamAuthError('Invalid team code', 'DENIED');

  const existing = await findTeamAccount({ orgId: org.id, email: normalizedEmail });
  if (existing) {
    throw new TeamAuthError('Email already registered — use login', 'DENIED');
  }

  const role = await resolveTeamMemberRole(normalizedEmail, org.id);
  const rows = await denizenDb._post(
    'denizen_team_accounts',
    {
      org_id: org.id,
      email: normalizedEmail,
      display_name: name,
      username: normalizeUsername(name),
      role,
    },
    { prefer: 'return=representation' },
  );
  return sessionBundle(rows?.[0], org, 'website_register', 'website_register');
}

async function loginTeamAccount({
  email,
  username,
  password,
  teamCode,
} = {}) {
  let normalizedEmail = String(email || '').trim().toLowerCase();
  let user = String(username || '').trim();
  // People often paste their work email into the username field.
  if (!normalizedEmail && looksLikeEmail(user)) {
    normalizedEmail = user.toLowerCase();
    user = '';
  }
  const pass = String(password || '');
  const code = String(teamCode || '').trim();

  if (!user && !normalizedEmail) {
    throw new TeamAuthError('username or email required', 'BAD_INPUT');
  }
  if (!code && !normalizedEmail) {
    throw new TeamAuthError('team code or email required', 'BAD_INPUT');
  }

  let org = null;
  if (code) {
    org = await resolveOrgByTeamCode(code);
    if (!org) throw new TeamAuthError('Invalid team code', 'DENIED');
  } else {
    const matches = await findTeamAccountByEmail(normalizedEmail);
    if (!matches.length) {
      throw new TeamAuthError(
        'No team account for that email — use Join a team with your invite code, or Create a team',
        'NOT_FOUND',
      );
    }
    if (matches.length > 1) {
      throw new TeamAuthError('Multiple teams use this email — enter your team code', 'BAD_INPUT');
    }
    org = await denizenDb._get(
      `denizen_organizations?select=id,slug,display_name,settings&id=eq.${encodeURIComponent(matches[0].org_id)}&limit=1`,
    ).then((rows) => rows?.[0] || null);
    if (!org) throw new TeamAuthError('Team not found', 'NOT_FOUND');
  }

  let account = await findTeamAccount({ orgId: org.id, email: normalizedEmail, username: user });

  // Never mint accounts during login — wrong password + team code + email used to
  // silently create a new member row. Joining must go through Join a team.
  if (!account) {
    throw new TeamAuthError(
      'Account not found — use Join a team with your team code (username + email + password), or Create a team if you are starting fresh',
      'NOT_FOUND',
    );
  }

  assertPassword(account, pass);
  account = await ensureOwnerRoleIfConfigured(account, org.id);
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${encodeURIComponent(account.id)}`,
    { last_login_at: new Date().toISOString() },
    { prefer: 'return=minimal' },
  );

  return sessionBundle(account, org, 'website_login', 'website_login');
}

const APPROVER_ROLES = new Set(['owner', 'admin']);

function roleCanApproveSkills(role) {
  return APPROVER_ROLES.has(String(role || '').toLowerCase());
}

async function getTeamAccountForSession(sessionId) {
  if (!sessionId || !denizenDb.enabled) return null;
  const bySession = await denizenDb._get(
    `denizen_team_accounts?select=*&visitor_session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
  ).catch(() => []);
  if (bySession?.[0]) return bySession[0];

  const sessionRows = await denizenDb._get(
    `denizen_visitor_sessions?select=metadata,org_id&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
  ).catch(() => []);
  const session = sessionRows?.[0];
  const email = session?.metadata?.email;
  const orgId = session?.org_id;
  if (!email || !orgId) return null;

  const byEmail = await denizenDb._get(
    `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(String(email).trim().toLowerCase())}&limit=1`,
  ).catch(() => []);
  return byEmail?.[0] || null;
}

async function resolveCeoPrincipalForSession(sessionId, { session = null, access = null } = {}) {
  const resolvedSession = session || access?.session || null;
  const meta = resolvedSession?.metadata && typeof resolvedSession.metadata === 'object'
    ? resolvedSession.metadata
    : {};
  const sessionTier = String(access?.tier || meta.tier || '').toLowerCase();
  const accessMethod = String(meta.access_method || '').toLowerCase();
  if (
    sessionTier === 'demo'
    || accessMethod === 'demo'
    || accessMethod === 'demo_login'
  ) {
    return { ceo: false, tier: 'demo', source: null };
  }

  if (
    meta.is_ceo_principal === true
    || meta.access_method === 'ceo'
    || meta.access_method === 'owner_login'
    || meta.access_method === 'ceo_code'
    || access?.tier === 'ceo'
    || meta.tier === 'ceo'
  ) {
    return { ceo: true, tier: 'ceo', source: 'session' };
  }

  const account = await getTeamAccountForSession(sessionId);
  if (isTeamOwnerAccount(account)) {
    return { ceo: true, tier: 'ceo', source: 'team_owner', email: account.email || null };
  }

  try {
    const userIdentity = require('./denizen-user-identity');
    const identity = await userIdentity.getIdentityBySession(sessionId);
    const idMeta = identity?.metadata && typeof identity.metadata === 'object'
      ? identity.metadata
      : {};
    if (
      identity?.tier === 'ceo'
      || idMeta.is_ceo_principal === true
      || isConfiguredOwnerEmail(identity?.email_normalized || identity?.email)
    ) {
      return {
        ceo: true,
        tier: 'ceo',
        source: 'identity',
        email: identity?.email_normalized || identity?.email || null,
      };
    }
  } catch (_) {}

  return {
    ceo: false,
    tier: access?.tier || meta.tier || 'team',
    source: null,
  };
}

async function maybeUpgradeSessionCeoPrincipal(sessionId, session = null) {
  if (!sessionId || !denizenDb.enabled) return null;
  const existing = session || await denizenVisitor.getSession(sessionId).catch(() => null);
  if (!existing?.id) return null;

  const principal = await resolveCeoPrincipalForSession(sessionId, { session: existing });
  if (!principal.ceo || existing.metadata?.is_ceo_principal) return principal;
  const meta = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
  const sessionTier = String(meta.tier || '').toLowerCase();
  const accessMethod = String(meta.access_method || '').toLowerCase();
  if (sessionTier === 'demo' || accessMethod === 'demo' || accessMethod === 'demo_login') {
    return principal;
  }

  const metadata = {
    ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    is_ceo_principal: true,
    tier: 'ceo',
    access_method: 'ceo',
  };
  await denizenVisitor.createOrUpdateSession({
    sessionId,
    metadata,
  }).catch(() => null);

  return principal;
}

async function canApproveSkillsForSession(sessionId, { isCeoPrincipal = false } = {}) {
  if (isCeoPrincipal) return { allowed: true, role: 'ceo' };
  const principal = await resolveCeoPrincipalForSession(sessionId);
  if (principal.ceo) return { allowed: true, role: 'ceo' };
  const account = await getTeamAccountForSession(sessionId);
  if (!account) return { allowed: false, role: null };
  return {
    allowed: roleCanApproveSkills(account.role),
    role: account.role,
    account_id: account.id,
  };
}

async function linkAccountToSession(email, sessionId, displayName) {
  if (!email || !sessionId) return;
  const normalizedEmail = String(email).trim().toLowerCase();
  const sessionRows = await denizenDb._get(
    `denizen_visitor_sessions?select=org_id&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
  ).catch(() => []);
  const orgId = sessionRows?.[0]?.org_id;
  const org = orgId
    ? await denizenDb._get(
      `denizen_organizations?select=id,slug&id=eq.${encodeURIComponent(orgId)}&limit=1`,
    ).then((rows) => rows?.[0] || null)
    : await resolveTeamOrg().catch(() => null);
  if (!org) return;

  await denizenDb._patch(
    `denizen_team_accounts?org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(normalizedEmail)}`,
    { visitor_session_id: sessionId },
    { prefer: 'return=minimal' },
  ).catch(() => {});

  const accountRows = await denizenDb._get(
    `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
  ).catch(() => []);
  const account = accountRows?.[0] || null;
  const isOwner = isTeamOwnerAccount(account);
  if (account) await ensureOwnerRoleIfConfigured(account, org.id);

  const identity = await userIdentity.resolveIdentityForSession({
    email: normalizedEmail,
    displayName,
    tier: isOwner ? 'ceo' : 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source: 'website_login',
    sessionId,
  }).catch(() => null);
  if (isOwner && identity?.id) {
    userIdentity.markCeoPrincipal(identity.id);
  }
  return identity;
}

module.exports = {
  TeamAuthError,
  teamAuthErrorStatus,
  generateTeamCode,
  resolveOrgByTeamCode,
  createTeam,
  joinTeamAccount,
  registerTeamAccount,
  loginTeamAccount,
  linkAccountToSession,
  getTeamAccountForSession,
  canApproveSkillsForSession,
  roleCanApproveSkills,
  configuredOwnerEmail,
  isConfiguredOwnerEmail,
  isTeamOwnerAccount,
  resolveCeoPrincipalForSession,
  maybeUpgradeSessionCeoPrincipal,
  resolveTeamMemberRole,
  orgHasSkillApprover,
  APPROVER_ROLES,
  looksLikeEmail,
  normalizeUsername,
  findTeamAccount,
};
