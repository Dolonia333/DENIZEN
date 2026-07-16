'use strict';

/**
 * P1.3 Retrieval memory — top-k relevant MEMORY.md lines for think/chat.
 *
 * Keyword/TF overlap scoring by default (no GPU). Optional embedding path
 * only when denizen-embedding-worker is available and opts.useEmbeddings.
 * Never blocks offline boot.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_K = 8;
const DEFAULT_MAX_CHARS = 1200;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are',
  'was', 'were', 'be', 'been', 'with', 'at', 'by', 'from', 'as', 'it', 'this',
  'that', 'you', 'your', 'i', 'we', 'they', 'have', 'has', 'had', 'do', 'does',
  'did', 'not', 'but', 'if', 'so', 'than', 'then', 'my', 'me', 'our', 'their',
  'just', 'into', 'about', 'over', 'out', 'up', 'down', 'will', 'can', 'could',
  'should', 'would', 'may', 'might', 'been', 'being', 'its', 'also', 'very',
]);

/** Common English stopwords + memory-format noise tokens */
const NOISE_TOKENS = new Set(['outcome', 'ok', 'fact', 'lesson', 'skill', 'save']);

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-\[\]:./]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\[+|\]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !NOISE_TOKENS.has(t));
}

/**
 * Split MEMORY.md (or any memory blob) into non-empty lines.
 * @param {string} text
 * @returns {string[]}
 */
function parseMemoryLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Simple TF / keyword overlap score between query and a memory line.
 * No embeddings required.
 * @param {string} query
 * @param {string} line
 * @returns {number}
 */
function scoreLine(query, line) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const lineStr = String(line || '');
  const lineLower = lineStr.toLowerCase();
  const lineTokens = tokenize(lineStr);
  if (!lineTokens.length && !lineLower.trim()) return 0;

  const tf = new Map();
  for (const t of lineTokens) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  let matched = 0;
  const seen = new Set();
  for (const t of qTokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    const weight = t.length >= 6 ? 1.6 : t.length >= 4 ? 1.2 : 1;
    if (tf.has(t)) {
      score += Math.min(3, tf.get(t)) * weight;
      matched += 1;
    } else if (lineLower.includes(t)) {
      score += 0.45 * weight;
      matched += 1;
    }
  }

  if (matched === 0) return 0;

  // Coverage of unique query terms
  score += (matched / seen.size) * 0.75;

  // Durable / high-signal tags
  if (/\[(FACT|LESSON|SKILL|COMMIT|GROK MENTOR|MENTOR)/i.test(lineStr)) score += 0.35;
  if (/\[OUTCOME:/i.test(lineStr)) score += 0.1;

  return score;
}

/**
 * Resolve display name or folder key to MEMORY.md path.
 * @param {string} npcNameOrFolder
 * @param {{ npcsDir?: string }} [opts]
 * @returns {string|null}
 */
function resolveMemoryPath(npcNameOrFolder, opts = {}) {
  const key = String(npcNameOrFolder || '').trim();
  if (!key) return null;
  const npcsDir = opts.npcsDir || path.join(__dirname, '..', 'npcs');
  let folder = key.toLowerCase().replace(/\s+/g, '_');

  try {
    const roster = require('./npc-roster');
    const entries = roster.entries || [];
    const entry = entries.find(
      (e) =>
        e.folder === folder
        || e.display.toLowerCase() === key.toLowerCase()
        || e.textureKey === key
        || e.assetName?.toLowerCase() === key.toLowerCase(),
    );
    if (entry) folder = entry.folder;
  } catch (_) {
    // roster optional in unit tests
  }

  return path.join(npcsDir, folder, 'MEMORY.md');
}

/**
 * Pick top-k lines by score (or recency if no scores), cap by maxChars.
 * @param {string[]} lines
 * @param {string} query
 * @param {{ k?: number, maxChars?: number }} [opts]
 */
function selectTopLines(lines, query, opts = {}) {
  const k = Math.max(1, Number(opts.k) || DEFAULT_K);
  const maxChars = Math.max(80, Number(opts.maxChars) || DEFAULT_MAX_CHARS);
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return { text: '', lines: [], scores: [] };

  const scored = list.map((line, idx) => ({
    line,
    idx,
    score: scoreLine(query, line),
  }));

  const anyScore = scored.some((s) => s.score > 0);
  let picked;
  if (!anyScore || !String(query || '').trim()) {
    // Recency fallback — last k lines
    picked = scored.slice(-k).map((s) => ({ ...s, score: s.score || 0 }));
  } else {
    picked = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.idx - a.idx))
      .slice(0, k)
      // Restore chronological order for readable prompt context
      .sort((a, b) => a.idx - b.idx);
  }

  // Fit maxChars by dropping oldest first
  let out = picked.slice();
  while (out.length > 1 && out.map((s) => s.line).join('\n').length > maxChars) {
    out.shift();
  }
  let text = out.map((s) => s.line).join('\n');
  if (text.length > maxChars) {
    text = text.slice(-maxChars);
  }

  return {
    text,
    lines: out.map((s) => s.line),
    scores: out.map((s) => ({ score: s.score, idx: s.idx })),
  };
}

