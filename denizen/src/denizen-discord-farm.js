'use strict';

/**
 * Discord + chat data farm — privacy-aware ingest → JSONL lake → signals.
 *
 * Turns Discord (and optional office chat) into learning fuel for Denizen:
 *   data/discord-farm/messages-YYYY-MM-DD.jsonl
 *   data/discord-farm/signals.jsonl
 *   data/discord-farm/topics.json
 *
 * Not training weights on-disk. It:
 *  - captures structured chat events
 *  - redacts secrets
 *  - extracts topics / questions / friction keywords
 *  - feeds learning scorecard + optional harness-learning lessons
 *
 * Env:
 *   DISCORD_FARM=1|0          master switch (default on when module loads)
 *   DISCORD_FARM_BODY=1|0     store message body (default 1, redacted)
 *   DISCORD_FARM_DMS=0        include DMs (default 0)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const FARM_DIR = path.join(ROOT, 'data', 'discord-farm');
const HARNESS_LEARNING = path.join(ROOT, 'data', 'harness-learning.jsonl');

const SECRET_RE = [
  /\b(sk|pk|api|token|secret|password|passwd|bearer)[-_]?[a-z0-9]{8,}\b/gi,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // jwt-ish
  /discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi,
  /\b\d{17,20}\.[A-Za-z0-9_-]{20,}\b/g, // bot token-ish
];

const QUESTION_RE = /\?$|^(who|what|when|where|why|how|can|does|is|are|should|do)\b/i;
const FRICTION_RE = /\b(broken|bug|error|fail|stuck|help|crash|down|issue|problem|doesn't work|dont work|can't|cannot|wtf|annoyed|frustrated)\b/i;
const PRAISE_RE = /\b(thanks|thank you|love|great|awesome|solid|nice|fire|goated|perfect)\b/i;
const TOPIC_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'this', 'that',
  'with', 'you', 'we', 'i', 'me', 'my', 'our', 'your', 'be', 'are', 'was', 'were', 'at',
  'as', 'by', 'from', 'have', 'has', 'had', 'not', 'but', 'if', 'so', 'just', 'like',
  'can', 'will', 'would', 'could', 'should', 'im', "i'm", 'its', "it's", 'they', 'them',
]);

function farmEnabled() {
  const v = String(process.env.DISCORD_FARM ?? '1').trim().toLowerCase();
  return !/^(0|false|no|off)$/.test(v);
}

function storeBodies() {
  const v = String(process.env.DISCORD_FARM_BODY ?? '1').trim().toLowerCase();
  return !/^(0|false|no|off)$/.test(v);
}

function farmDms() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DISCORD_FARM_DMS || ''));
}

function ensureDir() {
  fs.mkdirSync(FARM_DIR, { recursive: true });
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function messagesPath(day = dayKey()) {
  return path.join(FARM_DIR, `messages-${day}.jsonl`);
}

function signalsPath() {
  return path.join(FARM_DIR, 'signals.jsonl');
}

function topicsPath() {
  return path.join(FARM_DIR, 'topics.json');
}

function redact(text) {
  let s = String(text || '');
  for (const re of SECRET_RE) s = s.replace(re, '[REDACTED]');
  return s.slice(0, 2000);
}

function hashUser(id) {
  return crypto.createHash('sha256').update(String(id || '')).digest('hex').slice(0, 12);
}

function extractTopics(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<@!?\d+>/g, ' ')
    .replace(/[^a-z0-9\s#-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 24 && !TOPIC_STOP.has(w));
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function appendJsonl(file, row) {
  ensureDir();
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

/**
 * Ingest one chat event from Discord (or office).
 * @param {object} evt
 * @returns {{ ok: boolean, signals?: string[] }}
 */
