'use strict';

/**
 * Server-side demo vs team access enforcement for visitor sessions.
 */

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');
const promptTuning = require('./prompt-tuning.js');
const sessionAuth = require('./visitor-session-auth.js');

const DEMO_RESTRICTED_FEATURES = new Set([
  'to_ceo',
  'slack_link',
  'profile_slack',
  'research_external',
  'recurring_tasks_post',
  'bridge_skill',
  'briefing',
  'mcp_connect',
]);

class VisitorAccessError extends Error {
  constructor(message, code, feature = null) {
    super(message);
    this.name = 'VisitorAccessError';
    this.code = code;
    this.feature = feature;
  }
}

function visitorAccessErrorStatus(err) {
  if (!(err instanceof VisitorAccessError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'DEMO_RESTRICTED':
    case 'DENIED':
      return 403;
    default:
      return 500;
  }
}

async function _resolveOrg(orgId) {
  if (!orgId || !denizenDb.enabled) return null;
  const rows = await denizenDb._get(
    `denizen_organizations?select=id,slug,display_name,plan,settings&id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
  return rows?.[0] || null;
}

function _tierFromOrg(org) {
  if (!org) return 'team';
  const settings = org.settings || {};
  if (settings.tier) return String(settings.tier);
  if (settings.demo === true) return 'demo';
  if (org.slug === promptTuning.demoOrgSlug) return 'demo';
  return 'team';
}

/**
 * Load session + org context and derive access tier flags.
 * @returns {Promise<{tier, orgSlug, orgId, isDemo, isTeam, isCeoBridge, session, org}>}
 */
async function resolveSessionAccess(sessionId) {
  if (!sessionId) {
    throw new VisitorAccessError('sessionId required', 'BAD_INPUT');
  }
  const session = await denizenVisitor.getSession(sessionId);
  if (!session) {
    throw new VisitorAccessError('Session not found', 'NOT_FOUND');
  }

  const org = await _resolveOrg(session.org_id);
  const meta = session.metadata || {};
  const tier = resolveTierFromOrgAndMeta(org, meta);
  const isDemo = tier === 'demo';
  const isCeoBridge = meta.bridge === 'ceo';

  return {
    tier,
    orgSlug: org?.slug || meta.org_slug || denizenDb.orgSlug || null,
    orgId: session.org_id || org?.id || null,
    isDemo,
    isTeam: !isDemo,
    isCeoBridge,
    session,
    org,
  };
}

function assertTeamFeature(access, feature) {
  if (!access?.isDemo) return;
  if (!DEMO_RESTRICTED_FEATURES.has(feature)) return;
  throw new VisitorAccessError(
    `${feature} requires team access`,
    'DEMO_RESTRICTED',
    feature,
  );
}

function verifyAccessCode(code, kind) {
  const result = promptTuning.verifyVisitorAccessCode(code, kind);
  if (result.ok && result.tier === 'team') {
    result.access_grant = sessionAuth.createAccessGrant({
      tier: 'team',
      orgSlug: result.org_slug || promptTuning.teamOrgSlug,
      accessMethod: 'team_code',
    });
  }
  if (result.ok && kind === 'ceo') {
    result.ceo_grant = sessionAuth.createCeoGrant();
    result.tier = 'team';
    result.org_slug = result.org_slug || promptTuning.teamOrgSlug;
    result.access_grant = sessionAuth.createAccessGrant({
      tier: 'team',
      orgSlug: result.org_slug,
      accessMethod: 'ceo_code',
    });
  }
  return result;
}

async function assertSessionToken(sessionId, token) {
  if (!sessionId) {
    throw new VisitorAccessError('session_id required', 'BAD_INPUT');
  }
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=session_token_hash&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
  );
  const stored = rows?.[0]?.session_token_hash;
  if (!stored) return;
  if (!sessionAuth.verifySessionToken(token, stored)) {
    throw new VisitorAccessError('Invalid session token', 'DENIED');
  }
}

function metadataFromAccessGrant(grantPayload) {
  if (!grantPayload) return null;
  return {
    tier: grantPayload.tier || 'team',
    org_slug: grantPayload.org_slug || promptTuning.teamOrgSlug,
    access_method: grantPayload.access_method || 'grant',
    email: grantPayload.email || null,
  };
}

function resolveTierFromOrgAndMeta(org, meta) {
  const orgTier = _tierFromOrg(org);
  const metaTier = meta?.tier ? String(meta.tier) : null;
  // Demo org always wins — sandbox sessions cannot be CEO even with stale metadata.
  if (orgTier === 'demo') return 'demo';
  if (meta?.is_ceo_principal === true || metaTier === 'ceo') return 'ceo';
  if (metaTier === 'demo' && orgTier !== 'demo') return orgTier;
  return metaTier || orgTier;
}

/**
 * Whether a visitor session may use run_skill / real PC-browser tools.
 * Demo tier is always false — even when DENIZEN_REAL_WORK_MODE=true globally.
 * Team (and CEO bridge) sessions may use real tools.
 */
function canUseRealWork(sessionMetadata, orgSettings) {
  const meta = sessionMetadata && typeof sessionMetadata === 'object' ? sessionMetadata : {};
  const org = orgSettings && typeof orgSettings === 'object' ? orgSettings : {};

  let tier = meta.tier ? String(meta.tier) : null;
  if (!tier) {
    if (org.tier) tier = String(org.tier);
    else if (org.demo === true) tier = 'demo';
    else tier = 'team';
  }

  if (tier === 'demo') return false;
  if (org.allow_real_work === false) return false;
  if (org.tier === 'demo' || org.demo === true) return false;

  return tier === 'team' || tier === 'ceo' || meta.bridge === 'ceo';
}

module.exports = {
  VisitorAccessError,
  visitorAccessErrorStatus,
  resolveSessionAccess,
  assertTeamFeature,
  assertSessionToken,
  verifyAccessCode,
  metadataFromAccessGrant,
  canUseRealWork,
  DEMO_RESTRICTED_FEATURES,
};
