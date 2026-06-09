'use strict';

const denizenDb = require('./denizen-db.js');
const promptTuning = require('./prompt-tuning.js');
const { createAccessGrant } = require('./visitor-session-auth.js');
const { verifyAccessCode } = require('./visitor-access.js');
const userIdentity = require('./denizen-user-identity.js');

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

async function resolveTeamOrg() {
  const org = await denizenDb._get(
    `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(promptTuning.teamOrgSlug)}&limit=1`,
  );
  if (!org?.[0]) throw new TeamAuthError('Team org not configured', 'NOT_FOUND');
  return org[0];
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

/** First registrant or DENIZEN_TEAM_OWNER_EMAIL becomes owner; everyone else member. */
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

async function registerTeamAccount({ email, displayName, teamCode } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim().slice(0, 200);
  if (!normalizedEmail || !name) {
    throw new TeamAuthError('email and display_name required', 'BAD_INPUT');
  }
  const codeCheck = verifyAccessCode(teamCode, 'team');
  if (!codeCheck.ok) throw new TeamAuthError(codeCheck.error || 'Invalid team code', 'DENIED');

  const org = await resolveTeamOrg();
  const existing = await denizenDb._get(
    `denizen_team_accounts?select=id,email&org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
  );
  if (existing?.length) {
    throw new TeamAuthError('Email already registered — use login', 'DENIED');
  }

  const role = await resolveTeamMemberRole(normalizedEmail, org.id);
  const rows = await denizenDb._post(
    'denizen_team_accounts',
    {
      org_id: org.id,
      email: normalizedEmail,
      display_name: name,
      role,
    },
    { prefer: 'return=representation' },
  );

  const account = rows?.[0];
  const access_grant = createAccessGrant({
    tier: 'team',
    orgSlug: org.slug,
    accessMethod: 'website_register',
    email: normalizedEmail,
  });

  const identity = await userIdentity.upsertIdentity({
    email: normalizedEmail,
    displayName: name,
    tier: 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source: 'website_register',
    teamAccountId: account?.id,
  });

  return {
    account,
    org_slug: org.slug,
    tier: 'team',
    access_grant,
    identity: userIdentity.toClientIdentity(identity),
    display_name: account?.display_name || name,
  };
}

async function loginTeamAccount({ email, teamCode } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new TeamAuthError('email required', 'BAD_INPUT');

  const org = await resolveTeamOrg();
  let rows = await denizenDb._get(
    `denizen_team_accounts?select=*&org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`,
  );

  if (!rows?.length) {
    if (teamCode) {
      const codeCheck = verifyAccessCode(teamCode, 'team');
      if (!codeCheck.ok) throw new TeamAuthError(codeCheck.error || 'Invalid team code', 'DENIED');
      const role = await resolveTeamMemberRole(normalizedEmail, org.id);
      rows = await denizenDb._post(
        'denizen_team_accounts',
        {
          org_id: org.id,
          email: normalizedEmail,
          display_name: normalizedEmail.split('@')[0],
          role,
        },
        { prefer: 'return=representation' },
      );
    } else {
      throw new TeamAuthError('Account not found — register with team code first', 'NOT_FOUND');
    }
  }

  let account = rows[0];
  account = await ensureOwnerRoleIfConfigured(account, org.id);
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${encodeURIComponent(account.id)}`,
    { last_login_at: new Date().toISOString() },
    { prefer: 'return=minimal' },
  );

  const access_grant = createAccessGrant({
    tier: 'team',
    orgSlug: org.slug,
    accessMethod: 'website_login',
    email: normalizedEmail,
  });

  const identity = await userIdentity.upsertIdentity({
    email: normalizedEmail,
    displayName: account.display_name,
    tier: 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source: 'website_login',
    teamAccountId: account.id,
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
  const org = await resolveTeamOrg().catch(() => null);
  if (!org) return;
  await denizenDb._patch(
    `denizen_team_accounts?org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(normalizedEmail)}`,
    { visitor_session_id: sessionId },
    { prefer: 'return=minimal' },
  ).catch(() => {});
  const identity = await userIdentity.resolveIdentityForSession({
    email: normalizedEmail,
    displayName,
    tier: 'team',
    orgId: org.id,
    orgSlug: org.slug,
    source: 'website_login',
    sessionId,
  }).catch(() => null);
  return identity;
}

module.exports = {
  TeamAuthError,
  teamAuthErrorStatus,
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
