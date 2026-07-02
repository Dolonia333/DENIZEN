'use strict';
/** Phase 1: CEO -> Abby -> delegate Alex -> coding-agent README */
const WebSocket = require('ws');

const host = process.argv[2] || '127.0.0.1';
const port = process.argv[3] || '8888';
const msg =
  process.argv[4] ||
  'Abby, have Alex run_skill coding-agent to add a one-line comment to README and confirm when done.';

const abbyReplies = [];
const alexDecisions = [];
let delegation = null;
let ws;

function finish(extra = {}) {
  console.log(JSON.stringify({
    abbyReplies,
    delegation,
    alexDecisions,
    ...extra,
  }));
  try { ws?.close(); } catch (_) {}
  process.exit(0);
}

function wakeAlex(n = 0) {
  if (n >= 10) return;
  ws.send(JSON.stringify({
    type: 'npc_think',
    npcName: 'Alex',
    context: {
      urgentWake: true,
      wakeReason: 'phase1-directive',
      forceLlm: n >= 2,
    },
  }));
  setTimeout(() => wakeAlex(n + 1), 4000);
}

ws = new WebSocket(`ws://${host}:${port}/agent-ws`);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'player_chat', npcName: 'Abby', text: msg }));
  }, 500);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  if (m.type === 'player_chat_response' && m.npcName === 'Abby') {
    abbyReplies.push({
      text: String(m.text || '').slice(0, 2500),
      delegation: m.delegation || null,
      actions: m.actions || [],
    });
    if (m.delegation) delegation = m.delegation;
    if (!delegation && abbyReplies.length >= 1) {
      setTimeout(() => wakeAlex(0), 3000);
    }
    if (delegation) {
      setTimeout(() => finish({ done: 'delegated_wait' }), 60000);
    }
  }
  if (m.type === 'player_chat_response' && m.npcName === 'Alex') {
    abbyReplies.push({
      text: `[Alex] ${String(m.text || '').slice(0, 500)}`,
      delegation: null,
      actions: m.actions || [],
    });
  }
  if (m.type === 'npc_decision' && m.npcName === 'Alex' && m.decision) {
    const d = m.decision;
    alexDecisions.push({
      action: d.action,
      skill: d.skill || null,
      skillInferred: !!d._skillInferred,
      thought: (d.thought || '').slice(0, 150),
      message: (d.message || '').slice(0, 150),
    });
    if (d.action === 'run_skill' && d.skill === 'coding-agent') {
      setTimeout(() => finish({ done: 'alex_coding_agent' }), 90000);
    }
  }
});

ws.on('error', (e) => finish({ error: e.message }));

setTimeout(() => finish({ timedOut: true }), 120000);
