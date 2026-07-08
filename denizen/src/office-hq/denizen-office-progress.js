'use strict';
/**
 * Office-wide XP/level ΓÇö progression driven by real outcomes (tasks
 * shipped, CRM deals won, tickets closed), not fake points.
 *
 * Source of truth is in-memory (worldState.officeProgress), same
 * zero-config-first rationale as denizen-npc-stats.js. Supabase is an
 * optional durability layer: dual-writes when denizenDb.enabled, and
 * hydrateFromDb() re-seeds in-memory state at boot.
 */

const fs = require('node:fs');
const path = require('node:path');
const worldState = require('../world-state');
const denizenDb = require('../denizen-db');

const THRESHOLDS_PATH = path.join(__dirname, '..', '..', 'data', 'office-level-thresholds.json');

/** Suggested XP weights per event type ΓÇö callers pass weight explicitly,
 *  this is just the shared reference so hook sites agree on values. */
const XP_WEIGHTS = {
  task_shipped: 1,
  deal_won: 10,
  ticket_closed: 3,
};

let _thresholdsCache = null;
function loadThresholds() {
  if (_thresholdsCache) return _thresholdsCache;
  try {
    const raw = fs.readFileSync(THRESHOLDS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _thresholdsCache = Array.isArray(parsed.thresholds) && parsed.thresholds.length
      ? parsed.thresholds
      : [0];
  } catch (_) {
    _thresholdsCache = [0];
  }
  return _thresholdsCache;
}

function levelForXp(xp) {
  const thresholds = loadThresholds();
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) level = i + 1;
    else break;
  }
  return level;
}

function getProgress() {
  const thresholds = loadThresholds();
  const { totalXp, level } = worldState.officeProgress;
  const currentThreshold = thresholds[level - 1] ?? 0;
  const nextThreshold = level < thresholds.length ? thresholds[level] : null;
  return {
    totalXp,
    level,
    xpIntoLevel: totalXp - currentThreshold,
    xpForNextLevel: nextThreshold != null ? nextThreshold - currentThreshold : null,
    counts: { ...worldState.officeProgress.counts },
  };
}

function awardXp(type, weight, meta = {}) {
  const safeWeight = Number.isFinite(weight) ? weight : (XP_WEIGHTS[type] || 0);
  if (safeWeight <= 0) return getProgress();

  const prevLevel = worldState.officeProgress.level;
  const nextXp = worldState.officeProgress.totalXp + safeWeight;
  const nextLevel = levelForXp(nextXp);

  // All-time counts only track the three real outcome types ΓÇö quest_reward
  // XP must never inflate them (achievements like "100 shipped" would lie).
  const counts = { ...worldState.officeProgress.counts };
  if (Object.prototype.hasOwnProperty.call(XP_WEIGHTS, type)) {
    counts[type] = (counts[type] || 0) + 1;
  }

  worldState.setOfficeProgress({ totalXp: nextXp, level: nextLevel, counts });
  worldState.pushProgressEvent({ type, weight: safeWeight, meta });

  if (nextLevel > prevLevel) {
    worldState.announceLevelUp({ level: nextLevel, totalXp: nextXp, type, meta });
  }

  // Feed quests + achievements off the same event. Lazy-required because
  // both modules require this one (quests awards claim XP through us).
  try {
    require('./denizen-achievements').evaluate();
  } catch (_) {}
  if (type !== 'quest_reward') {
    try {
      require('./denizen-quests').recordProgress(type);
    } catch (_) {}
  }

  _dualWriteAward(type, safeWeight, meta).catch(() => {});

  return { totalXp: nextXp, level: nextLevel, leveledUp: nextLevel > prevLevel };
}

