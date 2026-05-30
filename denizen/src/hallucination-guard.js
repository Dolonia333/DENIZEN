'use strict';
/**
 * hallucination-guard.js — keep NPC autonomy honest.
 *
 * The worry: an NPC confidently claims "I fixed the bug", "the tests pass",
 * "research shows X" — when it did no such thing. Now that NPCs research and
 * build tools, an unchecked confident-but-wrong claim is the dangerous case.
 *
 * Two layers (cheap → expensive):
 *   1. EVIDENCE CHECK (deterministic, no LLM): a "completion" claim
 *      ("I fixed it", "tests pass", "done") with NO backing evidence (no skill
 *      result, no artifact this cycle) is unsupported. A "factual" claim
 *      ("research shows", "the data confirms") with no research is unverifiable.
 *      This catches the most common hallucination for free.
 *   2. MODEL VERIFIER (optional, gated): for claims that DO have evidence, ask
 *      a model whether the evidence actually supports the claim.
 *
 * This is a grounding check, not an oracle — the verifier can be wrong too. It
 * flags the obvious unsupported claims and feeds a "verify or retract" note
 * back into the NPC so it self-corrects, rather than silently asserting.
 */

// Claims that assert work was completed / something works.
const COMPLETION_RE = /\b(i (?:fixed|solved|completed|finished|implemented|built|deployed|resolved|wrote|created|set up)\b|it works\b|that works\b|works now\b|tests?\s+(?:pass|are passing|passed)\b|all (?:set|done|good)\b|up and running\b|is live\b|done\b|ready to go\b|good to go\b)/i;
// Claims that assert a fact / cite a source.
const FACTUAL_RE = /\b(the data shows|research shows|according to|studies show|i found that|it turns out|confirmed that|verified that|the docs say|documentation states|statistics show|\d+%\s)/i;

function _stats() {
  if (!_stats._s) _stats._s = { checked: 0, flagged: 0, byNpc: {} };
  return _stats._s;
}

/** Split text into rough sentences and return ones that make a verifiable claim. */
function extractClaims(text) {
  if (!text || typeof text !== 'string') return [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 6);
  const claims = [];
  for (const s of sentences) {
    if (COMPLETION_RE.test(s)) claims.push({ text: s.slice(0, 200), type: 'completion' });
    else if (FACTUAL_RE.test(s)) claims.push({ text: s.slice(0, 200), type: 'factual' });
  }
  return claims;
}

/**
 * Check an NPC's output for unsupported claims.
 *
 * @param {object} o
 *   text     — the NPC's message/report
 *   evidence — { hasSkillResult, hasResearch, hasArtifact, researchText? }
 *   npc      — name (for stats)
 *   verifyFn — optional async ({claim, evidence}) → {verdict, confidence, reason}
 * @returns {Promise<{claims, flagged, score, note}>}
 */
async function check({ text, evidence = {}, npc = 'unknown', verifyFn = null } = {}) {
  const claims = extractClaims(text);
  const s = _stats();
  if (!claims.length) return { claims: [], flagged: [], score: 0, note: '' };

  const results = [];
  for (const c of claims) {
    let verdict = 'supported', confidence = 0.5, reason = '';

    if (c.type === 'completion') {
      // Did they actually DO something this cycle to back a completion claim?
      if (!evidence.hasSkillResult && !evidence.hasArtifact) {
        verdict = 'unsupported';
        confidence = 0.85;
        reason = 'Claims work is done, but no tool ran and no artifact was produced this cycle.';
      }
    } else if (c.type === 'factual') {
      if (!evidence.hasResearch) {
        verdict = 'unverifiable';
        confidence = 0.7;
        reason = 'Cites a fact/source, but no research was done to back it.';
      }
    }

    // Layer 2: if there IS evidence and a verifier is available, check the match.
    if (verdict === 'supported' && verifyFn && (evidence.hasResearch || evidence.hasArtifact)) {
      try {
        const v = await verifyFn({ claim: c.text, evidence });
        if (v && v.verdict && v.verdict !== 'supported') {
          verdict = v.verdict; confidence = v.confidence ?? 0.6; reason = v.reason || 'Evidence does not clearly support the claim.';
        }
      } catch (_) { /* verifier optional */ }
    }

    results.push({ ...c, verdict, confidence, reason });
  }

  const flagged = results.filter(r => r.verdict !== 'supported');
  s.checked += claims.length;
  s.flagged += flagged.length;
  if (!s.byNpc[npc]) s.byNpc[npc] = { checked: 0, flagged: 0 };
  s.byNpc[npc].checked += claims.length;
  s.byNpc[npc].flagged += flagged.length;

  const score = claims.length ? flagged.length / claims.length : 0;
  const note = flagged.length
    ? `## GROUNDING CHECK — claims that aren't backed\n${flagged.map(f => `- You said: "${f.text}" — ${f.reason}`).join('\n')}\nEither actually DO it (run a skill / write the artifact / research it) and show the evidence, or don't claim it. Do not repeat an unbacked claim.\n\n`
    : '';

  return { claims: results, flagged, score, note };
}

/** Aggregate grounding stats — how often claims are flagged. Surfaced like
 *  parse-health so "is this NPC making things up?" is measurable. */
function getStats() {
  const s = _stats();
  return {
    checked: s.checked,
    flagged: s.flagged,
    flagRate: s.checked ? +(s.flagged / s.checked).toFixed(3) : 0,
    byNpc: s.byNpc,
  };
}

/** Prompt for the optional model verifier. */
function buildVerifyPrompt(claim, evidence) {
  const ev = (evidence.researchText || evidence.artifactText || '').slice(0, 2000) || '(no detailed evidence text)';
  return `A teammate claims: "${claim}"\n\nEvidence available:\n${ev}\n\nDoes the evidence support the claim? Reply ONLY JSON: {"verdict":"supported"|"unsupported"|"unverifiable","confidence":0..1,"reason":"short"}`;
}

module.exports = { extractClaims, check, getStats, buildVerifyPrompt, COMPLETION_RE, FACTUAL_RE };
