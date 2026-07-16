'use strict';

/**
 * Grok CLI mentor drainer — closes the cloud→local learning loop.
 *
 * Reads pending rows from grok-consult-queue.jsonl (NPCs self-trigger when stuck),
 * asks Grok CLI (`grok -p`), injects the answer into NPC memory, marks answered,
 * and logs to consult-improvement-log.jsonl for P4 ROI tracking.
 *
 * Safe by default: drainConsultQueue({ dryRun: true }).
 * Protected NPCs (abby/lucy/bouncer) are skipped — use the mentor panel for those.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_QUEUE_PATH = path.join(DATA_DIR, 'grok-consult-queue.jsonl');
const DEFAULT_LOG_PATH = path.join(DATA_DIR, 'consult-improvement-log.jsonl');
const PROTECTED_NPC_KEYS = new Set(['abby', 'lucy', 'bouncer']);

let denizenDb = null;
try { denizenDb = require('./denizen-db'); } catch (_) {}

let npcRoster = null;
try { npcRoster = require('./npc-roster'); } catch (_) {}

let memoryInject = null;
try { memoryInject = require('./npc-memory-inject'); } catch (_) {}

function defaultGrokBin() {
  if (process.env.GROK_BIN) return process.env.GROK_BIN;
  return path.join(os.homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok');
}

function readQueue(queuePath = DEFAULT_QUEUE_PATH) {
  try {
    const raw = fs.readFileSync(queuePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function writeQueue(rows, queuePath = DEFAULT_QUEUE_PATH) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(queuePath, body, 'utf8');
}

function npcKeyFromName(npcName) {
  const n = String(npcName || '').trim();
  const entries = npcRoster?.entries || [];
  const hit = entries.find((e) => e.display === n || e.folder === n.toLowerCase());
  return hit?.folder || n.toLowerCase();
}

function buildGrokPrompt(npc, question, context) {
  return (
    `You are Grok, mentoring a local AI teammate named ${npc} in the Denizen pixel office. `
    + `They asked: "${question}". Context: ${context || 'general office work'}.\n\n`
    + 'Give a DENSE, practical answer they can internalize and act on next think cycle. '
    + 'Prefer concrete steps and, where useful, [FACT:key] one-liners. No preamble, no fluff, '
    + 'under 180 words. Speak directly to them, teammate to teammate.'
  );
}

function loadTelemetryFacts() {
  try {
    const p = path.join(DATA_DIR, 'grok-telemetry-latest.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function answerFromTelemetry(npc, question) {
  const tel = loadTelemetryFacts();
  if (!tel) return null;
  const stats = (tel.npcs && (tel.npcs[npc] || Object.entries(tel.npcs).find(([k]) => k.toLowerCase() === String(npc).toLowerCase())?.[1])) || {};
  const facts = (tel.facts || []).filter((f) => String(f).toLowerCase().includes(String(npc).toLowerCase())).slice(0, 4);
  const lat = stats.avg_latency_ms ?? '?';
  const tin = stats.avg_tokens_in ?? stats.avg_tokens ?? '?';
  return [
    `Hey ${npc} — telemetry mentor (${tel.generatedAt || 'live'}):`,
    String(question || '').slice(0, 300),
    '',
    `Your slice: ${stats.count || '?'} events, ${lat}ms, ~${tin}t in.`,
    facts.length ? `Facts: ${facts.join(' | ')}` : 'Facts: compress context; ship one concrete outcome.',
    '',
    'Next cycle: (1) cut memory/map bloat, (2) no "continuing work" platitudes, (3) one real artifact/skill or desk deliverable.',
  ].join('\n').slice(0, 1800);
}

function askGrokCli(prompt, grokBin = defaultGrokBin(), timeoutMs = 180_000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(grokBin) && !process.env.GROK_BIN) {
      resolve('');
      return;
    }
    const proc = spawn(grokBin, ['-p', prompt], {
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      resolve('');
    }, timeoutMs);
    proc.stdout?.on('data', (c) => { stdout += c; });
    proc.stderr?.on('data', (c) => { stderr += c; });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    proc.on('close', () => {
      clearTimeout(timer);
      resolve(String(stdout || '').trim());
    });
  });
}

async function injectMentorMemory(npcName, answer, topic = 'grok-mentor-lesson') {
  const npcKey = npcKeyFromName(npcName);
  // Always write MEMORY.md so lessons survive without Supabase.
  if (memoryInject?.injectLesson) {
    const file = memoryInject.injectLesson(npcName, answer, {
      topic,
      source: 'grok-mentor-drainer',
      prefix: '[GROK MENTOR]',
    });
    if (file.ok) return { ok: true, npc_key: file.folder || npcKey, path: file.path, db: !!file.db };
  }
  const body = `[GROK MENTOR] ${String(answer).slice(0, 2000)}`;
  if (denizenDb?.enabled) {
    const row = await denizenDb.insertNpcMemory({
      npcKey,
      body,
      topic,
      outcome: 'mentor-lesson',
      source: 'grok-mentor-drainer',
    });
    return { ok: !!row, npc_key: npcKey, memory_id: row?.id || null };
  }
  return { ok: false, npc_key: npcKey, error: 'inject failed' };
}

function appendImprovementLog(entry, logPath = DEFAULT_LOG_PATH) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

function listPending(rows, limit = 5) {
  return rows.filter((r) => r.status === 'pending').slice(0, limit);
}

/**
 * Drain pending consults. Returns summary { processed, skipped, dryRun, details }.
 */
