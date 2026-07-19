'use strict';

/**
 * Discord guild ↔ Denizen org binding for Spaces map team-code gating.
 */

const denizenDb = require('./denizen-db.js');
const teamAuth = require('./denizen-team-auth.js');
const inviteLinks = require('./denizen-team-invite-links.js');

const TABLE = 'denizen_discord_guild_orgs';
const CACHE_TTL_MS = 30_000;

/** guildId → { row, org, fetchedAt } | { missing: true, fetchedAt } */
const cache = new Map();

function dbReady() {
  return !!(denizenDb?.enabled && denizenDb?.url);
}

function invalidate(guildId) {
  const gid = String(guildId || '').trim();
  if (gid) cache.delete(gid);
  else cache.clear();
}

async function fetchLink(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid || !dbReady()) return null;
  const rows = await denizenDb._get(
    `${TABLE}?select=guild_id,org_id,created_by_discord_user_id,created_at,updated_at`
    + `&guild_id=eq.${encodeURIComponent(gid)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function fetchOrg(orgId) {
  if (!orgId || !dbReady()) return null;
  const rows = await denizenDb._get(
    `denizen_organizations?select=id,slug,display_name,settings`
    + `&id=eq.${encodeURIComponent(orgId)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

async function getLinkForGuild(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return null;
  const now = Date.now();
  const hit = cache.get(gid);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    if (hit.missing) return null;
    return { row: hit.row, org: hit.org };
  }
  if (!dbReady()) return null;

  const row = await fetchLink(gid);
  if (!row) {
    cache.set(gid, { missing: true, fetchedAt: now });
    return null;
  }
  const org = await fetchOrg(row.org_id);
  cache.set(gid, { row, org, fetchedAt: now });
  return { row, org };
}

async function getOrgForGuild(guildId) {
  const link = await getLinkForGuild(guildId);
  return link?.org || null;
}

async function getTeamCodeForGuild(guildId) {
  const org = await getOrgForGuild(guildId);
  if (!org) return null;
  return inviteLinks.resolveTeamCodeForOrg(org);
}

/**
 * Resolve org by team code and upsert guild binding.
 */
async function linkGuild(guildId, teamCode, { createdByDiscordUserId = null } = {}) {
  const gid = String(guildId || '').trim();
  const code = String(teamCode || '').trim();
  if (!gid) return { ok: false, error: 'guild_id_required', code: 'BAD_INPUT' };
  if (!code) return { ok: false, error: 'team_code_required', code: 'BAD_INPUT' };
  if (!dbReady()) return { ok: false, error: 'database_unavailable', code: 'UNAVAILABLE' };

  const org = await teamAuth.resolveOrgByTeamCode(code);
  if (!org?.id) return { ok: false, error: 'invalid_team_code', code: 'DENIED' };

  const now = new Date().toISOString();
  const row = {
    guild_id: gid,
    org_id: org.id,
    created_by_discord_user_id: createdByDiscordUserId
      ? String(createdByDiscordUserId).trim()
      : null,
    updated_at: now,
  };

  // Upsert via Prefer resolution=merge-duplicates
  const headers = denizenDb._headers({
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  const res = await fetch(`${denizenDb.url}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      error: `link_failed_${res.status}`,
      detail: text.slice(0, 160),
      code: 'ERROR',
    };
  }

  invalidate(gid);
  const teamCodeOut = await inviteLinks.resolveTeamCodeForOrg(org);
  return {
    ok: true,
    guild_id: gid,
    org_id: org.id,
    org_slug: org.slug || null,
    org_display_name: org.display_name || org.slug || null,
    team_code: teamCodeOut,
  };
}

async function unlinkGuild(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid || !dbReady()) return { ok: false, error: 'bad_input' };
  await denizenDb._delete(
    `${TABLE}?guild_id=eq.${encodeURIComponent(gid)}`,
  ).catch(() => null);
  invalidate(gid);
  return { ok: true, guild_id: gid };
}

/**
 * Public status for map shell (never leaks the team code).
 */
async function getAccessStatus(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) {
    return { ok: true, guild_id: null, linked: false, gated: false, setup_required: false };
  }
  if (!dbReady()) {
    // Local / no-DB: leave maps open so demos keep working.
    return {
      ok: true,
      guild_id: gid,
      linked: false,
      gated: false,
      setup_required: false,
      db: false,
    };
  }
  const link = await getLinkForGuild(gid);
  if (!link?.org) {
    return {
      ok: true,
      guild_id: gid,
      linked: false,
      gated: true,
      setup_required: true,
      message: 'Ask the server owner to link this Discord with `,teamlink <team code>`.',
    };
  }
  return {
    ok: true,
    guild_id: gid,
    linked: true,
    gated: true,
    setup_required: false,
    org_slug: link.org.slug || null,
    org_display_name: link.org.display_name || link.org.slug || null,
    org_id: link.org.id,
    message: 'Enter this team’s Denizen team code to open the map.',
  };
}

module.exports = {
  dbReady,
  invalidate,
  getLinkForGuild,
  getOrgForGuild,
  getTeamCodeForGuild,
  linkGuild,
  unlinkGuild,
  getAccessStatus,
  TABLE,
};
