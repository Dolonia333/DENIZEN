'use strict';

/**
 * Per-server companion pet entitlements.
 * Keyed by (guild_id, user_id). Sources: purchase | gift | pro_grant.
 * Pro/Ultra guilds get 3 concurrent pro_grant slots (metadata.pet_grants_remaining).
 */

const guildPlans = require('./denizen-guild-plans');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
);
const TABLE = 'denizen_guild_pet_entitlements';
const CACHE_TTL_MS = 30_000;
const PRO_GRANT_POOL = 3;

/** guildId → { map: Map<userId, row>, fetchedAt } */
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

function invalidate(guildId) {
  cache.delete(String(guildId || '').trim());
}

async function fetchGuildEntitlements(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return new Map();
  // No DB: leave memory cache alone (tests / local).
  if (!dbConfigured()) return null;
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?guild_id=eq.${encodeURIComponent(gid)}&select=*`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { headers: headers(), signal: ctrl.signal });
    if (!res.ok) return new Map();
    const rows = await res.json().catch(() => []);
    const map = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r?.user_id) map.set(String(r.user_id), r);
    }
    return map;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getGuildEntitlementMap(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return new Map();
  const hit = cache.get(gid);
  const now = Date.now();
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.map;

  if (!dbConfigured()) {
    if (!hit) cache.set(gid, { map: new Map(), fetchedAt: now });
    return cache.get(gid).map;
  }

  const map = await fetchGuildEntitlements(gid);
  if (map) {
    cache.set(gid, { map, fetchedAt: now });
    return map;
  }
  if (hit) {
    hit.fetchedAt = now - CACHE_TTL_MS + 5_000;
    return hit.map;
  }
  return new Map();
}

async function hasPetEntitlement(guildId, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const map = await getGuildEntitlementMap(guildId);
  return map.has(uid);
}

function peekPetEntitlement(guildId, userId) {
  const gid = String(guildId || '').trim();
  const uid = String(userId || '').trim();
  const hit = cache.get(gid);
  if (!hit || !uid) return false;
  return hit.map.has(uid);
}

function warmGuildPets(guildId) {
  getGuildEntitlementMap(guildId).catch(() => {});
}

async function listEntitlements(guildId) {
  const map = await getGuildEntitlementMap(guildId);
  return [...map.values()];
}

async function upsertEntitlement(row) {
  const guildId = String(row.guild_id || '').trim();
  const userId = String(row.user_id || '').trim();
  if (!guildId || !userId) throw new Error('guild_id and user_id required');
  if (!dbConfigured()) {
    const hit = cache.get(guildId) || { map: new Map(), fetchedAt: Date.now() };
    const stored = {
      ...row,
      guild_id: guildId,
      user_id: userId,
      updated_at: new Date().toISOString(),
      created_at: row.created_at || new Date().toISOString(),
    };
    hit.map.set(userId, stored);
    hit.fetchedAt = Date.now();
    cache.set(guildId, hit);
    return stored;
  }

  const body = {
    guild_id: guildId,
    user_id: userId,
    source: row.source,
    granted_by: row.granted_by ?? null,
    stripe_session_id: row.stripe_session_id ?? null,
    stripe_payment_intent: row.stripe_payment_intent ?? null,
    updated_at: new Date().toISOString(),
  };
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=guild_id,user_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[guild-pets] upsert failed ${guildId}/${userId}: HTTP ${res.status}`);
    return null;
  }
  const out = await res.json().catch(() => []);
  const stored = Array.isArray(out) && out.length ? out[0] : body;
  invalidate(guildId);
  await getGuildEntitlementMap(guildId);
  return stored;
}

async function deleteEntitlement(guildId, userId) {
  const gid = String(guildId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) return false;
  if (!dbConfigured()) {
    const hit = cache.get(gid);
    if (hit) hit.map.delete(uid);
    return true;
  }
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?guild_id=eq.${encodeURIComponent(gid)}&user_id=eq.${encodeURIComponent(uid)}`;
  const res = await fetch(url, { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) });
  invalidate(gid);
  return res.ok;
}

async function deleteProGrantsForGuild(guildId) {
  const gid = String(guildId || '').trim();
  if (!gid) return;
  if (!dbConfigured()) {
    const hit = cache.get(gid);
    if (hit) {
      for (const [uid, row] of [...hit.map.entries()]) {
        if (row.source === 'pro_grant') hit.map.delete(uid);
      }
    }
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?guild_id=eq.${encodeURIComponent(gid)}&source=eq.pro_grant`;
  await fetch(url, { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) }).catch(() => {});
  invalidate(gid);
}

function readGrantRemaining(planRow) {
  const meta = planRow?.metadata && typeof planRow.metadata === 'object' ? planRow.metadata : {};
  const n = Number(meta.pet_grants_remaining);
  if (Number.isFinite(n)) return Math.max(0, Math.min(PRO_GRANT_POOL, Math.floor(n)));
  return null;
}

async function writeGrantRemaining(guildId, remaining) {
  const plan = await guildPlans.getGuildPlan(guildId);
  const meta = { ...(plan.metadata && typeof plan.metadata === 'object' ? plan.metadata : {}) };
  meta.pet_grants_remaining = Math.max(0, Math.min(PRO_GRANT_POOL, Math.floor(remaining)));
  await guildPlans.setGuildPlanFromStripe({
    guild_id: String(guildId),
    metadata: meta,
  });
  return meta.pet_grants_remaining;
}

