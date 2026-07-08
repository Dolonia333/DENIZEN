'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SESSIONS_FILE = process.env.RESEARCH_SESSIONS_FILE
  ? path.resolve(process.env.RESEARCH_SESSIONS_FILE)
  : path.join(ROOT, 'data', 'research-sessions.json');

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
  return `rs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadSessions() {
  const store = _readJson(SESSIONS_FILE, { sessions: [] });
  if (!Array.isArray(store.sessions)) store.sessions = [];
  return store;
}

function saveSessions(store) {
  _writeJson(SESSIONS_FILE, store);
}

function startSession(topic) {
  const rawTopic = typeof topic === 'string' ? { topic } : (topic || {});
  const topicText = String(rawTopic.topic || '').trim();
  if (!topicText) throw new Error('topic is required');

  const store = loadSessions();
  const now = new Date().toISOString();
  const session = {
    id: _id(),
    topic: topicText,
    npcName: String(rawTopic.npcName || rawTopic.assignedTo || '').trim() || null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    findings: [],
    briefPath: null,
    linkedAt: null,
  };

  store.sessions.unshift(session);
  if (store.sessions.length > 1000) store.sessions.length = 1000;
  saveSessions(store);
  return session;
}

function getSession(id) {
  const sessionId = String(id || '').trim();
  if (!sessionId) return null;
  const store = loadSessions();
  return store.sessions.find(s => s.id === sessionId) || null;
}

function appendFinding(sessionId, { source, text, url } = {}) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('sessionId is required');
  const content = String(text || '').trim();
  if (!content) throw new Error('finding text is required');

  const store = loadSessions();
  const idx = store.sessions.findIndex(s => s.id === id);
  if (idx < 0) return null;

  const finding = {
    source: source ? String(source).trim() : '',
    text: content,
    url: url ? String(url).trim() : '',
    at: new Date().toISOString(),
  };

  const current = store.sessions[idx];
  const updated = {
    ...current,
    findings: [...(current.findings || []), finding],
    updatedAt: new Date().toISOString(),
  };
  store.sessions[idx] = updated;
  saveSessions(store);
  return finding;
}

function linkSessionToBrief(sessionId, briefPath) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('sessionId is required');
  const bp = String(briefPath || '').trim();
  if (!bp) throw new Error('briefPath is required');

  const store = loadSessions();
  const idx = store.sessions.findIndex(s => s.id === id);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const updated = {
    ...store.sessions[idx],
    briefPath: bp,
    status: 'linked',
    linkedAt: now,
    updatedAt: now,
  };
  store.sessions[idx] = updated;
  saveSessions(store);
  return updated;
}

function getActiveSessionsForNpc(npcName) {
  const who = String(npcName || '').trim().toLowerCase();
  if (!who) return [];
  const store = loadSessions();
  return store.sessions.filter(s => {
    const name = String(s.npcName || '').trim().toLowerCase();
    return name === who && s.status === 'active';
  });
}

module.exports = {
  SESSIONS_FILE,
  loadSessions,
  saveSessions,
  startSession,
  getSession,
  appendFinding,
  linkSessionToBrief,
  getActiveSessionsForNpc,
};