async function _dualWriteAward(type, weight, meta) {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const orgId = denizenDb.orgId;

  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await denizenDb
      ._get(`denizen_office_progress?select=total_xp&org_id=eq.${encodeURIComponent(orgId)}&limit=1`)
      .catch(() => []);
    const current = rows?.[0];

    const counts = { ...worldState.officeProgress.counts };

    if (!current) {
      const startXp = weight;
      await denizenDb
        ._post(
          'denizen_office_progress',
          { org_id: orgId, total_xp: startXp, level: levelForXp(startXp), counts, updated_at: new Date().toISOString() },
          { prefer: 'return=minimal' },
        )
        .catch(() => {});
      break;
    }

    const currentXp = Number(current.total_xp) || 0;
    const nextXp = currentXp + weight;
    const filter =
      `denizen_office_progress?org_id=eq.${encodeURIComponent(orgId)}&total_xp=eq.${encodeURIComponent(currentXp)}`;
    const patched = await denizenDb
      ._patch(filter, { total_xp: nextXp, level: levelForXp(nextXp), counts, updated_at: new Date().toISOString() }, { prefer: 'return=representation' })
      .catch(() => null);
    if (patched?.length) break; // success
    // else another writer won the race ΓÇö retry
  }

  await denizenDb
    ._post('denizen_office_progress_events', { org_id: orgId, event_type: type, weight, meta: meta || {} }, { prefer: 'return=minimal' })
    .catch(() => {});
}

async function hydrateFromDb() {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const orgId = denizenDb.orgId;
  const rows = await denizenDb
    ._get(`denizen_office_progress?select=total_xp,level,counts&org_id=eq.${encodeURIComponent(orgId)}&limit=1`)
    .catch(() => []);
  const row = rows?.[0];
  if (row) {
    const counts = row.counts && typeof row.counts === 'object'
      ? { task_shipped: 0, deal_won: 0, ticket_closed: 0, ...row.counts }
      : { ...worldState.officeProgress.counts };
    worldState.setOfficeProgress({ totalXp: Number(row.total_xp) || 0, level: Number(row.level) || 1, counts });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events = await denizenDb
    ._get(
      `denizen_office_progress_events?select=event_type,weight,meta,created_at&org_id=eq.${encodeURIComponent(orgId)}` +
        `&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=50`,
    )
    .catch(() => []);
  for (const ev of events || []) {
    worldState.pushProgressEvent({ type: ev.event_type, weight: ev.weight, meta: ev.meta || {} });
  }
}

const EVENT_LABELS = {
  task_shipped: 'shipped a task',
  deal_won: 'won a deal',
  ticket_closed: 'closed a ticket',
  quest_reward: 'claimed a quest',
};

/** Human-readable bullets for the HQ "while you were away" strip. */
function buildAwaySummary(sinceMs) {
  const since = Number(sinceMs) || 0;
  const events = (worldState.officeProgress.eventsThisWeek || [])
    .filter((e) => (e.at || 0) >= since)
    .slice(0, 12);
  const lines = [];
  const byNpc = new Map();
  for (const ev of events) {
    const npc = ev.meta?.npc || ev.meta?.npcName;
    const label = EVENT_LABELS[ev.type] || ev.type?.replace(/_/g, ' ');
    if (npc) {
      const key = `${npc}|${ev.type}`;
      byNpc.set(key, (byNpc.get(key) || 0) + 1);
    } else if (label) {
      lines.push(`${label} (+${ev.weight || 0} XP)`);
    }
  }
  for (const [key, count] of byNpc) {
    const [npc, type] = key.split('|');
    const label = EVENT_LABELS[type] || type?.replace(/_/g, ' ');
    lines.push(`${npc} ${label}${count > 1 ? ` ├ù${count}` : ''}`);
  }
  const shipped = events.filter((e) => e.type === 'task_shipped').length;
  const deals = events.filter((e) => e.type === 'deal_won').length;
  return {
    since,
    eventCount: events.length,
    shipped,
    deals,
    lines: lines.slice(0, 8),
    quiet: lines.length === 0,
  };
}

module.exports = {
  XP_WEIGHTS,
  awardXp,
  getProgress,
  buildAwaySummary,
  hydrateFromDb,
  _levelForXp: levelForXp, // exported for tests
};
