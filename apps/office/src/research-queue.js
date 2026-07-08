'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VALID_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];
const QUEUE_FILE = process.env.RESEARCH_QUEUE_FILE
  ? path.resolve(process.env.RESEARCH_QUEUE_FILE)
  : path.join(ROOT, 'data', 'research-queue.json');

function _readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function _writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function _id() {
  return `rq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadQueue() {
  const store = _readJson(QUEUE_FILE, { topics: [] });
  if (!Array.isArray(store.topics)) store.topics = [];
  return store;
}

function saveQueue(store) {
  _writeJson(QUEUE_FILE, store);
}

function _normalizePriority(priority) {
  const p = Number(priority);
  if (!Number.isFinite(p)) return 3;
  return Math.max(1, Math.min(10, Math.round(p)));
}

function _sortByPriorityThenTime(a, b) {
  const pa = Number(a.priority) || 0;
  const pb = Number(b.priority) || 0;
  if (pb !== pa) return pb - pa;
  return (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0);
}

function addTopic({ topic, priority, assignedTo, notes } = {}) {
  const trimmedTopic = String(topic || '').trim();
  if (!trimmedTopic) throw new Error('topic is required');

  const store = loadQueue();
  const now = new Date().toISOString();
  const item = {
    id: _id(),
    topic: trimmedTopic,
    priority: _normalizePriority(priority),
    assignedTo: assignedTo ? String(assignedTo).trim() : '',
    notes: notes ? String(notes).trim() : '',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    resultPath: null,
  };

  store.topics.unshift(item);
  if (store.topics.length > 1000) store.topics.length = 1000;
  saveQueue(store);
  return item;
}

function listTopics({ status, limit = 50 } = {}) {
  const store = loadQueue();
  let items = [...store.topics];

  if (status) {
    const normalized = String(status).trim();
    if (!VALID_STATUSES.includes(normalized)) return [];
    items = items.filter(x => x.status === normalized);
  }

  items.sort(_sortByPriorityThenTime);
  const max = Math.max(1, Number(limit) || 50);
  return items.slice(0, max);
}

function completeTopic(id, resultPath) {
  const topicId = String(id || '').trim();
  if (!topicId) throw new Error('id is required');

  const store = loadQueue();
  const idx = store.topics.findIndex(x => x.id === topicId);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const updated = {
    ...store.topics[idx],
    status: 'done',
    resultPath: resultPath ? String(resultPath).trim() : null,
    completedAt: now,
    updatedAt: now,
  };
  store.topics[idx] = updated;
  saveQueue(store);
  return updated;
}

/**
 * Claims the highest-priority pending topic for scheduler work.
 * Returns null when no pending topics exist.
 */
function getNextPending() {
  const store = loadQueue();
  const pending = store.topics
    .map((topic, index) => ({ topic, index }))
    .filter(x => x.topic.status === 'pending')
    .sort((a, b) => _sortByPriorityThenTime(a.topic, b.topic));

  if (!pending.length) return null;

  const now = new Date().toISOString();
  const winner = pending[0];
  const claimed = {
    ...winner.topic,
    status: 'in_progress',
    startedAt: winner.topic.startedAt || now,
    updatedAt: now,
  };

  store.topics[winner.index] = claimed;
  saveQueue(store);
  return claimed;
}

module.exports = {
  QUEUE_FILE,
  VALID_STATUSES,
  loadQueue,
  saveQueue,
  addTopic,
  listTopics,
  completeTopic,
  getNextPending,
};