async function drainConsultQueue(opts = {}) {
  const dryRun = opts.dryRun !== false && opts.run !== true;
  const limit = Math.max(1, Number(opts.limit) || 5);
  const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
  const logPath = opts.logPath || DEFAULT_LOG_PATH;
  const askGrok = opts.askGrok || askGrokCli;
  const inject = opts.inject || injectMentorMemory;

  const rows = readQueue(queuePath);
  const pending = listPending(rows, limit);
  const details = [];
  let processed = 0;
  let skipped = 0;

  for (const row of pending) {
    const npc = String(row.npc || '').trim();
    const npcKey = npcKeyFromName(npc);
    const question = String(row.question || '').trim();
    const context = typeof row.context === 'string' ? row.context : '';
    const topic = row.topic || 'grok-mentor-lesson';

    if (!question) {
      skipped += 1;
      details.push({ npc, status: 'skipped', reason: 'empty question' });
      continue;
    }

    // Protected NPCs skip CLI but still get telemetry lessons into MEMORY.md.
    const protectedNpc = PROTECTED_NPC_KEYS.has(npcKey);

    if (dryRun) {
      details.push({ npc, status: 'dry_run', question: question.slice(0, 120), protected: protectedNpc });
      continue;
    }

    let answer = '';
    let answeredBy = 'telemetry-fallback';
    if (!protectedNpc) {
      answer = await askGrok(buildGrokPrompt(npc, question, context), opts.grokBin);
      if (answer) answeredBy = 'grok-cli';
    }
    if (!answer) {
      answer = answerFromTelemetry(npc, question) || (
        `Hey ${npc} — compress context, cut platitudes, and ship one concrete outcome next think. `
        + `Question was: ${question.slice(0, 200)}`
      );
      answeredBy = protectedNpc ? 'telemetry-protected' : 'telemetry-fallback';
    }

    let injected = false;
    try {
      const inj = await inject(npc, answer, topic);
      injected = !!inj?.ok;
    } catch (err) {
      details.push({ npc, status: 'inject_error', error: err?.message || String(err) });
    }

    row.status = 'answered';
    row.answer = String(answer).slice(0, 2000);
    row.answered_by = answeredBy;
    row.answered_at = new Date().toISOString();
    row.memory_injected = injected;
    if (injected) row.memory_injected_at = row.answered_at;

    appendImprovementLog({
      ts: row.answered_at,
      npc,
      question: question.slice(0, 150),
      answer_preview: String(answer).slice(0, 150),
      injected,
      source: 'grok-mentor-drainer',
      answered_by: answeredBy,
      expected: 'check next telemetry for lower latency/tokens + referencing this advice',
    }, logPath);

    processed += 1;
    details.push({ npc, status: 'answered', injected, answeredBy, preview: String(answer).slice(0, 120) });
  }

  if (!dryRun && processed > 0) {
    writeQueue(rows, queuePath);
  }

  return { processed, skipped, dryRun, pending: pending.length, details };
}

module.exports = {
  PROTECTED_NPC_KEYS,
  DEFAULT_QUEUE_PATH,
  DEFAULT_LOG_PATH,
  readQueue,
  writeQueue,
  listPending,
  buildGrokPrompt,
  askGrokCli,
  injectMentorMemory,
  drainConsultQueue,
};
