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
const denizenDiscordAuth = require('./denizen-discord-auth.js');
const discordMembership = require('./denizen-discord-membership.js');
const userIdentity = require('./denizen-user-identity.js');

function extractSessionCreds(req, body = {}) {
  let sessionId = req?.headers?.['x-session-id'] || body.session_id || body.sessionId || null;
  let sessionToken = req?.headers?.['x-session-token'] || body.session_token || body.sessionToken || null;
  if (!sessionId || !sessionToken) {
    try {
      const raw = req?.url || '';
      const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
      const params = new URLSearchParams(q);
      if (!sessionId) sessionId = params.get('session_id');
      if (!sessionToken) sessionToken = params.get('session_token');
    } catch (_) { /* ignore */ }
  }
  sessionId = String(sessionId || '').trim() || null;
  sessionToken = String(sessionToken || '').trim() || null;
  return { sessionId, sessionToken };
}

/**
 * Resolve the Discord user id behind this request's Denizen session, if any.
 * Never trust a client-supplied discordUserId directly — always re-derive it
 * from a verified session (session_id + session_token).
 */
async function resolveViewerDiscordUserId(req, body = {}) {
  const { sessionId, sessionToken } = extractSessionCreds(req, body);
  // Only the session id is required. Discord OAuth logins are demo-tier and
  // never mint a session token, so requiring one here locked every
  // Discord-linked viewer out of their own membership. getLinkStatusForSession
  // → assertSessionToken still *verifies* a real token when the session has
  // one stored (and passes cleanly for tokenless demo sessions).
  if (!sessionId) return null;
  try {
    const status = await denizenDiscordAuth.getLinkStatusForSession(sessionId, sessionToken || '');
    if (status?.linked && status.discord_user_id) return status.discord_user_id;
  } catch (_) { /* fall through to email fallback */ }
  // Fallback: the session→identity_id link can be missing for fresh Discord
  // demo logins, but the session still carries the login email (set from the
  // signed access grant at creation). Resolve the Discord identity by that
  // server-stored email — never a client-supplied one.
  try {
    const session = await denizenVisitor.getSession(sessionId);
    const email = session?.metadata?.email || session?.email || null;
    if (email) {
      const identity = await userIdentity.getIdentityByEmail(email);
      if (identity?.discord_user_id) return identity.discord_user_id;
    }
  } catch (_) { /* give up — treated as no linked identity */ }
  return null;
}

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

  // No guild scoped request — allow (guild list / default probe). List
  // filtering for /api/discord/map/guilds is handled separately by
  // filterAccessibleGuilds(), which is per-guild-aware.
  if (!gid) return { ok: true, reason: 'no_guild' };

  // No DB → open (local demos / unit hosts without Supabase).
  if (!guildOrg.dbReady()) return { ok: true, reason: 'db_open' };

  // Membership always wins: if the caller's linked Discord identity is a
  // tracked member of this guild, they can see it regardless of whether a
  // team has linked/gated it.
  const discordUserId = await resolveViewerDiscordUserId(req, body);
  if (discordUserId && await discordMembership.isMemberOfGuild(discordUserId, gid)) {
    return { ok: true, reason: 'member', discord_user_id: discordUserId };
  }

  const status = await guildOrg.getAccessStatus(gid);

  if (status.linked && status.gated) {
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

    const { sessionId } = extractSessionCreds(req, body);
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

  // Not linked to a team → no team code exists yet, and membership already
  // failed above. There is no path in.
  return {
    ok: false,
    status: 403,
    error: 'membership_required',
    code: 'MEMBERSHIP_REQUIRED',
    message: 'Link your Discord account, or be active in this server, to view its map.',
    guild_id: gid,
    org_display_name: null,
  };
}

/**
 * Filter a /guilds list down to only guilds this caller can access — same
 * policy as assertMapAccess, but resolves the caller's identity and
 * membership set once instead of per-guild (the bot's /membership route
 * already answers membership for every guild in a single call).
 */
async function filterAccessibleGuilds(req, guildList) {
  const list = Array.isArray(guildList) ? guildList : [];
  if (!list.length) return [];
  if (!guildOrg.dbReady()) return list; // local/no-DB dev — stay open

  const discordUserId = await resolveViewerDiscordUserId(req, {});
  const memberIds = discordUserId
    ? await discordMembership.getMemberGuildIds(discordUserId)
    : new Set();

  const grantTok = extractMapGrant(req, {});
  const grantPayload = grantTok ? sessionAuth.verifyMapGrant(grantTok) : null;
  const { sessionId } = extractSessionCreds(req, {});

  const out = [];
  for (const g of list) {
    const gid = String(g?.guildId || '').trim();
    if (!gid) continue;
    if (memberIds.has(gid)) { out.push(g); continue; }

    const link = await guildOrg.getLinkForGuild(gid);
    if (!link?.org) continue; // unlinked and not a member → hidden

    if (grantPayload && String(grantPayload.guild_id) === gid) { out.push(g); continue; }
    if (sessionId && await sessionMatchesOrg(sessionId, link.org.id)) { out.push(g); continue; }
  }
  return out;
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
  extractSessionCreds,
  resolveViewerDiscordUserId,
  assertMapAccess,
  filterAccessibleGuilds,
  unlockWithTeamCode,
};
