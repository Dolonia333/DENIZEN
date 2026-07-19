'use strict';

/**
 * Authorize Discord Spaces map presence for a guild.
 * Linked guilds require a map_grant (team code) or a matching team session.
 */

const guildOrg = require('./denizen-guild-org.js');
const teamAuth = require('./denizen-team-auth.js');
const inviteLinks = require('./denizen-team-invite-links.js');
const sessionAuth = require('./visitor-session-auth.js');
const denizenVisitor = require('./denizen-visitor.js');

function extractMapGrant(req, body = {}) {
  const header = req?.headers?.['x-map-grant'] || req?.headers?.['x-denizen-map-grant'];
  const fromBody = body.map_grant || body.mapGrant;
  let fromQuery = null;
  try {
    const raw = req?.url || '';
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    fromQuery = new URLSearchParams(q).get('map_grant');
  } catch (_) { /* ignore */ }
  return String(header || fromBody || fromQuery || '').trim() || null;
}

function extractGuildId(req, body = {}) {
  if (body.guildId || body.guild_id) {
    return String(body.guildId || body.guild_id).trim();
  }
  try {
    const raw = req?.url || '';
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    return String(new URLSearchParams(q).get('guildId') || '').trim();
  } catch (_) {
    return '';
  }
}

async function sessionMatchesOrg(sessionId, orgId) {
  if (!sessionId || !orgId) return false;
  try {
    const session = await denizenVisitor.getSession(sessionId);
    return !!(session?.org_id && String(session.org_id) === String(orgId));
  } catch (_) {
    return false;
  }
}

/**
 * @returns {Promise<{ ok: true, reason: string, org?: object } | { ok: false, status: number, error: string, code: string, message?: string }>}
 */
async function assertMapAccess(req, { guildId = null, body = {} } = {}) {
  const gid = String(guildId || extractGuildId(req, body) || '').trim();

  // No guild scoped request — allow (guild list / default probe).
  if (!gid) return { ok: true, reason: 'no_guild' };

  // No DB → open (local demos / unit hosts without Supabase).
  if (!guildOrg.dbReady()) return { ok: true, reason: 'db_open' };

  const status = await guildOrg.getAccessStatus(gid);
  // Unlinked guilds stay open until the owner opts in with `,teamlink`.
  if (!status.linked || !status.gated) {
    return { ok: true, reason: status.linked ? 'ungated' : 'not_linked' };
  }

  const grantTok = extractMapGrant(req, body);
  if (grantTok) {
    const payload = sessionAuth.verifyMapGrant(grantTok);
    if (payload && String(payload.guild_id) === gid) {
      return {
        ok: true,
        reason: 'map_grant',
        org_id: payload.org_id || status.org_id,
        org_slug: payload.org_slug || status.org_slug,
      };
    }
  }

  const sessionId = String(
    body.session_id
    || body.sessionId
    || req?.headers?.['x-session-id']
    || '',
  ).trim();
  if (sessionId && status.org_id && await sessionMatchesOrg(sessionId, status.org_id)) {
    return { ok: true, reason: 'team_session', org_id: status.org_id };
  }

  return {
    ok: false,
    status: 403,
    error: 'team_code_required',
    code: 'TEAM_CODE_REQUIRED',
    message: status.message || 'Enter the team code to open this server’s map.',
    guild_id: gid,
    org_display_name: status.org_display_name || null,
  };
}

/**
 * Unlock map for guild with team code → signed map_grant.
 */
async function unlockWithTeamCode(guildId, teamCode) {
  const gid = String(guildId || '').trim();
  const code = String(teamCode || '').trim();
  if (!gid) return { ok: false, error: 'guild_id_required', code: 'BAD_INPUT' };
  if (!code) return { ok: false, error: 'team_code_required', code: 'BAD_INPUT' };
  if (!guildOrg.dbReady()) {
    return { ok: false, error: 'database_unavailable', code: 'UNAVAILABLE' };
  }

  const status = await guildOrg.getAccessStatus(gid);
  if (status.setup_required || !status.linked) {
    return {
      ok: false,
      error: 'setup_required',
      code: 'SETUP_REQUIRED',
      message: status.message,
    };
  }

  const org = await teamAuth.resolveOrgByTeamCode(code);
  if (!org?.id || String(org.id) !== String(status.org_id)) {
    return { ok: false, error: 'invalid_team_code', code: 'DENIED' };
  }

  // Also accept matching code resolved from org settings (normalize).
  const expected = await inviteLinks.resolveTeamCodeForOrg(org);
  if (expected && String(expected).trim() !== code) {
    // resolveOrgByTeamCode already matched — keep going
  }

  const mapGrant = sessionAuth.createMapGrant({
    guildId: gid,
    orgId: org.id,
    orgSlug: org.slug || null,
    accessMethod: 'team_code',
  });

  return {
    ok: true,
    guild_id: gid,
    org_id: org.id,
    org_slug: org.slug || null,
    org_display_name: org.display_name || org.slug || null,
    map_grant: mapGrant,
    expires_in_ms: sessionAuth.MAP_GRANT_TTL_MS,
  };
}

module.exports = {
  extractMapGrant,
  extractGuildId,
  assertMapAccess,
  unlockWithTeamCode,
};
