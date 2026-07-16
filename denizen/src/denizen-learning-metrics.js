'use strict';

/**
 * P2.1 learning closed-loop metrics — operator scorecard.
 *
 * Scans mentor/consult/harness JSONL logs (+ optional lesson-cite-events)
 * and produces a compact scorecard for harness status / ops dashboards.
 *
 *   buildLearningScorecard() → {
 *     ok, at, lessonsApplied24h, lessonsPending, citationHits, citationRate,
 *     consultAnswered, consultPending, notes
 *   }
 *
 * No GPU. CommonJS. Pure file I/O.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.join(__dirname, '..');
const MS_24H = 24 * 60 * 60 * 1000;

const CITE_HIT_RE = /\[LESSON\]|\blesson\b|mentor guidance|applying (the )?(mentor|lesson)|from (the )?mentor|consult lesson|harness lesson|grok mentor/i;
const SOFT_MISS_RE = /lesson:\s*consider applying recent mentor guidance/i;

function resolvePaths(opts = {}) {
  const root = opts.denizenRoot || DEFAULT_ROOT;
  const dataDir = opts.dataDir || path.join(root, 'data');
  return {
    root,
    dataDir,
    mentorLessons: opts.mentorLessonsPath || path.join(dataDir, 'mentor-lessons-applied.jsonl'),
    consultImprove: opts.consultImprovePath || path.join(dataDir, 'consult-improvement-log.jsonl'),
    harnessLearning: opts.harnessLearningPath || path.join(dataDir, 'harness-learning.jsonl'),
    citeEvents: opts.citeEventsPath || path.join(dataDir, 'lesson-cite-events.jsonl'),
    consultQueue: opts.consultQueuePath || path.join(dataDir, 'grok-consult-queue.jsonl'),
  };
}

/**
 * @param {string} p
 * @param {number} [max=5000]
 * @returns {object[]}
 */
