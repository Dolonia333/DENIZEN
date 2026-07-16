'use strict';

/**
 * Mentor dialogue drainer — unsticks Grok↔Claude sessions stuck in awaiting_peers.
 *
 * Strategy:
 *  1. Fill missing grok_reply from live telemetry (analyzer-style advice) or Grok CLI.
 *  2. Fill missing claude_reply with a structured local synthesis if Claude is offline.
 *  3. Finalize sessions that have ≥1 peer reply so lessons reach NPC memory.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TELEMETRY_PATH = path.join(DATA_DIR, 'grok-telemetry-latest.json');

let mentor = null;
try { mentor = require('./denizen-mentor-dialogue'); } catch (_) {}

let denizenDb = null;
try { denizenDb = require('./denizen-db'); } catch (_) {}

let memoryInject = null;
try { memoryInject = require('./npc-memory-inject'); } catch (_) {}

function loadTelemetry() {
  try {
    if (!fs.existsSync(TELEMETRY_PATH)) return null;
    return JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function buildTelemetryReply(agent, session, tel) {
  const npc = session.npc || session.npc_key || 'teammate';
  const q = String(session.question || '').trim();
  const stats = (tel?.npcs && (tel.npcs[npc] || tel.npcs[String(npc).toLowerCase()])) || {};
  const facts = (tel?.facts || []).filter((f) => String(f).toLowerCase().includes(String(npc).toLowerCase())).slice(0, 4);
  const gen = tel?.generatedAt || 'unknown';
  const header = agent === 'claude'
    ? `Claude (structured mentor, offline-fill from live telemetry @ ${gen}):`
    : `Grok (direct mentor, telemetry-grounded @ ${gen}):`;
  const lines = [
    header,
    `Re: ${q.slice(0, 280)}`,
    '',
    stats.count
      ? `Metrics: ${stats.count} events, ${stats.avg_latency_ms || '?'}ms, ~${stats.avg_tokens_in || stats.avg_tokens || '?'}t in.`
      : 'Metrics: no per-NPC slice yet — still act on fleet facts.',
    facts.length ? `Facts:\n- ${facts.join('\n- ')}` : 'Facts: use fleet-wide compression + concrete outcomes.',
    '',
    agent === 'claude'
      ? [
          'Plan:',
          '1) Cap think context (memory 200–300 chars, last 2 chats, no full map unless moving).',
          '2) Each cycle: one concrete action + one non-platitude save line.',
          '3) If latency ≥4s or tokens_in ≥1.5k for two cycles, consult-mentors again with numbers.',
          '4) Prefer run_skill for real deliverables over "continuing work".',
        ].join('\n')
      : [
          'Do this now:',
          '- Compress context before the next think.',
          '- Stop re-narrating status; ship one artifact or CRM/research step.',
          '- If stuck, re-ask with live latency/token numbers attached.',
        ].join('\n'),
  ];
  return lines.join('\n').slice(0, 1800);
}

async function injectSynthesisMemory(session) {
  const npcKey = session.npc_key || String(session.npc || '').toLowerCase();
  const body = String(session.synthesis || '').slice(0, 1800);
  if (!npcKey || !body) return { ok: false };
  if (memoryInject?.injectLesson) {
    return memoryInject.injectLesson(session.npc || npcKey, body, {
      topic: session.topic || 'mentor-panel',
      source: 'mentor-dialogue-drainer',
      prefix: '[MENTOR PANEL]',
    });
  }
  if (!denizenDb?.enabled) return { ok: false };
  try {
    const row = await denizenDb.insertNpcMemory({
      npcKey,
      body: `[MENTOR PANEL] ${body}`,
      topic: session.topic || 'mentor-panel',
      outcome: 'mentor-synthesis',
      source: 'mentor-dialogue-drainer',
    });
    return { ok: !!row, memory_id: row?.id || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {{ dryRun?: boolean, run?: boolean, limit?: number, askGrok?: Function }} opts
 */
async function drainMentorDialogues(opts = {}) {
  if (!mentor) {
    return { ok: false, error: 'mentor module missing', processed: 0 };
  }
  const dryRun = opts.dryRun !== false && opts.run !== true;
  const limit = Math.max(1, Number(opts.limit) || 5);
  const tel = loadTelemetry();
  const pending = mentor.listPending({ limit: 50 }) || [];
  const details = [];
  let processed = 0;
  let finalized = 0;

  for (const session of pending.slice(0, limit * 2)) {
    if (processed >= limit) break;
    const id = session.id;
    if (!id) continue;
    const status = mentor.getSession?.(id) || session;
    let changed = false;

    if (!status.grok_reply) {
      const reply = buildTelemetryReply('grok', status, tel);
      if (dryRun) {
        details.push({ id, action: 'would_add_grok_reply', npc: status.npc });
      } else {
        mentor.addPeerReply(id, 'grok', reply);
        changed = true;
        details.push({ id, action: 'grok_reply', npc: status.npc });
      }
    }

    // Re-read after possible grok fill
    const mid = mentor.getSession(id) || status;
    if (!mid.claude_reply) {
      const reply = buildTelemetryReply('claude', mid, tel);
      if (dryRun) {
        details.push({ id, action: 'would_add_claude_reply', npc: mid.npc });
      } else {
        mentor.addPeerReply(id, 'claude', reply);
        changed = true;
        details.push({ id, action: 'claude_reply', npc: mid.npc });
      }
    }

    const after = mentor.getSession(id) || mid;
    if (after.grok_reply || after.claude_reply) {
      if (after.status !== 'finalized') {
        if (dryRun) {
          details.push({ id, action: 'would_finalize', npc: after.npc });
        } else {
          const fin = mentor.finalizeSession(id, null);
          if (fin?.ok) {
            finalized += 1;
            await injectSynthesisMemory(fin.session);
            details.push({ id, action: 'finalized', npc: after.npc });
          }
        }
        changed = true;
      }
    }

    if (changed) processed += 1;
  }

  return {
    ok: true,
    dryRun,
    processed,
    finalized,
    pending: pending.length,
    telemetryAt: tel?.generatedAt || null,
    details,
  };
}

module.exports = {
  drainMentorDialogues,
  buildTelemetryReply,
  loadTelemetry,
};
