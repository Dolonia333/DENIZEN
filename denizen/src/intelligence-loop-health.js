'use strict';

/**
 * Snapshot health of the intelligence flywheel for ops / UI.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readJsonl(p, max = 500) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const slice = lines.slice(-max);
    return slice.map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function ageMin(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

function buildHealth() {
  const telPath = path.join(DATA, 'grok-telemetry-latest.json');
  const queuePath = path.join(DATA, 'grok-consult-queue.jsonl');
  const dialoguePath = path.join(DATA, 'mentor-dialogue.jsonl');
  const improvePath = path.join(DATA, 'consult-improvement-log.jsonl');
  const lessonsPath = path.join(DATA, 'mentor-lessons-applied.jsonl');

  const tel = readJson(telPath);
  const queue = readJsonl(queuePath, 400);
  const dialogue = readJsonl(dialoguePath, 80);
  const improve = readJsonl(improvePath, 40);
  const lessons = readJsonl(lessonsPath, 40);

  const pending = queue.filter((r) => r.status === 'pending');
  const answered = queue.filter((r) => r.status === 'answered');
  const answeredNoMem = answered.filter((r) => r.answer && !r.memory_injected);
  const awaitingPeers = dialogue.filter((s) => s.status === 'awaiting_peers' || (!s.finalized_at && s.status !== 'finalized'));
  const finalized = dialogue.filter((s) => s.status === 'finalized' || s.finalized_at);

  const telAge = ageMin(tel?.generatedAt || tel?.jobRanAt);
  const facts = tel?.facts || [];
  const live = String(tel?.source || '').includes('live') || (tel?.entries_analyzed > 0);

  const issues = [];
  if (!tel) issues.push('missing_telemetry_file');
  if (telAge == null) issues.push('telemetry_no_timestamp');
  else if (telAge > 30) issues.push(`telemetry_stale_${telAge}m`);
  if (!live && facts.some((f) => /109 ev, 4197ms|July|canned/i.test(f))) {
    issues.push('canned_facts_detected');
  }
  if (pending.length > 15) issues.push(`consult_backlog_${pending.length}`);
  if (answeredNoMem.length > 5) issues.push(`answered_without_memory_${answeredNoMem.length}`);
  if (awaitingPeers.length > 0) issues.push(`mentor_awaiting_peers_${awaitingPeers.length}`);

  const ok = issues.length === 0
    || (issues.length === 1 && issues[0].startsWith('telemetry_stale') && telAge < 90);

  return {
    ok,
    at: new Date().toISOString(),
    telemetry: {
      path: telPath,
      generatedAt: tel?.generatedAt || null,
      ageMinutes: telAge,
      source: tel?.source || null,
      entriesAnalyzed: tel?.entries_analyzed ?? null,
      factCount: facts.length,
      npcCount: Object.keys(tel?.npcs || {}).length,
      live,
    },
    consultQueue: {
      pending: pending.length,
      answered: answered.length,
      answeredWithoutMemory: answeredNoMem.length,
      recentPending: pending.slice(-5).map((r) => ({ npc: r.npc, source: r.source, ts: r.ts })),
    },
    mentorDialogue: {
      awaitingPeers: awaitingPeers.length,
      finalized: finalized.length,
      openIds: awaitingPeers.slice(0, 5).map((s) => s.id),
    },
    lessonsApplied: lessons.slice(-5),
    recentImprovements: improve.slice(-5).map((r) => ({
      npc: r.npc,
      injected: r.injected,
      source: r.source,
      ts: r.ts,
    })),
    issues,
  };
}

module.exports = { buildHealth };
