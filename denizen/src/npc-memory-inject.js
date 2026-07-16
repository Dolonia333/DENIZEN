'use strict';

/**
 * Always-on NPC memory injection for the intelligence loop.
 * Writes MEMORY.md even when Supabase/denizen-db is offline so mentor lessons
 * still land in the next think cycle.
 */

const fs = require('fs');
const path = require('path');

const NPCS_DIR = path.join(__dirname, '..', 'npcs');
const LESSON_LOG = path.join(__dirname, '..', 'data', 'mentor-lessons-applied.jsonl');

const DISPLAY_TO_FOLDER = {
  abby: 'abby',
  alex: 'alex',
  bob: 'bob',
  jenny: 'jenny',
  dan: 'dan',
  lucy: 'lucy',
  bouncer: 'bouncer',
  marcus: 'conference_man',
  conference_man: 'conference_man',
  sarah: 'conference_woman',
  conference_woman: 'conference_woman',
  edward: 'edward',
  josh: 'josh',
  molly: 'molly',
  oscar: 'oscar',
  pier: 'pier',
  rob: 'rob',
  roki: 'roki',
  grok: 'grok',
  claude: 'claude',
};

let denizenDb = null;
try { denizenDb = require('./denizen-db'); } catch (_) {}

let npcRoster = null;
try { npcRoster = require('./npc-roster'); } catch (_) {}

function resolveFolder(npcNameOrKey) {
  const raw = String(npcNameOrKey || '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/^xp_/, '');
  if (DISPLAY_TO_FOLDER[low]) return DISPLAY_TO_FOLDER[low];
  const hit = (npcRoster?.entries || []).find(
    (e) => e.folder === low
      || e.display?.toLowerCase() === low
      || e.display === raw,
  );
  return hit?.folder || (fs.existsSync(path.join(NPCS_DIR, low)) ? low : null);
}

function displayName(folder) {
  const hit = (npcRoster?.entries || []).find((e) => e.folder === folder);
  return hit?.display || folder;
}

/**
 * Inject a mentor/telemetry lesson into MEMORY.md (+ optional DB).
 * @returns {{ ok: boolean, folder?: string, path?: string, db?: boolean, error?: string }}
 */
function injectLesson(npcNameOrKey, answer, opts = {}) {
  const folder = resolveFolder(npcNameOrKey);
  if (!folder) return { ok: false, error: 'unknown_npc' };
  const body = String(answer || '').trim();
  if (!body) return { ok: false, error: 'empty_body', folder };

  const topic = String(opts.topic || 'mentor-lesson').slice(0, 48);
  const source = String(opts.source || 'intelligence-loop').slice(0, 48);
  const prefix = opts.prefix || '[GROK MENTOR]';
  const line = `${prefix} ${body}`.replace(/\s+/g, ' ').slice(0, 900);
  const memPath = path.join(NPCS_DIR, folder, 'MEMORY.md');
  const ts = new Date().toISOString().slice(0, 16);

  try {
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    let existing = '';
    try { existing = fs.readFileSync(memPath, 'utf8'); } catch (_) {}
    const lines = existing.split('\n').filter((l) => l.trim());
    const entry = `- [${ts}] ${line}`;
    // Soft-cap growth
    let out;
    if (lines.length > 120) {
      const header = lines.slice(0, 2);
      const recent = lines.slice(-40);
      out = [...header, `- [${ts}] [ARCHIVE] older mentor lessons compacted`, ...recent, entry].join('\n') + '\n';
    } else {
      out = (existing.endsWith('\n') || !existing ? existing : existing + '\n') + entry + '\n';
    }
    fs.writeFileSync(memPath, out, 'utf8');

    // Hot-reload in-process brains if available
    try {
      const mgr = globalThis.__DenizenNpcBrains || globalThis.DenizenNpcBrains;
      const name = displayName(folder);
      if (mgr?.brains?.[name]) {
        mgr.brains[name].longTermMemory = fs.readFileSync(memPath, 'utf8');
      } else if (mgr?.brains) {
        // try folder key variants
        for (const [k, brain] of Object.entries(mgr.brains)) {
          if (String(k).toLowerCase() === name.toLowerCase() || mgr._nameToFolder?.[k] === folder) {
            brain.longTermMemory = fs.readFileSync(memPath, 'utf8');
          }
        }
      }
    } catch (_) {}

    let dbOk = false;
    if (denizenDb?.enabled && denizenDb.orgId) {
      denizenDb.insertNpcMemory({
        orgId: denizenDb.orgId,
        npcKey: folder,
        body: line.slice(0, 2000),
        topic,
        outcome: 'mentor-lesson',
        source,
      }).then((row) => { dbOk = !!row; }).catch(() => {});
    }

    try {
      fs.mkdirSync(path.dirname(LESSON_LOG), { recursive: true });
      fs.appendFileSync(
        LESSON_LOG,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          npc: displayName(folder),
          folder,
          topic,
          source,
          preview: line.slice(0, 160),
        })}\n`,
        'utf8',
      );
    } catch (_) {}

    return { ok: true, folder, path: memPath, db: dbOk };
  } catch (err) {
    return { ok: false, folder, error: err?.message || String(err) };
  }
}

/**
 * Re-inject answered consult rows that never landed in MEMORY.md.
 */
function backfillAnsweredConsults(opts = {}) {
  const queuePath = opts.queuePath || path.join(__dirname, '..', 'data', 'grok-consult-queue.jsonl');
  const limit = Math.max(1, Number(opts.limit) || 20);
  if (!fs.existsSync(queuePath)) return { ok: true, injected: 0 };
  const rows = fs.readFileSync(queuePath, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);

  let injected = 0;
  const details = [];
  for (const row of rows.slice().reverse()) {
    if (injected >= limit) break;
    if (row.status !== 'answered' || !row.answer) continue;
    if (row.memory_injected) continue;
    const r = injectLesson(row.npc, row.answer, {
      topic: row.topic || 'consult-backfill',
      source: row.answered_by || 'consult-backfill',
      prefix: '[CONSULT LESSON]',
    });
    if (r.ok) {
      row.memory_injected = true;
      row.memory_injected_at = new Date().toISOString();
      injected += 1;
      details.push({ npc: row.npc, folder: r.folder });
    }
  }

  if (injected > 0) {
    fs.writeFileSync(
      queuePath,
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
      'utf8',
    );
  }
  return { ok: true, injected, details };
}

module.exports = {
  resolveFolder,
  injectLesson,
  backfillAnsweredConsults,
  DISPLAY_TO_FOLDER,
};
