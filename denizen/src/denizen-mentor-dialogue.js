'use strict';

/**
 * Grok + Claude mentor panel — shared dialogue sessions for local LLM NPCs.
 * Sessions live in denizen/data/mentor-dialogue.jsonl (same spine as consult-grok queue).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const npcRoster = require('./npc-roster');

const DIALOGUE_FILE = path.join(__dirname, '..', 'data', 'mentor-dialogue.jsonl');
let _dialoguePath = DIALOGUE_FILE;

function dialoguePath() {
  return _dialoguePath;
}

function setDialoguePathForTests(p) {
  _dialoguePath = p;
}

function resolveNpcKey(nameOrKey) {
  const q = String(nameOrKey || '').toLowerCase().trim();
  if (!q) return null;
  const byFolder = (npcRoster.entries || []).find((e) => e.folder === q);
  if (byFolder) return byFolder.folder;
  const byDisplay = (npcRoster.entries || []).find((e) => e.display.toLowerCase() === q);
  return byDisplay?.folder || q;
}

function displayNameForKey(npcKey) {
  const hit = (npcRoster.entries || []).find((e) => e.folder === npcKey);
  return hit?.display || npcKey;
}

function readAllSessions() {
  const file = dialoguePath();
  if (!fs.existsSync(file)) return [];
  const sessions = new Map();
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row?.id) sessions.set(row.id, row);
    } catch (_) {
      /* skip bad lines */
    }
  }
  return [...sessions.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function appendSession(session) {
  const file = dialoguePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(session)}\n`);
}

function rewriteSession(updated) {
  const file = dialoguePath();
  const all = readAllSessions();
  const idx = all.findIndex((s) => s.id === updated.id);
  if (idx >= 0) all[idx] = updated;
  else all.push(updated);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, all.map((s) => JSON.stringify(s)).join('\n') + (all.length ? '\n' : ''));
}

function deriveStatus(session) {
  if (session.status === 'finalized') return 'finalized';
  if (session.synthesis) return 'awaiting_finalize';
  if (session.grok_reply && session.claude_reply) return 'awaiting_finalize';
  if (!session.grok_reply && !session.claude_reply) return 'awaiting_peers';
  return 'awaiting_peers';
}

function createSession({ npcName, topic, question, context = '' }) {
  const npc_key = resolveNpcKey(npcName);
  const session = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    npc: displayNameForKey(npc_key),
    npc_key,
    topic: String(topic || 'mentor-panel').trim(),
    question: String(question || '').trim(),
    context: String(context || '').slice(0, 500),
    status: 'awaiting_peers',
    grok_reply: null,
    claude_reply: null,
    synthesis: null,
    finalized_at: null,
  };
  appendSession(session);
  return session;
}

function getSession(sessionId) {
  return readAllSessions().find((s) => s.id === sessionId) || null;
}

function listPending({ agent = null, limit = 20 } = {}) {
  const rows = readAllSessions().filter((s) => s.status !== 'finalized');
  const filtered = rows.filter((s) => {
    const st = deriveStatus(s);
    if (st === 'finalized') return false;
    if (agent === 'grok') return !s.grok_reply;
    if (agent === 'claude') return !s.claude_reply;
    return st !== 'finalized';
  });
  return filtered.slice(-limit);
}

function addPeerReply(sessionId, agent, reply) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.status === 'finalized') return { ok: false, error: 'session_finalized' };

  const key = agent === 'claude' ? 'claude_reply' : 'grok_reply';
  session[key] = String(reply || '').trim().slice(0, 4000);
  session[`${key}_at`] = new Date().toISOString();
  session.status = deriveStatus(session);
  rewriteSession(session);
  return { ok: true, session };
}

function buildSynthesis(session) {
  const grok = String(session.grok_reply || '').trim();
  const claude = String(session.claude_reply || '').trim();
  const q = session.question;
  const npc = session.npc;

  const lines = [
    `Mentor panel (Grok + Claude) for ${npc}`,
    `Question: ${q}`,
    '',
  ];
  if (grok) lines.push(`Grok: ${grok}`, '');
  if (claude) lines.push(`Claude: ${claude}`, '');
  lines.push(
    'Together — how to be sharper AND more human:',
    '- Reference live office details (mesh, CRM, recent work) — never generic status lines.',
    '- Vary phrasing; ask follow-ups like a real teammate who cares.',
    '- When stuck, use consult-mentors again — Grok and Claude learn your style over time.',
  );
  if (grok && claude) {
    lines.push('', 'Synthesis: combine Grok\'s direct CLI energy with Claude\'s structured reasoning in your next think cycle.');
  }
  return lines.join('\n').slice(0, 2000);
}

function finalizeSession(sessionId, synthesis = null) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (!session.grok_reply && !session.claude_reply) {
    return { ok: false, error: 'no_peer_replies' };
  }

  session.synthesis = String(synthesis || buildSynthesis(session)).trim().slice(0, 2000);
  session.status = 'finalized';
  session.finalized_at = new Date().toISOString();
  rewriteSession(session);
  return { ok: true, session };
}

module.exports = {
  DIALOGUE_FILE,
  dialoguePath,
  setDialoguePathForTests,
  resolveNpcKey,
  displayNameForKey,
  readAllSessions,
  createSession,
  getSession,
  listPending,
  addPeerReply,
  buildSynthesis,
  finalizeSession,
};