function ingestChatEvent(evt = {}) {
  if (!farmEnabled()) return { ok: false, reason: 'farm_off' };

  const ts = evt.ts || Date.now();
  const source = evt.source || 'discord';
  const guildId = evt.guildId || null;
  const channelId = evt.channelId || null;
  const isDm = !!evt.isDm;

  if (isDm && !farmDms()) return { ok: false, reason: 'dms_off' };
  if (evt.bot && !evt.includeBot) return { ok: false, reason: 'skip_bot' };

  const raw = String(evt.content || '').trim();
  if (!raw || raw.length < 2) return { ok: false, reason: 'empty' };
  // skip pure commands noise unless flagged
  if (!evt.keepCommands && /^[,/!]/.test(raw) && raw.length < 80) {
    // still count command usage lightly
  }

  const body = storeBodies() ? redact(raw) : null;
  const topics = extractTopics(raw);
  const signals = [];
  if (QUESTION_RE.test(raw)) signals.push('question');
  if (FRICTION_RE.test(raw)) signals.push('friction');
  if (PRAISE_RE.test(raw)) signals.push('praise');
  if (/https?:\/\//i.test(raw)) signals.push('link');
  if (raw.startsWith(',') || raw.startsWith('/')) signals.push('command');

  const row = {
    ts,
    at: new Date(ts).toISOString(),
    source,
    guildId,
    channelId,
    channelName: evt.channelName || null,
    guildName: evt.guildName || null,
    userHash: hashUser(evt.userId),
    displayName: evt.displayName ? String(evt.displayName).slice(0, 64) : null,
    isDm: !!isDm,
    len: raw.length,
    body,
    topics,
    signals,
    messageId: evt.messageId || null,
  };

  appendJsonl(messagesPath(dayKey(ts)), row);

  if (signals.length) {
    appendJsonl(signalsPath(), {
      ts,
      source,
      guildId,
      channelId,
      signals,
      topics: topics.slice(0, 5),
      preview: body ? body.slice(0, 160) : null,
    });
  }

  // Roll topics (cheap, best-effort)
  try {
    updateTopicRollup(topics, signals, ts);
  } catch (_) { /* ignore */ }

  // Promote repeated friction/questions into harness-learning every N hits
  try {
    maybeEmitLesson(row);
  } catch (_) { /* ignore */ }

  return { ok: true, signals, topics };
}

function updateTopicRollup(topics, signals, ts) {
  ensureDir();
  let data = { updatedAt: ts, topics: {} };
  try {
    if (fs.existsSync(topicsPath())) {
      data = JSON.parse(fs.readFileSync(topicsPath(), 'utf8'));
    }
  } catch (_) { /* reset */ }
  data.updatedAt = ts;
  data.topics = data.topics || {};
  for (const t of topics) {
    const cur = data.topics[t] || { count: 0, friction: 0, questions: 0, lastAt: 0 };
    cur.count += 1;
    if (signals.includes('friction')) cur.friction += 1;
    if (signals.includes('question')) cur.questions += 1;
    cur.lastAt = ts;
    data.topics[t] = cur;
  }
  // prune to top 200 by count
  const top = Object.entries(data.topics)
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 200);
  data.topics = Object.fromEntries(top);
  fs.writeFileSync(topicsPath(), JSON.stringify(data, null, 2), 'utf8');
}

const _lessonCooldown = new Map(); // topic -> last emit