/**
 * Build a retrieval query from office/chat bag fields.
 * @param {Record<string, unknown>} parts
 * @returns {string}
 */
function buildQueryFromContext(parts = {}) {
  const bag = parts && typeof parts === 'object' ? parts : {};
  const chunks = [
    bag.message,
    bag.fromName,
    bag.playerName,
    bag.task,
    bag.thought,
    bag.action,
    bag.directive,
    bag.goal,
    bag.location,
    bag.currentRoom,
    bag.description,
    bag.recentChat,
    bag.skill,
  ]
    .map((c) => (c == null ? '' : String(c).trim()))
    .filter(Boolean);
  return chunks.join(' ').replace(/\s+/g, ' ').slice(0, 600);
}

/**
 * Retrieve top-k relevant memory lines for an NPC.
 *
 * @param {string} npcNameOrFolder - display name or folder (e.g. "Lucy" / "lucy")
 * @param {string} query - free-text query (message, office context, etc.)
 * @param {{
 *   k?: number,
 *   maxChars?: number,
 *   text?: string,
 *   npcsDir?: string,
 *   useEmbeddings?: boolean,
 * }} [opts]
 *   - text: use this blob instead of reading MEMORY.md (preferred when brain already loaded)
 *   - useEmbeddings: attempt embedding worker (ignored if unavailable / fails)
 * @returns {{ text: string, lines: string[], count: number, source: string, scores?: Array }}
 */
function retrieveMemory(npcNameOrFolder, query, opts = {}) {
  const k = Math.max(1, Number(opts.k) || DEFAULT_K);
  const maxChars = Math.max(80, Number(opts.maxChars) || DEFAULT_MAX_CHARS);

  let raw = opts.text;
  let source = 'text';
  if (raw == null) {
    source = 'file';
    const memPath = resolveMemoryPath(npcNameOrFolder, opts);
    if (!memPath) {
      return { text: '', lines: [], count: 0, source: 'missing' };
    }
    try {
      if (!fs.existsSync(memPath)) {
        return { text: '', lines: [], count: 0, source: 'missing' };
      }
      raw = fs.readFileSync(memPath, 'utf8');
    } catch (err) {
      return {
        text: '',
        lines: [],
        count: 0,
        source: 'error',
        error: err?.message || String(err),
      };
    }
  }

  const lines = parseMemoryLines(raw);
  if (!lines.length) {
    return { text: '', lines: [], count: 0, source: 'empty' };
  }

  // v1: keyword scoring only. Embeddings are optional and never required for boot.
  // If useEmbeddings is set, we still fall through to keyword for reliability
  // (embedding worker needs a live inference runtime and is async).
  const selected = selectTopLines(lines, query, { k, maxChars });
  return {
    text: selected.text,
    lines: selected.lines,
    count: selected.lines.length,
    source,
    scores: selected.scores,
    method: 'keyword',
  };
}

/**
 * Sync helper used by npc-brains: retrieve or fall back to last-N chars.
 * Never throws.
 *
 * @param {string} npcNameOrFolder
 * @param {string} query
 * @param {{ k?: number, maxChars?: number, text?: string, npcsDir?: string }} [opts]
 * @returns {string}
 */
function retrieveMemoryOrFallback(npcNameOrFolder, query, opts = {}) {
  const maxChars = Math.max(80, Number(opts.maxChars) || DEFAULT_MAX_CHARS);
  try {
    const q = String(query || '').trim();
    if (q) {
      const result = retrieveMemory(npcNameOrFolder, q, opts);
      if (result?.text && result.text.trim()) return result.text;
    }
  } catch (_) {
    // fall through
  }

  // last-N chars fallback
  let raw = opts.text;
  if (raw == null) {
    try {
      const memPath = resolveMemoryPath(npcNameOrFolder, opts);
      if (memPath && fs.existsSync(memPath)) raw = fs.readFileSync(memPath, 'utf8');
    } catch (_) {
      raw = '';
    }
  }
  const s = String(raw || '');
  if (!s) return '';
  return s.length > maxChars ? s.slice(-maxChars) : s;
}

module.exports = {
  parseMemoryLines,
  scoreLine,
  retrieveMemory,
  retrieveMemoryOrFallback,
  resolveMemoryPath,
  selectTopLines,
  buildQueryFromContext,
  tokenize,
  DEFAULT_K,
  DEFAULT_MAX_CHARS,
};
