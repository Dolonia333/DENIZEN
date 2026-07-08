'use strict';
/**
 * Office quests ΓÇö daily/weekly goals with a manual claim step.
 *
 * Counter quests (tasks_shipped / deals_won / tickets_closed) increment
 * as real-outcome XP events land via recordProgress(). Snapshot quests
 * (max_npc_streak) are recomputed on the scheduler tick. Completing a
 * quest announces quest_complete; XP is only awarded when the user
 * claims it (claimQuest ΓåÆ awardXp('quest_reward', ...)).
 *
 * In-memory-first like the rest of the progression stack; Supabase is
 * optional durability for the current period's progress.
 */

const fs = require('node:fs');
const path = require('node:path');
const worldState = require('../world-state');
const denizenDb = require('../denizen-db');
const npcStats = require('./denizen-npc-stats');

const DEFS_PATH = path.join(__dirname, '..', '..', 'data', 'quests.json');

/** Real outcome type ΓåÆ quest counter metric. quest_reward intentionally
 *  maps to nothing so claiming can never feed quest progress. */
const OUTCOME_TO_METRIC = {
  task_shipped: 'tasks_shipped',
  deal_won: 'deals_won',
  ticket_closed: 'tickets_closed',
};

const SNAPSHOT_METRICS = new Set(['max_npc_streak']);

let _defsCache = null;
function loadDefinitions() {
  if (_defsCache) return _defsCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DEFS_PATH, 'utf8'));
    _defsCache = Array.isArray(parsed.quests) ? parsed.quests : [];
  } catch (_) {
    _defsCache = [];
  }
  return _defsCache;
}

function _dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Weekly period key = Monday of the current UTC week. */
function _weekKey(d = new Date()) {
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return `wk-${_dateKey(monday)}`;
}

function currentPeriodKey(period) {
  return period === 'daily' ? _dateKey() : _weekKey();
}

/** Reset any period whose key rolled over since last touch. */
function ensurePeriods() {
  for (const period of ['daily', 'weekly']) {
    const key = currentPeriodKey(period);
    if (worldState.quests.periodKeys[period] !== key) {
      const ids = loadDefinitions().filter((q) => q.period === period).map((q) => q.id);
      worldState.resetQuestPeriod(period, key, ids);
    }
  }
}

function _getProgress(questId) {
  return worldState.quests.progress[questId] || { count: 0, claimed: false, completedAt: null };
}

function _setCount(def, nextCount) {
  const prev = _getProgress(def.id);
  const wasComplete = prev.count >= def.target;
  const next = { ...prev, count: nextCount };
  if (!wasComplete && nextCount >= def.target && !next.completedAt) {
    next.completedAt = Date.now();
    worldState.setQuestProgress(def.id, next);
    worldState.announceQuestComplete({ id: def.id, label: def.label, reward_xp: def.reward_xp });
    _dualWriteProgress(def, next).catch(() => {});
    return;
  }
  worldState.setQuestProgress(def.id, next);
  _dualWriteProgress(def, next).catch(() => {});
}

/** Called from awardXp for the three real outcome types. */
function recordProgress(outcomeType) {
  const metric = OUTCOME_TO_METRIC[outcomeType];
  if (!metric) return;
  ensurePeriods();
  for (const def of loadDefinitions()) {
    if (def.metric !== metric) continue;
    const prev = _getProgress(def.id);
    if (prev.claimed) continue;
    _setCount(def, prev.count + 1);
  }
}

/** Scheduler backstop: rollover check + snapshot metric refresh. */
function tickQuests() {
  ensurePeriods();
  const streaks = npcStats.getStreaks();
  const maxStreak = streaks.length ? streaks[0].streakDays : 0;
  for (const def of loadDefinitions()) {
    if (!SNAPSHOT_METRICS.has(def.metric)) continue;
    const prev = _getProgress(def.id);
    if (prev.claimed) continue;
    if (maxStreak !== prev.count) _setCount(def, maxStreak);
  }
}

function claimQuest(questId) {
  ensurePeriods();
  const def = loadDefinitions().find((q) => q.id === questId);
  if (!def) return { ok: false, error: 'quest not found' };
  const prev = _getProgress(def.id);
  if (prev.claimed) return { ok: false, error: 'already claimed' };
  if (prev.count < def.target) return { ok: false, error: 'quest not complete' };

  const next = { ...prev, claimed: true, claimedAt: Date.now() };
  worldState.setQuestProgress(def.id, next);
  _dualWriteProgress(def, next).catch(() => {});

  // Lazy require ΓÇö office-progress lazy-requires us from awardXp, so
  // both edges resolve at call time and there is no load-order cycle.
  const officeProgress = require('./denizen-office-progress');
  const award = officeProgress.awardXp('quest_reward', Number(def.reward_xp) || 0, { questId: def.id });
  worldState._emit('quest_claimed', { id: def.id, label: def.label, reward_xp: def.reward_xp });

  return { ok: true, quest: _questView(def), award };
}

function _questView(def) {
  const p = _getProgress(def.id);
  return {
    id: def.id,
    label: def.label,
    period: def.period,
    metric: def.metric,
    target: def.target,
    reward_xp: def.reward_xp,
    count: Math.min(p.count, def.target),
    complete: p.count >= def.target,
    claimed: !!p.claimed,
  };
}

function getActiveQuests() {
  ensurePeriods();
  return loadDefinitions().map(_questView);
}

async function _dualWriteProgress(def, progress) {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  const orgId = denizenDb.orgId;
  const periodKey = currentPeriodKey(def.period);
  const filter =
    `denizen_office_quests?org_id=eq.${encodeURIComponent(orgId)}` +
    `&quest_id=eq.${encodeURIComponent(def.id)}&period_key=eq.${encodeURIComponent(periodKey)}`;
  const existing = await denizenDb._get(`${filter}&select=id`).catch(() => []);
  const row = {
    org_id: orgId,
    quest_id: def.id,
    period_key: periodKey,
    count: progress.count,
    claimed: !!progress.claimed,
  };
  if (existing?.[0]?.id) {
    await denizenDb._patch(filter, row, { prefer: 'return=minimal' });
  } else {
    await denizenDb._post('denizen_office_quests', row, { prefer: 'return=minimal' });
  }
}

async function hydrateFromDb() {
  if (!denizenDb.enabled || !denizenDb.orgId) return;
  ensurePeriods();
  const keys = [currentPeriodKey('daily'), currentPeriodKey('weekly')];
  const rows = await denizenDb
    ._get(
      `denizen_office_quests?select=quest_id,period_key,count,claimed&org_id=eq.${encodeURIComponent(denizenDb.orgId)}` +
        `&period_key=in.(${keys.map(encodeURIComponent).join(',')})`,
    )
    .catch(() => []);
  for (const row of rows || []) {
    const def = loadDefinitions().find((q) => q.id === row.quest_id);
    if (!def || currentPeriodKey(def.period) !== row.period_key) continue;
    worldState.setQuestProgress(def.id, {
      count: Number(row.count) || 0,
      claimed: !!row.claimed,
      completedAt: (Number(row.count) || 0) >= def.target ? Date.now() : null,
    });
  }
}

module.exports = {
  recordProgress,
  claimQuest,
  tickQuests,
  getActiveQuests,
  hydrateFromDb,
  _currentPeriodKey: currentPeriodKey, // exported for tests
  _ensurePeriods: ensurePeriods,
};
