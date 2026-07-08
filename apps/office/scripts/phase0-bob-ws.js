'use strict';
/** Phase 0: wait for skill bridge + injected findings (not early exit at reply 2). */
const WebSocket = require('ws');

const host = process.argv[2] || '127.0.0.1';
const port = process.argv[3] || '8888';
const msg =
  process.argv[4] ||
  'Bob, run_skill research on "LLM prompt compression for long-term memory" and save a report.';

const replies = [];
const ws = new WebSocket(`ws://${host}:${port}/agent-ws`);

function finish(extra = {}) {
  console.log(JSON.stringify({ replies, ...extra }));
  try { ws.close(); } catch (_) {}
  process.exit(0);
}

function bobReplies() {
  return replies.filter((r) => r.type !== 'npc_skill_result' && (r.npcName === 'Bob' || !r.npcName));
}

function hasSkillBridge() {
  return bobReplies().some((r) => {
    const t = (r.text || '').toLowerCase();
    const acts = r.actions || [];
    return t.startsWith('running research')
      || acts.some((a) => a.action === 'run_skill' || a.skill === 'research');
  });
}

function hasInjectedFindings() {
  return bobReplies().some((r) => {
    const t = (r.text || '').trim();
    if (!t || t.toLowerCase().startsWith('running research')) return false;
    return t.length >= 80;
  });
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'player_chat', npcName: 'Bob', text: msg }));
  }, 500);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  if (m.type === 'player_chat_response' && m.npcName === 'Bob') {
    replies.push({
      npcName: m.npcName,
      text: String(m.text || '').slice(0, 4000),
      actions: m.actions || [],
      error: m.error || null,
    });
    if (hasSkillBridge() && hasInjectedFindings()) {
      setTimeout(() => finish({ done: 'bridge_and_inject' }), 1500);
    }
  }
  if (m.type === 'npc_skill_result' && m.npcName === 'Bob') {
    replies.push({ type: 'npc_skill_result', npcName: m.npcName, output: m.output, ok: m.ok });
    if (hasSkillBridge()) {
      setTimeout(() => finish({ done: 'skill_result' }), 1500);
    }
  }
});

ws.on('error', (e) => finish({ error: e.message }));

setTimeout(() => finish({ timedOut: true }), 125000);
