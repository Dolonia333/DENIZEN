'use strict';
/**
 * Office achievements — permanent milestone badges driven by the same
 * real-outcome XP stream as levels (denizen-office-progress.js).
 *
 * Unlock-once semantics: an achievement that crosses its threshold is
 * recorded in worldState.officeAchievements and never re-announced.
 * In-memory-first like npc-stats/office-progress; Supabase is optional
 * durability (dual-write on unlock, hydrate at boot).
 *
 * Note: reads progress state straight off worldState (not via
 * denizen-office-progress) so that module can lazy-require us from
 * awardXp() without a circular dependency.
 */

const fs = require('node:fs');
const path = require('node:path');
const worldState = require('../world-state');
const denizenDb = require('../intelligence/denizen-db');
const npcStats = require('./denizen-npc-stats');

const DEFS_PATH = path.join(__dirname, '..', '..', 'data', 'achievements.json');

let _defsCache = null;
function loadDefinitions() {
  if (_defsCache) return _defsCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DEFS_PATH, 'utf8'));
    _defsCache = Array.isArray(parsed.achievements) ? parsed.achievements : [];
  } catch (_) {
    _defsCache = [];
  }
  return _defsCache;
}

function _dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Distinct weekdays (Mon-Fri) this calendar week with any office-wide ship. */
function _weekdayShipCoverage() {
  const all = worldState.getAllNpcStats();
  const now = new Date();
  // Walk back to Monday of the current week (UTC).
  const monday = new Date(now);
  const day = monday.getUTCDay(); // 0=Sun
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  const covered = new Set();
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const key = _dateKey(d);
    for (const rec of Object.values(all)) {
      if ((rec.dailyCounts?.[key]?.shipped || 0) > 0) {
        covered.add(key);
        break;
      }
    }
  }
  return covered.size;
}

function _maxNpcStreak() {
  const streaks = npcStats.getStreaks();
  return streaks.length ? streaks[0].streakDays : 0;
}

function resolveMetric(metric) {
  const progress = worldState.officeProgress;
  switch (metric) {
    case 'total_xp': return progress.totalXp || 0;
    case 'level': return progress.level || 1;
    case 'task_shipped':
    case 'deal_won':
    case 'ticket_closed':
      return progress.counts?.[metric] || 0;
    case 'max_npc_streak': return _maxNpcStreak();
    case 'weekday_ship_coverage': return _weekdayShipCoverage();
    default: return 0;
  }
}

/** Check every definition; unlock and announce any newly-crossed ones.
 *  Returns the list of newly unlocked definitions (possibly empty). */
function evaluate() {
  const unlocked = [];
  for (const def of loadDefinitions()) {
    if (!def?.id || worldState.officeAchievements.has(def.id)) continue;
    const value = resolveMetric(def.metric);
    if (value >= (Number(def.threshold) || Infinity)) {
      worldState.setAchievementUnlocked(def.id, {});
      worldState.announceAchievement({ id: def.id, label: def.label, icon: def.icon });
      unlocked.push(def);
      _dualWriteUnlock(def.id).catch(() => {});
    }
  }
  return unlocked;
}

function getAchievements() {
  const unlockedState = worldState.getAllAchievements();
  const unlocked = [];
  const locked = [];
  for (const def of loadDefinitions()) {
    const base = { id: def.id, label: def.label, icon: def.icon, metric: def.metric, threshold: def.threshold };
    if (unlockedState[def.id]) {
      unlocked.push({ ...base, unlockedAt: unlockedState[def.id].unlockedAt });
    } else {
      locked.push({ ...base, progress: resolveMetric(def.metric) });
    }
  }
  return { unlocked, locked };
}

async function _dualWriteUnlock(achievementId) {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  await denizenDb._post(
    'denizen_office_achievements',
    { org_id: denizenDb.orgId, achievement_id: achievementId, unlocked_at: new Date().toISOString() },
    { prefer: 'return=minimal' },
  );
}

async function hydrateFromDb() {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const rows = await denizenDb
    ._get(`denizen_office_achievements?select=achievement_id,unlocked_at&org_id=eq.${encodeURIComponent(denizenDb.orgId)}`)
    .catch(() => []);
  for (const row of rows || []) {
    if (!row?.achievement_id) continue;
    worldState.setAchievementUnlocked(row.achievement_id, {
      unlockedAt: row.unlocked_at ? new Date(row.unlocked_at).getTime() : Date.now(),
    });
  }
}

module.exports = {
  evaluate,
  getAchievements,
  hydrateFromDb,
  _resolveMetric: resolveMetric, // exported for tests
  _loadDefinitions: loadDefinitions,
};
