'use strict';

/**
 * Structured chat reply schema + tolerant parser (A+ Plan P1.1).
 * Models may emit JSON, fenced JSON, or plain dialogue — parseChatReply
 * always returns a safe { reply, tone, next_action } for speech paths.
 */

const REPLY_MAX = 500;

/** LM Studio / OpenAI json_schema for player & peer chat. */
const CHAT_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'Spoken dialogue only (may end with [ACTION:...] / [DELEGATE:...] tags). No stage directions.',
    },
    tone: {
      type: 'string',
      description: 'Optional short mood/tone label (e.g. calm, urgent, warm).',
    },
    next_action: {
      type: 'string',
      description: 'Optional follow-up intent (e.g. wait, work, escalate) — not spoken aloud.',
    },
  },
  required: ['reply'],
  additionalProperties: true,
};

const CHAT_KINDS = new Set(['chat', 'player_chat', 'peer_chat']);

/**
 * Whether this LM call kind should request CHAT_REPLY_SCHEMA.
 * @param {string} [kind]
 * @returns {boolean}
 */
function isChatKind(kind) {
  return CHAT_KINDS.has(String(kind || '').toLowerCase());
}

/**
 * Cap reply length without chopping mid-[ACTION:…] / [DELEGATE:…] tags when possible.
 * @param {string} reply
 * @param {number} [max]
 * @returns {string}
 */
function capReply(reply, max = REPLY_MAX) {
  const s = String(reply || '');
  if (s.length <= max) return s;
  // Prefer cutting before the first tag if tags would be truncated mid-stream.
  const tagAt = s.search(/\s*\[(?:ACTION|DELEGATE|RUN_SKILL):/i);
  if (tagAt > 40 && tagAt < max) {
    return s.slice(0, tagAt).trim();
  }
  return s.slice(0, max).trim();
}

/**
 * Strip markdown fences and try to recover a JSON object from model output.
 * @param {string} raw
 * @returns {object|null}
 */
function tryParseJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!s) return null;

  // Direct parse
  try {
    const v = JSON.parse(s);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (_) {}

  // First balanced {...}
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const chunk = s.slice(start, i + 1);
        try {
          const v = JSON.parse(chunk);
          if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        } catch (_) {
          // trailing commas / smart quotes
          try {
            const repaired = chunk
              .replace(/,\s*([}\]])/g, '$1')
              .replace(/[\u201c\u201d]/g, '"')
              .replace(/[\u2018\u2019]/g, "'");
            const v2 = JSON.parse(repaired);
            if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) return v2;
          } catch (_2) {}
        }
        break;
      }
    }
  }
  return null;
}

/**
 * Strip residual JSON wrapper junk when parse fails so speech never leaks braces.
 * @param {string} text
 * @returns {string}
 */
