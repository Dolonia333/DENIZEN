'use strict';
/** Phase 2: peer work-status via npc_conversation */
const WebSocket = require('ws');

const host = process.argv[2] || '127.0.0.1';
const port = process.argv[3] || '8888';
let reply = null;
const ws = new WebSocket(`ws://${host}:${port}/agent-ws`);

function finish(extra = {}) {
  console.log(JSON.stringify({ reply, ...extra }));
  try { ws.close(); } catch (_) {}
  process.exit(0);
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'npc_assign_directive',
      from: 'Abby',
      to: 'Alex',
      task: 'Phase 2 probe: update README comment line',
      urgent: true,
    }));
  }, 300);
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'npc_conversation',
      npcName: 'Alex',
      fromName: 'Abby',
      text: 'Alex, status on the README task?',
      turn: 1,
    }));
  }, 1200);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  if (m.type === 'npc_response' && m.npcName === 'Alex') {
    reply = {
      text: m.text,
      scripted: m.scripted,
      fromName: m.fromName,
    };
    setTimeout(() => finish({ done: true }), 500);
  }
});

ws.on('error', (e) => finish({ error: e.message }));
setTimeout(() => finish({ timedOut: true }), 30000);
