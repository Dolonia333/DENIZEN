'use strict';

/**
 * Discord guild subscription entitlements — the single source of truth for
 * "is this guild allowed to use premium bot modules?".
 *
 * Backed by the public.denizen_guild_plans table (PostgREST / service role).
 * Reads are cached in-memory with a short TTL because the bot calls
 * isModuleAllowed() on every command dispatch; a DB blip must NOT downgrade a
 * paying guild, so a failed refresh keeps the last-known-good row.
 *
 * Interface (stable — Stripe wiring, gating, and endpoints all build on this):
 *   PREMIUM_MODULES : Set<string>            module names that require a plan
 *   PLAN_RANK       : { free, pro, ultra }   ordering for tier comparisons
 *   getGuildPlan(guildId)         → Promise<{ plan, status, active, ...row }>
 *   isModuleAllowed(guildId, mod) → Promise<boolean>
 *   isPremiumModule(mod)          → boolean
 *   setGuildPlanFromStripe(patch) → Promise<row|null>   (webhook writes here)
 *   invalidate(guildId)           → void
 */

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
);
const TABLE = 'denizen_guild_plans';
const CACHE_TTL_MS = 60_000;

// Module names (as registered via `module:` in each command) that require a
// paid plan. antinuke + antiraid both register under 'security'.
const PREMIUM_MODULES = new Set(['security', 'avatar', 'community']);
const PLAN_RANK = { free: 0, pro: 1, ultra: 2 };
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const FREE_PLAN = Object.freeze({ plan: 'free', status: 'active', active: false, free: true });

/** guildId → { row, fetchedAt } */
const cache = new Map();

function dbConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

const GRACE_STATUSES = new Set(['past_due', 'unpaid']);

function normalize(row) {
  if (!row) return { ...FREE_PLAN };
  const plan = PLAN_RANK[row.plan] != null ? row.plan : 'free';
  const status = String(row.status || 'active');
  let active = plan !== 'free' && ACTIVE_STATUSES.has(status);
  // Grace window: a paying guild that's past_due/unpaid keeps premium until its
  // already-paid period actually lapses, rather than being cut off instantly.
  if (!active && plan !== 'free' && GRACE_STATUSES.has(status) && row.current_period_end) {
    const end = Date.parse(row.current_period_end);
    if (Number.isFinite(end) && end > Date.now()) active = true;
  }
  return { ...row, plan, status, active, free: plan === 'free' };
}

async function fetchPlanRow(guildId) {
  if (!dbConfigured()) return null;
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?guild_id=eq.${encodeURIComponent(guildId)}&select=*&limit=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { headers: headers(), signal: ctrl.signal });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0] : { plan: 'free', status: 'active' };
  } catch (_) {
    return null; // caller keeps last-known-good
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a guild's plan. Cached; on refresh failure the previous cached row
 * is retained (paying guilds don't get downgraded by a transient DB error).
 */
async function getGuildPlan(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return { ...FREE_PLAN };

  const hit = cache.get(gid);
  const now = Date.now();
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return normalize(hit.row);

  const row = await fetchPlanRow(gid);
  if (row) {
    cache.set(gid, { row, fetchedAt: now });
    return normalize(row);
  }
  if (hit) {
    hit.fetchedAt = now - CACHE_TTL_MS + 10_000; // short retry window, keep value
    return normalize(hit.row);
  }
  // No cache, no DB → treat as free (fail-closed for premium access)
  return { ...FREE_PLAN };
}

/** Sync peek at cache (no fetch). Used by presence hot path. */
function peekGuildPlan(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return { ...FREE_PLAN };
  const hit = cache.get(gid);
  if (!hit) return null;
  return normalize(hit.row);
}

function isPremiumModule(moduleName) {
  return PREMIUM_MODULES.has(String(moduleName || '').toLowerCase());
}

/** Free modules always allowed; premium modules require an active paid plan. */
async function isModuleAllowed(guildId, moduleName) {
  if (!isPremiumModule(moduleName)) return true;
  const plan = await getGuildPlan(guildId);
  return plan.active === true;
}

/**
 * Upsert a plan row from a Stripe subscription event. `patch` must include
 * guild_id; unknown/undefined fields are dropped. Returns the stored row.
 */
async function setGuildPlanFromStripe(patch = {}) {
  const guildId = String(patch.guild_id || patch.guildId || '').trim();
  if (!guildId) throw new Error('setGuildPlanFromStripe: guild_id required');
  if (!dbConfigured()) return null;

  const row = { guild_id: guildId, updated_at: new Date().toISOString() };
  for (const k of ['plan', 'status', 'stripe_customer_id', 'stripe_subscription_id',
    'price_id', 'current_period_end', 'linked_user_id', 'metadata']) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }

  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=guild_id`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error(`[guild-plans] upsert failed for ${guildId}: HTTP ${res.status}`);
      return null;
    }
    const out = await res.json().catch(() => []);
    const stored = Array.isArray(out) && out.length ? out[0] : row;
    cache.set(guildId, { row: stored, fetchedAt: Date.now() });
    return stored;
  } catch (err) {
    console.error(`[guild-plans] upsert error for ${guildId}: ${err?.message || err}`);
    return null;
  }
}

function invalidate(guildId) {
  cache.delete(String(guildId || '').trim());
}

/**
 * Find a guild_id by its Stripe subscription id (indexed). Used by webhook
 * handlers as a fallback when the event carries no guild_id metadata, so a
 * cancellation/update can't silently no-op and leave a guild entitled.
 */
async function findGuildBySubscription(subscriptionId) {
  const sub = String(subscriptionId || '').trim();
  if (!sub || !dbConfigured()) return null;
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?stripe_subscription_id=eq.${encodeURIComponent(sub)}&select=guild_id&limit=1`;
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0].guild_id : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  PREMIUM_MODULES,
  PLAN_RANK,
  FREE_PLAN,
  dbConfigured,
  getGuildPlan,
  peekGuildPlan,
  isModuleAllowed,
  isPremiumModule,
  setGuildPlanFromStripe,
  findGuildBySubscription,
  invalidate,
};
