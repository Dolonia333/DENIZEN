'use strict';

/** jobId -> { text, chunks, updated_at, listeners } */
const jobs = new Map();
const MAX_JOBS = 200;

function prune() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort(
    (a, b) => new Date(a[1].updated_at).getTime() - new Date(b[1].updated_at).getTime(),
  );
  for (const [id] of sorted.slice(0, jobs.size - MAX_JOBS)) {
    jobs.delete(id);
  }
}

function recordProgress(jobId, delta = '', partialText = null) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const prev = jobs.get(id) || { text: '', chunks: 0, listeners: new Set() };
  const chunk = String(delta || '');
  const text = partialText != null
    ? String(partialText)
    : (chunk ? prev.text + chunk : prev.text);
  const next = {
    ...prev,
    text,
    chunks: prev.chunks + (chunk ? 1 : 0),
    updated_at: new Date().toISOString(),
    listeners: prev.listeners,
  };
  jobs.set(id, next);
  prune();
  for (const fn of next.listeners) {
    try { fn({ job_id: id, delta: chunk, text, done: false }); } catch (_) {}
  }
  return next;
}

function markDone(jobId, finalText = '') {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const prev = jobs.get(id) || { text: '', chunks: 0, listeners: new Set() };
  const text = String(finalText || prev.text || '');
  const next = { ...prev, text, done: true, updated_at: new Date().toISOString() };
  jobs.set(id, next);
  for (const fn of next.listeners) {
    try { fn({ job_id: id, delta: '', text, done: true }); } catch (_) {}
  }
  next.listeners.clear();
  return next;
}

function getProgress(jobId) {
  const id = String(jobId || '').trim();
  const row = jobs.get(id);
  if (!row) return null;
  return {
    job_id: id,
    text: row.text || '',
    chunks: row.chunks || 0,
    done: !!row.done,
    updated_at: row.updated_at,
  };
}

function subscribe(jobId, listener) {
  const id = String(jobId || '').trim();
  if (!id || typeof listener !== 'function') return () => {};
  const row = jobs.get(id) || { text: '', chunks: 0, listeners: new Set() };
  row.listeners.add(listener);
  jobs.set(id, row);
  return () => {
    const cur = jobs.get(id);
    if (cur?.listeners) cur.listeners.delete(listener);
  };
}

function resetForTests() {
  jobs.clear();
}

module.exports = {
  recordProgress,
  markDone,
  getProgress,
  subscribe,
  resetForTests,
};
