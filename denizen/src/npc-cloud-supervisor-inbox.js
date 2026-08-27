'use strict';

/**
 * Cloud supervisor inbox — local think cycles write flags here;
 * Grok/Claude supervisor (or free-tier MCP clients) read + correct.
 */

const fs = require('node:fs');
const path = require('node:path');

const INBOX_PATH = path.join(__dirname, '..', 'data', 'cloud-supervisor-inbox.jsonl');
const MAX_LINES = 400;

function inboxPath() {
  return INBOX_PATH;
}

function appendEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const row = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    handled: false,
    ...event,
  };
  try {
    fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true });
    fs.appendFileSync(INBOX_PATH, `${JSON.stringify(row)}\n`);
  } catch (_) {
    return null;
  }
  return row;
}

function readRecent(limit = 80) {
  try {
    if (!fs.existsSync(INBOX_PATH)) return [];
    const lines = fs.readFileSync(INBOX_PATH, 'utf8').split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(1, Math.min(MAX_LINES, limit * 3)));
    const rows = [];
    for (const line of slice) {
      try { rows.push(JSON.parse(line)); } catch (_) {}
    }
    return rows.slice(-limit);
  } catch (_) {
    return [];
  }
}

function listUnhandled(limit = 40) {
  return readRecent(200)
    .filter((r) => r && !r.handled)
    .slice(-limit);
}

function markHandled(ids = []) {
  const want = new Set((ids || []).filter(Boolean));
  if (!want.size || !fs.existsSync(INBOX_PATH)) return 0;
  const lines = fs.readFileSync(INBOX_PATH, 'utf8').split('\n').filter(Boolean);
  let changed = 0;
  const out = lines.map((line) => {
    try {
      const row = JSON.parse(line);
      if (want.has(row.id) && !row.handled) {
        changed += 1;
        return JSON.stringify({ ...row, handled: true, handled_at: new Date().toISOString() });
      }
      return line;
    } catch (_) {
      return line;
    }
  });
  // Keep last MAX_LINES
  const trimmed = out.slice(-MAX_LINES);
  fs.writeFileSync(INBOX_PATH, trimmed.join('\n') + (trimmed.length ? '\n' : ''));
  return changed;
}

function recordHallucination(npcName, claims = []) {
  return appendEvent({
    type: 'hallucination',
    npc: npcName,
    claims: (claims || []).slice(0, 5).map((c) => ({
      text: String(c.text || c).slice(0, 200),
      reason: String(c.reason || '').slice(0, 200),
    })),
    severity: 'high',
  });
}

function recordChronos(npcName, detail = {}) {
  return appendEvent({
    type: 'chronos_loop',
    npc: npcName,
    detail: {
      action: detail.action || null,
      message: String(detail.message || 'same decision repeated').slice(0, 200),
    },
    severity: 'high',
  });
}

function recordSkillFailure(npcName, skill, error) {
  return appendEvent({
    type: 'skill_failure',
    npc: npcName,
    skill: String(skill || '').slice(0, 80),
    error: String(error || '').slice(0, 240),
    severity: 'normal',
  });
}

function summarizeForCloud(limit = 25) {
  const open = listUnhandled(limit);
  const byType = {};
  for (const e of open) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  return {
    ok: true,
    open_count: open.length,
    by_type: byType,
    events: open,
    hint:
      'Cloud mentors: for hallucination → assign_task retract+verify; '
      + 'for chronos_loop → urgent assign_task break loop; '
      + 'for mentor backlog use mentor_list_pending / mentor_peer_reply / mentor_finalize. '
      + 'Local LM keeps running tools; cloud only guides.',
  };
}

module.exports = {
  inboxPath,
  appendEvent,
  readRecent,
  listUnhandled,
  markHandled,
  recordHallucination,
  recordChronos,
  recordSkillFailure,
  summarizeForCloud,
};
