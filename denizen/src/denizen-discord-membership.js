'use strict';

/**
 * Transport to the discord-bot sidecar's /membership route — answers "which
 * guilds does this Discord user have a tracked member row in." Bot sidecar
 * has no DB/org knowledge; team-code/org policy stays in denizen-map-access.js.
 * Fails closed: any network/bot-unreachable error yields no membership.
 */

const CACHE_TTL_MS = 12_000;
const FETCH_TIMEOUT_MS = 3000;

/** discordUserId → { guildIds: Set<string>, fetchedAt: number } */
const cache = new Map();

function botPort() {
  return Number(process.env.DISCORD_PRESENCE_PORT) || 5180;
}

async function fetchMemberGuildIds(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (!id) return new Set();
  try {
    const res = await fetch(
      `http://127.0.0.1:${botPort()}/membership?userId=${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return new Set();
    const data = await res.json();
    const ids = Array.isArray(data?.guildIds) ? data.guildIds : [];
    return new Set(ids.map(String));
  } catch (_) {
    // Bot unreachable/slow — fail closed, never silently grant access.
    return new Set();
  }
}

async function getMemberGuildIds(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (!id) return new Set();
  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.guildIds;

  const guildIds = await fetchMemberGuildIds(id);
  cache.set(id, { guildIds, fetchedAt: now });
  return guildIds;
}

async function isMemberOfGuild(discordUserId, guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return false;
  const ids = await getMemberGuildIds(discordUserId);
  return ids.has(gid);
}

function invalidate(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (id) cache.delete(id);
  else cache.clear();
}

module.exports = {
  getMemberGuildIds,
  isMemberOfGuild,
  invalidate,
};
