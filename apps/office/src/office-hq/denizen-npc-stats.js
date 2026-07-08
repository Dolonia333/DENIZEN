'use strict';
/**
 * Per-NPC productivity stats — leaderboard + streaks.
 *
 * Source of truth is in-memory (worldState.npcStats) so the leaderboard
 * works immediately in zero-config demo mode. When Supabase is configured
 * (denizenDb.enabled), writes are also fire-and-forget dual-written to
 * `denizen_npc_stats_daily` for durability across restarts, and
 * hydrateFromDb() re-seeds the in-memory state at boot.
 */

const worldState = require('../world-state');
const denizenDb = require('../intelligence/denizen-db');
const npcRoster = require('../npc/npc-roster');

const DAILY_RETENTION_DAYS = 35;
const HYDRATE_DAYS = 35;

const FOLDER_TO_DISPLAY = Object.fromEntries(
  (npcRoster.entries || []).map((e) => [e.folder, e.display]),
);

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateKey(d);
}

function emptyBucket() {
  return { shipped: 0, ok: 0, stuck: 0, blocked: 0 };
}

function emptyRecord() {
  return { dailyCounts: {}, streakDays: 0, lastShipDate: null };
}

/** Walk backward from today counting consecutive days with shipped > 0. */
function computeStreak(dailyCounts) {
  let streak = 0;
  let lastShipDate = null;
  let cursor = dateKey();
  // Today doesn't have to have shipped yet for the streak to still be
  // "alive" — only count today itself if it has shipped, otherwise start
  // the walk from yesterday so an in-progress day doesn't zero the streak.
  if ((dailyCounts[cursor]?.shipped || 0) > 0) {
    lastShipDate = cursor;
  } else {
    cursor = addDays(cursor, -1);
  }
  while ((dailyCounts[cursor]?.shipped || 0) > 0) {
    if (!lastShipDate) lastShipDate = cursor;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { streakDays: streak, lastShipDate };
}

function trimOldDays(dailyCounts) {
  const cutoff = addDays(dateKey(), -DAILY_RETENTION_DAYS);
  const out = {};
  for (const [date, counts] of Object.entries(dailyCounts)) {
    if (date >= cutoff) out[date] = counts;
  }
  return out;
}

function recordOutcome(npcName, { outcome, taskPhase } = {}) {
  if (!npcName) return null;
  const existing = worldState.getNpcStatRecord(npcName) || emptyRecord();
  const today = dateKey();
  const bucket = { ...emptyBucket(), ...(existing.dailyCounts[today] || {}) };

  if (outcome === 'success' && taskPhase === 'finished') bucket.shipped += 1;
  else if (outcome === 'ok') bucket.ok += 1;
  else if (outcome === 'stuck') bucket.stuck += 1;
  else if (outcome === 'blocked') bucket.blocked += 1;

  const dailyCounts = trimOldDays({ ...existing.dailyCounts, [today]: bucket });
  const { streakDays, lastShipDate } = computeStreak(dailyCounts);
  const record = { dailyCounts, streakDays, lastShipDate };

  worldState.setNpcStatRecord(npcName, record);
  _dualWrite(npcName, today, bucket).catch(() => {});
  return record;
}

async function _dualWrite(npcName, statDate, bucket) {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const npcKey = denizenDb.npcKey(npcName);
  const orgId = denizenDb.orgId;
  const filter =
    `denizen_npc_stats_daily?org_id=eq.${encodeURIComponent(orgId)}` +
    `&npc_key=eq.${encodeURIComponent(npcKey)}&stat_date=eq.${encodeURIComponent(statDate)}`;
  const existing = await denizenDb._get(`${filter}&select=id`).catch(() => []);
  const row = {
    org_id: orgId,
    npc_key: npcKey,
    stat_date: statDate,
    shipped_count: bucket.shipped,
    ok_count: bucket.ok,
    stuck_count: bucket.stuck,
    blocked_count: bucket.blocked,
  };
  if (existing?.[0]?.id) {
    await denizenDb._patch(filter, row, { prefer: 'return=minimal' });
  } else {
    await denizenDb._post('denizen_npc_stats_daily', row, { prefer: 'return=minimal' });
  }
}

function _sumWindow(dailyCounts, days) {
  const totals = emptyBucket();
  let cursor = dateKey();
  for (let i = 0; i < days; i++) {
    const bucket = dailyCounts[cursor];
    if (bucket) {
      totals.shipped += bucket.shipped || 0;
      totals.ok += bucket.ok || 0;
      totals.stuck += bucket.stuck || 0;
      totals.blocked += bucket.blocked || 0;
    }
    cursor = addDays(cursor, -1);
  }
  return totals;
}

function getLeaderboard({ period = 'week' } = {}) {
  const days = period === 'today' ? 1 : period === 'all' ? DAILY_RETENTION_DAYS : 7;
  const all = worldState.getAllNpcStats();
  const rows = Object.entries(all).map(([npcName, rec]) => {
    const totals = _sumWindow(rec.dailyCounts, days);
    return {
      npcName,
      shipped: totals.shipped,
      ok: totals.ok,
      stuck: totals.stuck,
      blocked: totals.blocked,
      streakDays: rec.streakDays || 0,
    };
  });
  rows.sort((a, b) => b.shipped - a.shipped || b.streakDays - a.streakDays);
  return rows;
}

function getStreaks() {
  const all = worldState.getAllNpcStats();
  return Object.entries(all)
    .map(([npcName, rec]) => ({ npcName, streakDays: rec.streakDays || 0, lastShipDate: rec.lastShipDate || null }))
    .filter((r) => r.streakDays > 0)
    .sort((a, b) => b.streakDays - a.streakDays);
}

/** Office-wide shipped count for today (all NPCs). */
function getTodayOfficeTotals() {
  const today = dateKey();
  let shipped = 0;
  for (const rec of Object.values(worldState.getAllNpcStats())) {
    shipped += rec.dailyCounts?.[today]?.shipped || 0;
  }
  return { shipped, date: today };
}

/** GitHub-style heatmap cells — office-wide shipped per day, oldest first. */
function getOfficeHeatmap({ days = 35 } = {}) {
  const safeDays = Math.min(Math.max(Number(days) || 35, 7), DAILY_RETENTION_DAYS);
  const all = worldState.getAllNpcStats();
  const totals = {};
  for (const rec of Object.values(all)) {
    for (const [d, bucket] of Object.entries(rec.dailyCounts || {})) {
      totals[d] = (totals[d] || 0) + (bucket.shipped || 0);
    }
  }
  const cells = [];
  let cursor = dateKey();
  for (let i = 0; i < safeDays; i++) {
    cells.unshift({ date: cursor, shipped: totals[cursor] || 0 });
    cursor = addDays(cursor, -1);
  }
  const max = Math.max(1, ...cells.map((c) => c.shipped));
  return { cells, max, days: safeDays };
}

async function hydrateFromDb() {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const cutoff = addDays(dateKey(), -HYDRATE_DAYS);
  const rows = await denizenDb
    ._get(
      `denizen_npc_stats_daily?org_id=eq.${encodeURIComponent(denizenDb.orgId)}` +
        `&stat_date=gte.${encodeURIComponent(cutoff)}&select=npc_key,stat_date,shipped_count,ok_count,stuck_count,blocked_count`,
    )
    .catch(() => []);
  const byNpc = new Map();
  for (const row of rows || []) {
    const display = FOLDER_TO_DISPLAY[row.npc_key] || row.npc_key;
    if (!byNpc.has(display)) byNpc.set(display, emptyRecord());
    byNpc.get(display).dailyCounts[row.stat_date] = {
      shipped: row.shipped_count || 0,
      ok: row.ok_count || 0,
      stuck: row.stuck_count || 0,
      blocked: row.blocked_count || 0,
    };
  }
  for (const [display, rec] of byNpc) {
    const { streakDays, lastShipDate } = computeStreak(rec.dailyCounts);
    worldState.setNpcStatRecord(display, { ...rec, streakDays, lastShipDate });
  }
}

module.exports = {
  recordOutcome,
  getLeaderboard,
  getStreaks,
  getTodayOfficeTotals,
  getOfficeHeatmap,
  hydrateFromDb,
  _computeStreak: computeStreak, // exported for tests
  _dateKey: dateKey,
};
