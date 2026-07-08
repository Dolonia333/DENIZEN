'use strict';

function summarizeDeals(deals) {
  const list = Array.isArray(deals) ? deals : [];
  const open = list.filter((d) => !/closed (won|lost)/i.test(String(d?.stage || '')));
  const won = list.filter((d) => /closed won/i.test(String(d?.stage || '')));
  const lost = list.filter((d) => /closed lost/i.test(String(d?.stage || '')));
  return {
    openCount: open.length,
    wonCount: won.length,
    lostCount: lost.length,
    pipelineValue: open.reduce((s, d) => s + (Number(d.value) || 0), 0),
    wonValue: won.reduce((s, d) => s + (Number(d.value) || 0), 0),
  };
}

function buildDailySnapshot(state) {
  const deals = Array.isArray(state?.deals) ? state.deals : [];
  const contacts = Array.isArray(state?.contacts) ? state.contacts : [];
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const today = new Date().toISOString().slice(0, 10);
  const ds = summarizeDeals(deals);
  const overdueTasks = tasks.filter((t) => !t.done && t.due && String(t.due) < today).length;
  return {
    date: today,
    contacts: contacts.length,
    ...ds,
    overdueTasks,
    at: new Date().toISOString(),
  };
}

function appendDailySnapshot(state) {
  const snap = buildDailySnapshot(state);
  const prev = Array.isArray(state?.metricSnapshots) ? [...state.metricSnapshots] : [];
  if (prev.some((s) => s.date === snap.date)) {
    return { state, changed: false };
  }
  const metricSnapshots = [snap, ...prev].slice(0, 90);
  return {
    state: { ...state, metricSnapshots },
    changed: true,
  };
}

module.exports = {
  buildDailySnapshot,
  appendDailySnapshot,
  summarizeDeals,
};