function maybeEmitLesson(row) {
  if (!row.signals?.includes('friction') && !row.signals?.includes('question')) return;
  const key = (row.topics && row.topics[0]) || row.signals[0];
  if (!key) return;
  const now = row.ts || Date.now();
  const last = _lessonCooldown.get(key) || 0;
  if (now - last < 30 * 60 * 1000) return; // 30m per topic
  _lessonCooldown.set(key, now);

  // Only emit if topic is hot in rollup
  let count = 0;
  try {
    const data = JSON.parse(fs.readFileSync(topicsPath(), 'utf8'));
    count = data.topics?.[key]?.count || 0;
  } catch (_) {}
  if (count < 3 && !row.signals.includes('friction')) return;

  const lesson = {
    type: 'discord_farm_signal',
    ts: now,
    at: new Date(now).toISOString(),
    topic: key,
    signals: row.signals,
    source: 'discord-farm',
    guildId: row.guildId,
    preview: row.body ? row.body.slice(0, 200) : null,
    note: `Community signal from Discord: topic="${key}" signals=${(row.signals || []).join(',')}. Consider NPC knowledge / FAQ / product fix.`,
  };
  fs.mkdirSync(path.dirname(HARNESS_LEARNING), { recursive: true });
  fs.appendFileSync(HARNESS_LEARNING, `${JSON.stringify(lesson)}\n`, 'utf8');
}

/**
 * Scorecard for health / harness dashboards.
 */
function buildDiscordFarmScorecard(opts = {}) {
  const windowMs = opts.windowMs || 24 * 60 * 60 * 1000;
  const now = Date.now();
  const days = [];
  for (let i = 0; i < 3; i += 1) {
    days.push(dayKey(now - i * 86400000));
  }

  let messages24h = 0;
  let questions24h = 0;
  let friction24h = 0;
  let praise24h = 0;
  let commands24h = 0;
  const channelCounts = new Map();
  const topicHits = new Map();

  for (const day of days) {
    const p = messagesPath(day);
    if (!fs.existsSync(p)) continue;
    let raw = '';
    try { raw = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const t = row.ts || Date.parse(row.at) || 0;
      if (now - t > windowMs) continue;
      messages24h += 1;
      for (const s of row.signals || []) {
        if (s === 'question') questions24h += 1;
        if (s === 'friction') friction24h += 1;
        if (s === 'praise') praise24h += 1;
        if (s === 'command') commands24h += 1;
      }
      if (row.channelId) {
        channelCounts.set(row.channelId, (channelCounts.get(row.channelId) || 0) + 1);
      }
      for (const top of row.topics || []) {
        topicHits.set(top, (topicHits.get(top) || 0) + 1);
      }
    }
  }

  let topicsHot = [];
  try {
    const data = JSON.parse(fs.readFileSync(topicsPath(), 'utf8'));
    topicsHot = Object.entries(data.topics || {})
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
      .slice(0, 10)
      .map(([name, v]) => ({
        topic: name,
        count: v.count || 0,
        friction: v.friction || 0,
        questions: v.questions || 0,
      }));
  } catch (_) {
    topicsHot = [...topicHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));
  }

  const topChannels = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ channelId: id, count }));

  return {
    ok: true,
    enabled: farmEnabled(),
    at: now,
    windowHours: Math.round(windowMs / 3600000),
    messages24h,
    questions24h,
    friction24h,
    praise24h,
    commands24h,
    topicsHot,
    topChannels,
    paths: {
      farmDir: FARM_DIR,
      today: messagesPath(),
      signals: signalsPath(),
      topics: topicsPath(),
    },
    notes: [
      messages24h === 0
        ? 'No Discord farm rows yet — bot must be online with Message Content intent'
        : `Farming live: ${messages24h} messages / ${windowMs / 3600000}h`,
      friction24h > 0 ? `${friction24h} friction signals — check topicsHot for FAQ/product pain` : null,
    ].filter(Boolean),
  };
}

function readRecentMessages(limit = 50) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < 2 && out.length < limit; i += 1) {
    const p = messagesPath(dayKey(now - i * 86400000));
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    for (let j = lines.length - 1; j >= 0 && out.length < limit; j -= 1) {
      try { out.push(JSON.parse(lines[j])); } catch (_) { /* skip */ }
    }
  }
  return out;
}

module.exports = {
  farmEnabled,
  ingestChatEvent,
  buildDiscordFarmScorecard,
  readRecentMessages,
  redact,
  extractTopics,
  FARM_DIR,
  messagesPath,
  signalsPath,
  topicsPath,
};
