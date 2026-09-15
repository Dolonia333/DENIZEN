'use strict';

/**
 * Org-level Studio Board activity feed (capped).
 */

const ACTIVITY_CAP = 200;

function appendActivity(state, entry = {}) {
  if (!state || typeof state !== 'object') return state;
  const item = {
    id: String(entry.id || `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
    ts: Number(entry.ts) || Date.now(),
    who: String(entry.who || 'System').slice(0, 64),
    text: String(entry.text || '').slice(0, 280),
    taskId: entry.taskId || entry.task_id || null,
    title: entry.title ? String(entry.title).slice(0, 200) : null,
    kind: entry.kind || null,
  };
  if (!item.text) return state;
  const prev = Array.isArray(state.activity) ? state.activity : [];
  state.activity = [item, ...prev].slice(0, ACTIVITY_CAP);
  return state;
}

function activityFromTaskLogs(state) {
  const items = [];
  for (const t of state?.tasks || []) {
    for (const l of t.log || []) {
      items.push({
        id: `log_${t.id}_${l.ts}`,
        ts: Number(l.ts) || 0,
        who: l.who || 'Someone',
        text: l.text || '',
        taskId: t.id,
        title: t.title || null,
        kind: 'log',
      });
    }
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, ACTIVITY_CAP);
}

function listActivity(state) {
  const org = Array.isArray(state?.activity) ? state.activity : [];
  if (org.length) return org.slice(0, ACTIVITY_CAP);
  return activityFromTaskLogs(state);
}

module.exports = {
  ACTIVITY_CAP,
  appendActivity,
  activityFromTaskLogs,
  listActivity,
};
