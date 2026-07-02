'use strict';
/** Phase 3: CEO -> Marcus with business context + CRM awareness */
const WebSocket = require('ws');

const host = process.argv[2] || '127.0.0.1';
const port = process.argv[3] || '8888';
const msg =
  process.argv[4] ||
  'Marcus, run_skill business-context-brief — cross-check CRM against OMES EV00000919. What is the critical blocker before October and who owns it?';

let reply = null;
let replies = [];
const ws = new WebSocket(`ws://${host}:${port}/agent-ws`);

function finish(extra = {}) {
  const best = replies.reduce(
    (a, b) => ((b.text || '').length > (a.text || '').length ? b : a),
    reply || { text: '' },
  );
  console.log(JSON.stringify({ reply: best, replyCount: replies.length, ...extra }));
  try { ws.close(); } catch (_) {}
  process.exit(0);
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'player_chat', npcName: 'Marcus', text: msg }));
  }, 500);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  if (m.type === 'player_chat_response' && m.npcName === 'Marcus') {
    reply = {
      text: m.text,
      actions: m.actions || [],
      skill: m.skill || null,
    };
    replies.push(reply);
  }
});

ws.on('error', (e) => finish({ error: e.message }));
setTimeout(() => finish({ timedOut: true }), 75000);
