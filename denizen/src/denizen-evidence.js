'use strict';

/**
 * Evidence hooks (A+ P2.3) — grounding for “I shipped/deployed/fixed…” claims.
 *
 * Skill results already flow through:
 *   harness learning.injectSkillResult → npc-brains.injectSkillResult
 * which writes brains._evidenceLog (skillAt / researchAt / artifactAt).
 *
 * This module:
 *   - hasRecentEvidence(npc, { withinMs, kinds }, brains?) — read brains map
 *     or fall back to data/harness-learning.jsonl
 *   - softThoughtDisclaimer(text, hasEvidence) — thought-only note (never rewrite speech)
 *   - maybeQueueThoughtDisclaimer(brains, npc, speech) — queues next-think grounding
 *
 * Do NOT mutate spoken dialogue from getResponse; speech stays natural.
 * Unsupported completion claims get a soft note on the *next think* cycle.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEARNING_LOG = path.join(ROOT, 'data', 'harness-learning.jsonl');

const DEFAULT_WITHIN_MS = 3 * 60 * 1000;

/** Kinds map to npc-brains._evidenceLog timestamp keys. */
const KIND_TS_KEY = {
  skill: 'skillAt',
  research: 'researchAt',
  artifact: 'artifactAt',
};

/**
 * Completion / ship claims that should be evidence-backed when asserted as done.
 * Kept aligned with hallucination-guard completion spirit, focused on ship language.
 */
const SHIP_CLAIM_RE = /\b(?:i\s+)?(?:shipped|deployed|fixed|implemented|built|resolved|released|hotfixed)\b|\b(?:is\s+)?(?:live|in\s+prod(?:uction)?|shipped|deployed)\b|\btests?\s+(?:pass(?:ed|ing)?|are\s+passing)\b/i;

/**
 * Read raw evidence entry for an NPC from brains or learning log.
 * @param {string} npc
 * @param {object|null} brains - NpcBrainManager instance (optional)
 * @returns {{ skillAt?: number, researchAt?: number, artifactAt?: number, researchText?: string }|null}
 */
function getEvidenceEntry(npc, brains = null) {
  const name = String(npc || '').trim();
  if (!name) return null;

  if (brains?._evidenceLog) {
    try {
      const entry = brains._evidenceLog.get?.(name) || brains._evidenceLog[name];
      if (entry && typeof entry === 'object') return { ...entry };
    } catch (_) { /* fall through */ }
  }

  // File fallback: latest skill_result rows for this NPC from harness learning JSONL
  try {
    const lines = fs.readFileSync(LEARNING_LOG, 'utf8').split('\n').filter(Boolean);
    let skillAt = 0;
    let researchAt = 0;
    let researchText = '';
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
      try {
        const row = JSON.parse(lines[i]);
        if (String(row.npc || '') !== name) continue;
        if (row.type !== 'skill_result' && row.type !== 'skill') continue;
        const at = row.at ? Date.parse(row.at) : 0;
        if (!Number.isFinite(at) || at <= 0) continue;
        if (!skillAt) skillAt = at;
        const skill = String(row.skill || '').toLowerCase();
        if (skill === 'research' && !researchAt) {
          researchAt = at;
          researchText = String(row.preview || row.result || '').slice(0, 500);
        }
        if (skillAt && (researchAt || skill !== 'research')) break;
      } catch (_) { /* skip bad line */ }
    }
    if (skillAt || researchAt) {
      return {
        skillAt: skillAt || undefined,
        researchAt: researchAt || undefined,
        researchText: researchText || undefined,
      };
    }
  } catch (_) { /* no log */ }

  return null;
}

/**
 * @param {string} npc
 * @param {{ withinMs?: number, kinds?: string[] }} [opts]
 * @param {object|null} [brains]
 * @returns {boolean}
 */
function hasRecentEvidence(npc, opts = {}, brains = null) {
  const withinMs = Number(opts.withinMs);
  const window = Number.isFinite(withinMs) && withinMs > 0 ? withinMs : DEFAULT_WITHIN_MS;
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length
    ? opts.kinds.map((k) => String(k).toLowerCase())
    : ['skill', 'research', 'artifact'];

  const entry = getEvidenceEntry(npc, brains);
  if (!entry) return false;

  const now = Date.now();
  for (const kind of kinds) {
    const key = KIND_TS_KEY[kind] || kind;
    const ts = Number(entry[key]);
    if (Number.isFinite(ts) && ts > 0 && (now - ts) <= window) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function claimsShipOrFix(text) {
  return SHIP_CLAIM_RE.test(String(text || ''));
}

/**
 * Soft disclaimer for *thought* / next-think grounding only — never for speech.
 * @param {string} text - claimed speech or decision text
 * @param {boolean} hasEvidence
 * @returns {string} empty or a short markdown note
 */
function softThoughtDisclaimer(text, hasEvidence) {
  if (hasEvidence) return '';
  if (!claimsShipOrFix(text)) return '';
  return (
    '## Soft grounding (thought only)\n'
    + 'You asserted shipped/deployed/fixed (or similar) without recent skill/artifact evidence. '
    + 'On this cycle: either run real work (skill/report) or speak carefully — do not re-assert completion without proof.\n\n'
  );
}

/**
 * If speech claims completion without evidence, queue a thought-only note for next think.
 * Does not alter `speechText`.
 * @returns {string} the note queued (or '')
 */
function maybeQueueThoughtDisclaimer(brains, npcName, speechText) {
  if (!brains || !npcName) return '';
  const ok = hasRecentEvidence(npcName, {}, brains);
  const note = softThoughtDisclaimer(speechText, ok);
  if (!note) return '';
  try {
    if (brains._pendingGrounding && typeof brains._pendingGrounding.set === 'function') {
      const prev = brains._pendingGrounding.get(npcName) || '';
      brains._pendingGrounding.set(npcName, prev + note);
    }
  } catch (_) { /* optional */ }
  return note;
}

/**
 * Build the same evidence bag npc-brains uses for hallucination-guard.
 */
function evidenceBagFromEntry(entry, now = Date.now(), freshMs = DEFAULT_WITHIN_MS) {
  const ev = entry || {};
  return {
    hasSkillResult: !!(ev.skillAt && (now - ev.skillAt) < freshMs),
    hasResearch: !!(ev.researchAt && (now - ev.researchAt) < freshMs),
    hasArtifact: !!(ev.artifactAt && (now - ev.artifactAt) < freshMs),
    researchText: ev.researchText || '',
  };
}

module.exports = {
  DEFAULT_WITHIN_MS,
  SHIP_CLAIM_RE,
  LEARNING_LOG,
  getEvidenceEntry,
  hasRecentEvidence,
  claimsShipOrFix,
  softThoughtDisclaimer,
  maybeQueueThoughtDisclaimer,
  evidenceBagFromEntry,
};
