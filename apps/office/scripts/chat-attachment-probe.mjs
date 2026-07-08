#!/usr/bin/env node
/**
 * Live probe: send player_chat with a text attachment and verify NPC cites the marker.
 *
 * Usage:
 *   node scripts/chat-attachment-probe.mjs [wsUrl] [npcName]
 *   node scripts/chat-attachment-probe.mjs wss://denizen.dolonia.cloud/agent-ws Bob
 */
import WebSocket from 'ws';

const wsUrl = process.argv[2] || 'wss://denizen.dolonia.cloud/agent-ws';
const npcName = process.argv[3] || 'Bob';
const MARKER = `PROBE-${Date.now().toString(36).toUpperCase()}`;
const TIMEOUT_MS = 120_000;

const textPayload = Buffer.from(
  `Denizen attachment probe.\nSecret marker: ${MARKER}\nIf you read this file, quote the marker exactly.`,
  'utf8',
).toString('base64');

const replies = [];
let ack = false;

function finish(extra = {}) {
  const out = {
    ok: false,
    wsUrl,
    npcName,
    marker: MARKER,
    ack,
    replies,
    ...extra,
  };
  const last = replies.filter((r) => r.npcName === npcName).pop();
  const text = String(last?.text || '');
  const anyText = replies.filter((r) => r.npcName === npcName).map((r) => r.text || '').join('\n');
  out.cited_marker = anyText.includes(MARKER);
  out.ok = out.cited_marker && replies.some((r) => r.npcName === npcName && !r.error);
  console.log(JSON.stringify(out));
  try { ws.close(); } catch (_) {}
  process.exit(out.ok ? 0 : 1);
}

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'player_chat',
      npcName,
      text: `I attached a file. Read it and tell me the secret marker inside — quote it exactly.`,
      attachments: [{
        name: 'probe.txt',
        mime: 'text/plain',
        size: MARKER.length + 80,
        data: textPayload,
      }],
    }));
  }, 600);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return; }
  if (m.type === 'player_chat_ack' && m.npcName === npcName) ack = true;
  if (m.type === 'player_chat_response' && m.npcName === npcName) {
    replies.push({
      npcName: m.npcName,
      text: String(m.text || '').slice(0, 4000),
      error: m.error || null,
    });
    const text = String(m.text || '');
    if (text.includes(MARKER) || text.length > 40) {
      setTimeout(() => finish({ done: 'response' }), 800);
    }
  }
});

ws.on('error', (e) => finish({ error: e.message }));
setTimeout(() => finish({ timedOut: true }), TIMEOUT_MS);
