'use strict';
/**
 * Phase 0.5: autonomous think -> run_skill (no player_chat).
 * Sends npc_think cycles for Bob; collects npc_decision + telemetry signal.
 */
const WebSocket = require('ws');

const host = process.argv[2] || '127.0.0.1';
const port = process.argv[3] || '8888';
const cycles = Math.max(1, Math.min(12, Number(process.argv[4]) || 8));
const gapMs = Math.max(500, Number(process.argv[5]) || 2500);

const decisions = [];
let thinkSent = 0;
let ws;

function finish(extra = {}) {
  const runSkills = decisions.filter((d) => d.action === 'run_skill');
  console.log(JSON.stringify({
    cyclesRequested: cycles,
    thinkSent,
    decisions,
    runSkillDecisions: runSkills,
    ...extra,
  }));
  try { ws?.close(); } catch (_) {}
  process.exit(0);
}

function sendThink() {
  if (thinkSent >= cycles) return;
  thinkSent += 1;
  ws.send(JSON.stringify({
    type: 'npc_think',
    npcName: 'Bob',
    context: {
      urgentWake: true,
      wakeReason: 'phase05-autonomous-test',
      forceLlm: thinkSent >= 3,
    },
  }));
  if (thinkSent < cycles) {
    setTimeout(sendThink, gapMs);
  }
}

ws = new WebSocket(`ws://${host}:${port}/agent-ws`);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'visitor_register', is_ceo: true }));
  setTimeout(sendThink, 600);
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  if (m.type === 'npc_decision' && m.npcName === 'Bob' && m.decision) {
    const d = m.decision;
    decisions.push({
      action: d.action,
      skill: d.skill || null,
      thought: (d.thought || '').slice(0, 120),
      message: (d.message || '').slice(0, 120),
      taskPhase: d.taskPhase,
      _director: !!d._director,
      _throttled: !!d._throttled,
    });
    if (d.action === 'run_skill' && d.skill) {
      setTimeout(() => finish({ done: 'run_skill_decision' }), 3000);
    }
  }
});

ws.on('error', (e) => finish({ error: e.message }));

// After all thinks sent, wait for late decisions + skill execution
setTimeout(() => finish({ timedOut: true }), cycles * gapMs + 45000);