async function getGrantRemaining(guildId) {
  const plan = await guildPlans.getGuildPlan(guildId);
  if (!plan.active) return 0;
  const n = readGrantRemaining(plan);
  if (n != null) return n;
  const list = await listEntitlements(guildId);
  const used = list.filter((r) => r.source === 'pro_grant').length;
  const rem = Math.max(0, PRO_GRANT_POOL - used);
  await writeGrantRemaining(guildId, rem);
  return rem;
}

async function syncProGrantPool(guildId, planActive) {
  const gid = String(guildId || '').trim();
  if (!gid) return;
  if (!planActive) {
    await deleteProGrantsForGuild(gid);
    await writeGrantRemaining(gid, 0);
    return;
  }
  const plan = await guildPlans.getGuildPlan(gid);
  const existing = readGrantRemaining(plan);
  if (existing != null) return;
  const list = await listEntitlements(gid);
  const used = list.filter((r) => r.source === 'pro_grant').length;
  await writeGrantRemaining(gid, Math.max(0, PRO_GRANT_POOL - used));
}

async function grantFromPurchase({
  guildId,
  userId,
  stripeSessionId = null,
  stripePaymentIntent = null,
  grantedBy = null,
  source = 'purchase',
} = {}) {
  const gid = String(guildId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) return { ok: false, error: 'missing_ids' };
  if (await hasPetEntitlement(gid, uid)) {
    return { ok: true, already: true };
  }
  const stored = await upsertEntitlement({
    guild_id: gid,
    user_id: uid,
    source: source === 'gift' ? 'gift' : 'purchase',
    granted_by: grantedBy,
    stripe_session_id: stripeSessionId,
    stripe_payment_intent: stripePaymentIntent,
  });
  return stored ? { ok: true, row: stored } : { ok: false, error: 'persist_failed' };
}

async function giftPet({ guildId, fromUserId, toUserId } = {}) {
  const gid = String(guildId || '').trim();
  const from = String(fromUserId || '').trim();
  const to = String(toUserId || '').trim();
  if (!gid || !from || !to) return { ok: false, error: 'missing_ids' };
  if (from === to) return { ok: false, error: 'self_gift' };

  const map = await getGuildEntitlementMap(gid);
  const row = map.get(from);
  if (!row) return { ok: false, error: 'no_entitlement' };
  if (map.has(to)) return { ok: false, error: 'target_has_pet' };

  const deleted = await deleteEntitlement(gid, from);
  if (!deleted) return { ok: false, error: 'delete_failed' };
  const stored = await upsertEntitlement({
    guild_id: gid,
    user_id: to,
    source: 'gift',
    granted_by: from,
    stripe_session_id: row.stripe_session_id || null,
    stripe_payment_intent: row.stripe_payment_intent || null,
  });
  return stored ? { ok: true, row: stored } : { ok: false, error: 'persist_failed' };
}

async function assignProGrant({ guildId, granterId, toUserId } = {}) {
  const gid = String(guildId || '').trim();
  const to = String(toUserId || '').trim();
  const granter = String(granterId || '').trim();
  if (!gid || !to) return { ok: false, error: 'missing_ids' };

  const plan = await guildPlans.getGuildPlan(gid);
  if (!plan.active) return { ok: false, error: 'guild_not_pro' };
  if (await hasPetEntitlement(gid, to)) return { ok: false, error: 'target_has_pet' };

  const rem = await getGrantRemaining(gid);
  if (rem <= 0) return { ok: false, error: 'no_grants_left' };

  const stored = await upsertEntitlement({
    guild_id: gid,
    user_id: to,
    source: 'pro_grant',
    granted_by: granter || null,
  });
  if (!stored) return { ok: false, error: 'persist_failed' };
  await writeGrantRemaining(gid, rem - 1);
  return { ok: true, row: stored, remaining: rem - 1 };
}

async function revokeProGrant({ guildId, userId } = {}) {
  const gid = String(guildId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) return { ok: false, error: 'missing_ids' };

  const map = await getGuildEntitlementMap(gid);
  const row = map.get(uid);
  if (!row) return { ok: false, error: 'no_entitlement' };
  if (row.source !== 'pro_grant') return { ok: false, error: 'not_pro_grant' };

  const deleted = await deleteEntitlement(gid, uid);
  if (!deleted) return { ok: false, error: 'delete_failed' };

  const plan = await guildPlans.getGuildPlan(gid);
  if (plan.active) {
    const rem = await getGrantRemaining(gid);
    await writeGrantRemaining(gid, Math.min(PRO_GRANT_POOL, rem + 1));
  }
  return { ok: true, remaining: plan.active ? (await getGrantRemaining(gid)) : 0 };
}

module.exports = {
  PRO_GRANT_POOL,
  dbConfigured,
  hasPetEntitlement,
  peekPetEntitlement,
  warmGuildPets,
  listEntitlements,
  grantFromPurchase,
  giftPet,
  assignProGrant,
  revokeProGrant,
  syncProGrantPool,
  getGrantRemaining,
  invalidate,
};