function stripJsonJunk(text) {
  let s = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  // {"reply":"..."} style leftovers
  const m = s.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch (_) {
      return m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
    }
  }
  // Bare object noise at start/end
  s = s.replace(/^\s*\{\s*/, '').replace(/\s*\}\s*$/, '');
  s = s.replace(/^["']|["']$/g, '').trim();
  return s;
}

/**
 * Parse model chat output into structured fields.
 * Always returns speech-safe `reply` (≤500 chars). Never throws.
 *
 * @param {string} text
 * @returns {{ reply: string, tone: string|null, next_action: string|null }}
 */
function parseChatReply(text) {
  const empty = { reply: '', tone: null, next_action: null };
  if (text == null) return empty;
  const raw = typeof text === 'string' ? text : String(text);
  if (!raw.trim()) return empty;

  const obj = tryParseJsonObject(raw);
  if (obj) {
    const replyRaw = obj.reply != null
      ? obj.reply
      : (obj.message != null ? obj.message : (obj.text != null ? obj.text : ''));
    let reply = String(replyRaw || '').trim();
    // If schema-shaped but empty reply, fall back to whole string strip
    if (!reply) reply = stripJsonJunk(raw);
    const tone = obj.tone != null && String(obj.tone).trim()
      ? String(obj.tone).trim().slice(0, 64)
      : null;
    const next = obj.next_action != null
      ? obj.next_action
      : (obj.nextAction != null ? obj.nextAction : null);
    const next_action = next != null && String(next).trim()
      ? String(next).trim().slice(0, 120)
      : null;
    return {
      reply: capReply(reply),
      tone,
      next_action,
    };
  }

  // Plain text / junk — treat as dialogue
  let reply = stripJsonJunk(raw);
  // Drop obvious key:value lines that aren't speech
  if (/^\s*\{[\s\S]*\}\s*$/.test(reply) || /"reply"\s*:/i.test(reply)) {
    reply = stripJsonJunk(reply);
  }
  reply = reply.replace(/\s{2,}/g, ' ').trim();
  return {
    reply: capReply(reply),
    tone: null,
    next_action: null,
  };
}

// ── P2.1 lesson citation helpers ───────────────────────────────────────────

const LESSON_LINE_RE = /\[HARNESS LESSON\]|\[GROK MENTOR\]|\[CONSULT LESSON\]|\[GROK-TELEMETRY/i;
const MENTOR_LINE_RE = /\bmentor\b/i;

/**
 * Pull recent mentor/harness lesson lines from MEMORY text (or inject blob).
 * @param {string} memoryText
 * @param {number} [limit=5]
 * @returns {string[]}
 */
function extractRecentLessons(memoryText, limit = 5) {
  const lines = String(memoryText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const hits = [];
  for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
    const line = lines[i];
    if (LESSON_LINE_RE.test(line) || (MENTOR_LINE_RE.test(line) && /lesson|consult|applied|guidance/i.test(line))) {
      hits.unshift(line.replace(/^[-*]\s*/, '').slice(0, 220));
    }
  }
  return hits;
}

/**
 * Prompt block telling the model to cite lessons when present.
 * @param {string[]} lessons
 * @returns {string}
 */
function lessonsPromptBlock(lessons) {
  if (!Array.isArray(lessons) || !lessons.length) return '';
  const body = lessons.map((l) => `- ${l}`).join('\n');
  return `## Lessons to apply — you MUST reference at least one if relevant in reasoning or save\n${body}\n`;
}

/**
 * Soft-check after think: if lessons were present but neither thought nor save
 * mentions lesson/mentor keywords (or lesson content), append a note to save.
 * Does not fail the think.
 *
 * @param {object} decision
 * @param {string[]} lessons
 * @returns {object} decision (mutated)
 */
function softCheckLessonCitation(decision, lessons) {
  if (!decision || !Array.isArray(lessons) || !lessons.length) return decision;
  const blob = [
    decision.thought,
    decision.reasoning,
    decision.save,
    decision.message,
  ].filter(Boolean).join(' ').toLowerCase();

  const genericCite = /lesson|mentor|harness lesson|grok mentor|consult lesson|telemetry lesson|learned|applying guidance|from (the )?mentor/i;
  let cited = genericCite.test(blob);

  if (!cited) {
    for (const L of lessons) {
      const body = String(L)
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .toLowerCase();
      const words = body.split(/\s+/).filter((w) => w.length >= 6).slice(0, 8);
      if (words.some((w) => blob.includes(w))) {
        cited = true;
        break;
      }
    }
  }

  if (!cited) {
    const note = ' [lesson: consider applying recent mentor guidance]';
    decision.save = `${String(decision.save || '').trim()}${note}`.trim();
    decision._lessonCiteSoft = true;
  }
  return decision;
}

module.exports = {
  CHAT_REPLY_SCHEMA,
  CHAT_KINDS,
  REPLY_MAX,
  isChatKind,
  parseChatReply,
  capReply,
  extractRecentLessons,
  lessonsPromptBlock,
  softCheckLessonCitation,
};