function readJsonl(p, max = 5000) {
  try {
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const slice = lines.length > max ? lines.slice(-max) : lines;
    const out = [];
    for (const l of slice) {
      try {
        const row = JSON.parse(l);
        if (row && typeof row === 'object') out.push(row);
      } catch (_) { /* skip bad line */ }
    }
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Extract epoch ms from common timestamp fields.
 * @param {object} row
 * @returns {number|null}
 */
function rowTimeMs(row) {
  if (!row || typeof row !== 'object') return null;
  const raw = row.ts || row.at || row.timestamp || row.answered_at || row.memory_injected_at || null;
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {number|null} t
 * @param {number} now
 * @param {number} windowMs
 */
function withinWindow(t, now, windowMs) {
  if (t == null || !Number.isFinite(t)) return false;
  return t >= now - windowMs && t <= now + 60_000; // small clock skew
}

/**
 * Text blob looks like a voluntary lesson citation (not just the soft-check note).
 * @param {string} text
 */
function looksLikeCitation(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (SOFT_MISS_RE.test(s) && !/\[LESSON\]|\bapplying\b|\bmentor\b/i.test(s.replace(SOFT_MISS_RE, ''))) {
    // pure soft-miss append only
    return false;
  }
  return CITE_HIT_RE.test(s);
}

/**
 * Append a lesson citation outcome (from soft-check or audit).
 * @param {object} evt
 * @param {{ dataDir?: string, citeEventsPath?: string, denizenRoot?: string }} [opts]
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
function recordCiteEvent(evt = {}, opts = {}) {
  const paths = resolvePaths(opts);
  const soft = evt.soft === true
    || evt.outcome === 'soft_miss'
    || evt._lessonCiteSoft === true;
  // Soft-miss always loses; otherwise explicit cited flag or outcome wins.
  const cited = !soft && (evt.cited === true || evt.outcome === 'cited');
  const rec = {
    at: evt.at || new Date().toISOString(),
    npc: evt.npc || evt.npcName || null,
    cited,
    soft: !!soft,
    outcome: soft ? 'soft_miss' : (cited ? 'cited' : (evt.outcome || 'unknown')),
    lessonCount: Number(evt.lessonCount)
      || (Array.isArray(evt.lessons) ? evt.lessons.length : 0)
      || null,
    savePreview: String(evt.savePreview || evt.save || '').slice(0, 160),
    source: evt.source || 'soft-check',
  };
  try {
    fs.mkdirSync(path.dirname(paths.citeEvents), { recursive: true });
    fs.appendFileSync(paths.citeEvents, `${JSON.stringify(rec)}\n`, 'utf8');
    return { ok: true, path: paths.citeEvents };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Compute closed-loop learning metrics for the operator scorecard.
 *
 * @param {{
 *   denizenRoot?: string,
 *   dataDir?: string,
 *   now?: number,
 *   windowMs?: number,
 *   maxLines?: number,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   at: string,
 *   lessonsApplied24h: number,
 *   lessonsPending: number,
 *   citationHits: number,
 *   citationRate: number|null,
 *   consultAnswered: number,
 *   consultPending: number,
 *   notes: string[],
 *   windowHours?: number,
 *   citationAttempts?: number,
 *   error?: string,
 * }}
 */
function buildLearningScorecard(opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windowMs = Number.isFinite(opts.windowMs) && opts.windowMs > 0 ? opts.windowMs : MS_24H;
  const maxLines = Number.isFinite(opts.maxLines) ? opts.maxLines : 5000;
  const paths = resolvePaths(opts);
  const notes = [];

  try {
    const lessons = readJsonl(paths.mentorLessons, maxLines);
    const improve = readJsonl(paths.consultImprove, maxLines);
    const harness = readJsonl(paths.harnessLearning, maxLines);
    const cites = readJsonl(paths.citeEvents, maxLines);
    const queue = readJsonl(paths.consultQueue, maxLines);

    // ── lessons applied (24h) ──────────────────────────────────────────
    // Primary: mentor-lessons-applied.jsonl
    let lessonsApplied24h = 0;
    for (const r of lessons) {
      if (withinWindow(rowTimeMs(r), now, windowMs)) lessonsApplied24h += 1;
    }
    // Also count harness-learning type=lesson if not already covered by mentor log
    // (harness may log injects that dual-write; prefer not double-counting by
    // only adding harness lessons when mentor log is empty for the window).
    if (lessonsApplied24h === 0) {
      for (const r of harness) {
        const typ = String(r.type || '').toLowerCase();
        if (typ !== 'lesson' && typ !== 'mentor_lesson') continue;
        if (withinWindow(rowTimeMs(r), now, windowMs)) lessonsApplied24h += 1;
      }
      if (lessonsApplied24h > 0) notes.push('lessons_from_harness_learning');
    }

    // ── consult queue / improvement ────────────────────────────────────
    const pendingQueue = queue.filter((r) => String(r.status || '').toLowerCase() === 'pending');
    const answeredNoMem = queue.filter((r) => {
      const st = String(r.status || '').toLowerCase();
      return st === 'answered' && r.answer && !r.memory_injected;
    });
    const consultPending = pendingQueue.length;
    const lessonsPending = consultPending + answeredNoMem.length;

    // consultAnswered: prefer improvement log (injected true) within window,
    // fall back to full improve log count + queue answered with memory.
    let consultAnswered = 0;
    let improveInWindow = 0;
    for (const r of improve) {
      const t = rowTimeMs(r);
      const inWin = t == null ? true : withinWindow(t, now, windowMs);
      // Count rows that represent a answered consult (have answer / injected flag)
      if (r.injected === true || r.answer_preview || r.answer) {
        if (inWin) {
          consultAnswered += 1;
          improveInWindow += 1;
        }
      }
    }
    if (consultAnswered === 0) {
      // Fall back to queue answered
      for (const r of queue) {
        if (String(r.status || '').toLowerCase() !== 'answered') continue;
        if (withinWindow(rowTimeMs(r), now, windowMs) || rowTimeMs(r) == null) {
          consultAnswered += 1;
        }
      }
      if (consultAnswered > 0) notes.push('consult_answered_from_queue');
    } else if (improveInWindow === 0 && improve.length) {
      notes.push('consult_improve_missing_timestamps');
    }

    // ── citation hits / rate ───────────────────────────────────────────
    let citationHits = 0;
    let citationAttempts = 0;
    let citationSource = 'none';

    const citesInWindow = cites.filter((r) => {
      const t = rowTimeMs(r);
      // if no ts, still count (recent appends usually have at)
      return t == null || withinWindow(t, now, windowMs);
    });

    if (citesInWindow.length) {
      citationSource = 'cite_events';
      citationAttempts = citesInWindow.length;
      for (const r of citesInWindow) {
        const soft = r.soft === true || r.outcome === 'soft_miss';
        const hit = !soft && (r.cited === true || r.outcome === 'cited' || looksLikeCitation(r.savePreview || ''));
        if (hit) citationHits += 1;
      }
    } else {
      // Fallback estimate: scan harness-learning previews / save-like fields
      // and mentor-lessons previews are injects themselves — not citations.
      // Look for rows that look like post-inject saves mentioning lesson.
      const saveLike = [];
      for (const r of harness) {
        if (!withinWindow(rowTimeMs(r), now, windowMs) && rowTimeMs(r) != null) continue;
        const blob = [r.save, r.preview, r.thought, r.text, r.result].filter(Boolean).join(' ');
        if (!blob) continue;
        // Only count as attempt if it references lesson domain after inject
        if (CITE_HIT_RE.test(blob) || SOFT_MISS_RE.test(blob)) {
          saveLike.push(blob);
        }
      }
      // Also scan improve log answer_preview is mentor answer, not citation — skip.
      if (saveLike.length) {
        citationSource = 'harness_estimate';
        citationAttempts = saveLike.length;
        for (const blob of saveLike) {
          if (SOFT_MISS_RE.test(blob) && !looksLikeCitation(blob.replace(SOFT_MISS_RE, ' '))) {
            continue; // soft miss
          }
          if (looksLikeCitation(blob)) citationHits += 1;
        }
        notes.push('citation_rate_estimated_from_harness_log');
      } else if (lessonsApplied24h > 0) {
        notes.push('no_cite_events_yet');
      }
    }

    let citationRate = null;
    if (citationAttempts > 0) {
      citationRate = Number((citationHits / citationAttempts).toFixed(4));
    }

    // Health: ok when we can read logs and rate is null or ≥ 0
    const targetMet = citationRate == null ? null : citationRate >= 0.6;
    if (targetMet === false) notes.push('citation_rate_below_0.6_target');
    if (lessonsPending > 10) notes.push(`lessons_pending_high_${lessonsPending}`);
    if (consultPending > 15) notes.push(`consult_backlog_${consultPending}`);

    // Discord conversation sense + theme harvest (improve how AI talks)
    let discordFarm = null;
    let conversationSense = null;
    try {
      const farmMod = require('./denizen-discord-farm');
      const sc = farmMod.buildDiscordFarmScorecard({ windowMs });
      discordFarm = {
        enabled: sc.enabled,
        messages24h: sc.messages24h || 0,
        questions24h: sc.questions24h || 0,
        friction24h: sc.friction24h || 0,
        praise24h: sc.praise24h || 0,
        commands24h: sc.commands24h || 0,
        topicsHot: (sc.topicsHot || []).slice(0, 5),
      };
      if (sc.messages24h > 0) {
        notes.push(`conversation_themes_${sc.messages24h}_msgs`);
      }
      if (sc.friction24h > 0) {
        notes.push(`conversation_friction_${sc.friction24h}`);
      }
    } catch (_) {
      discordFarm = null;
    }
    try {
      const senseMod = require('./denizen-conversation-sense');
      const ssc = senseMod.buildSenseScorecard();
      conversationSense = {
        enabled: ssc.enabled,
        peopleKnown: ssc.peopleKnown || 0,
        communities: ssc.communities || 0,
        typeMix: (ssc.typeMix || []).slice(0, 6),
      };
      if (ssc.peopleKnown > 0) {
        notes.push(`conversation_styles_${ssc.peopleKnown}`);
      }
    } catch (_) {
      conversationSense = null;
    }

    const ok = true;

    return {
      ok,
      at: new Date(now).toISOString(),
      lessonsApplied24h,
      lessonsPending,
      citationHits,
      citationRate,
      consultAnswered,
      consultPending,
      notes,
      // Extra ops fields (non-breaking for consumers of the core shape)
      windowHours: Math.round(windowMs / 3600000),
      citationAttempts,
      citationSource,
      answeredWithoutMemory: answeredNoMem.length,
      targetCitationRate: 0.6,
      targetMet,
      discordFarm,
      conversationSense,
      paths: {
        mentorLessons: paths.mentorLessons,
        consultImprove: paths.consultImprove,
        harnessLearning: paths.harnessLearning,
        citeEvents: paths.citeEvents,
        consultQueue: paths.consultQueue,
      },
    };
  } catch (err) {
    return {
      ok: false,
      at: new Date(now).toISOString(),
      lessonsApplied24h: 0,
      lessonsPending: 0,
      citationHits: 0,
      citationRate: null,
      consultAnswered: 0,
      consultPending: 0,
      notes: ['scorecard_error'],
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  buildLearningScorecard,
  recordCiteEvent,
  readJsonl,
  rowTimeMs,
  looksLikeCitation,
  resolvePaths,
  MS_24H,
};
