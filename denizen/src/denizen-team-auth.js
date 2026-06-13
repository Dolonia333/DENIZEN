'use strict';

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');
const promptTuning = require('./prompt-tuning.js');
const { createAccessGrant } = require('./visitor-session-auth.js');
const { verifyAccessCode } = require('./visitor-access.js');
const userIdentity = require('./denizen-user-identity.js');
const { hashPassword, verifyPassword, assertPasswordMinLength } = require('./denizen-team-password.js');

class TeamAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TeamAuthError';
    this.code = code;
  }
}

function teamAuthErrorStatus(err) {
  if (!(err instanceof TeamAuthError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT': return 400;
    case 'NOT_FOUND': return 404;
    case 'DENIED': return 403;
    default: return 500;
  }
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
  if (normalizedUsername) {
    const byUser = await denizenDb._get(
      `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(orgId)}&username=eq.${encodeURIComponent(normalizedUsername)}&limit=1`,
    );
    if (byUser?.[0]) return byUser[0];
  }
  if (normalizedEmail) {
    const byEmail = await denizenDb._get(
      `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
    );
    if (byEmail?.[0]) return byEmail[0];
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

async function sessionBundle(account, org, accessMethod, source) {
  const access_grant = createAccessGrant({
    tier: 'team',
    orgSlug: org.slug,
    accessMethod,
    email: account.email,
  });

  const identity = await userIdentity.upsertIdentity({
    email: account.email,
    displayName: account.display_name,
    tier: 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source,
    teamAccountId: account.id,
    updateDisplayName: accessMethod !== 'website_login',
  });

  return {
    account,
    org_slug: org.slug,
    tier: 'team',
    access_grant,
    display_name: account.display_name,
    identity: userIdentity.toClientIdentity(identity),
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
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = String(username || '').trim();
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
      throw new TeamAuthError('Account not found — join with a team code first', 'NOT_FOUND');
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

  if (!account && code && normalizedEmail) {
    const role = await resolveTeamMemberRole(normalizedEmail, org.id);
    const rows = await denizenDb._post(
      'denizen_team_accounts',
      {
        org_id: org.id,
        email: normalizedEmail,
        display_name: user || normalizedEmail.split('@')[0],
        username: normalizeUsername(user || normalizedEmail.split('@')[0]),
        password_hash: pass ? hashPassword(pass) : null,
        role,
      },
      { prefer: 'return=representation' },
    );
    account = rows?.[0];
  }

  if (!account) {
    throw new TeamAuthError('Account not found — join with your team code first', 'NOT_FOUND');
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

async function canApproveSkillsForSession(sessionId, { isCeoPrincipal = false } = {}) {
  if (isCeoPrincipal) return { allowed: true, role: 'ceo' };
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
  return userIdentity.resolveIdentityForSession({
    email: normalizedEmail,
    displayName,
    tier: 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source: 'website_login',
    sessionId,
  }).catch(() => null);
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
  resolveTeamMemberRole,
  orgHasSkillApprover,
  APPROVER_ROLES,
};
