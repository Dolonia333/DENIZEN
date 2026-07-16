'use strict';

/**
 * Conversation sense — learn how real people talk so Denizen can respond better.
 *
 * Not "farming data" for its own sake. Goal:
 *   - notice different communication styles (people types)
 *   - adapt tone, length, and energy per person + per community
 *   - feel more real without training model weights on chats
 *
 * Privacy: user ids hashed, message bodies not stored here (features only).
 * Storage:
 *   data/conversation-sense/people.json     # hashed user → style profile
 *   data/conversation-sense/communities.json # guild → community voice
 *   data/conversation-sense/types.json      # rollup of people-type mix
 *
 * Env: DISCORD_FARM / DISCORD_SENSE=0 to disable (same master switch as harvest).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SENSE_DIR = path.join(ROOT, 'data', 'conversation-sense');
const PEOPLE_PATH = path.join(SENSE_DIR, 'people.json');
const COMMUNITIES_PATH = path.join(SENSE_DIR, 'communities.json');
const TYPES_PATH = path.join(SENSE_DIR, 'types.json');

/** Soft labels for communication style — not demographics. */
const TYPE_GUIDANCE = {
  concise: {
    label: 'concise',
    how: 'Keep replies short (1–3 sentences). No walls of text. Bullet only if asked.',
  },
  expressive: {
    label: 'expressive',
    how: 'Match energy a bit — warmer, light emoji ok, playful tone, still clear.',
  },
  technical: {
    label: 'technical',
    how: 'Be concrete and precise. Prefer steps, names of systems, and less fluff.',
  },
  social: {
    label: 'social',
    how: 'Friendly hangout energy. Small talk ok. Invite, don’t lecture.',
  },
  analytical: {
    label: 'analytical',
    how: 'Answer the question first, then optional why. Structured, calm, thorough if needed.',
  },
  frustrated: {
    label: 'frustrated',
    how: 'Empathize briefly, stay calm, offer a clear next step. No jokes first.',
  },
  warm: {
    label: 'warm',
    how: 'Appreciate them back. Supportive, human, not corporate.',
  },
  newcomer: {
    label: 'newcomer',
    how: 'Assume less context. Explain gently, offer one simple next action.',
  },
  balanced: {
    label: 'balanced',
    how: 'Natural friendly companion — clear, concise, slightly playful.',
  },
};

const CASUAL_RE = /\b(lol|lmao|rofl|ngl|fr|lowkey|highkey|bro|bruh|idk|imo|tbh|gonna|wanna|gotta|u|ur|rn|af|ye|yea|yep|nah|hella|sus|bet|goat|goated|fire|based)\b/i;
const TECH_RE = /\b(api|deploy|docker|k8s|error|stack|trace|git|npm|node|server|bug|latency|endpoint|json|oauth|sql|gpu|model|llm|token|ci|cd|pipeline|webhook|sso)\b/i;
const SOCIAL_RE = /\b(hey|hi|hello|sup|yo|morning|evening|gg|glhf|welcome|hang|vc|party|game|tonight|weekend|love|miss)\b/i;
const FRICTION_RE = /\b(broken|bug|error|fail|stuck|help|crash|down|issue|problem|doesn't work|dont work|can't|cannot|wtf|annoyed|frustrated|hate)\b/i;
const WARM_RE = /\b(thanks|thank you|ty|thx|appreciate|love|awesome|great|solid|nice|perfect|legend)\b/i;

function senseEnabled() {
  const v = String(process.env.DISCORD_SENSE ?? process.env.DISCORD_FARM ?? '1').trim().toLowerCase();
  return !/^(0|false|no|off)$/.test(v);
}

function ensureDir() {
  fs.mkdirSync(SENSE_DIR, { recursive: true });
}

function hashUser(id) {
  return crypto.createHash('sha256').update(String(id || '')).digest('hex').slice(0, 12);
}

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function saveJson(p, data) {
  ensureDir();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Extract communication features from one message (no PII storage).
 * @param {string} text
 */
function analyzeUtterance(text) {
  const raw = String(text || '');
  const len = raw.length;
  const words = raw.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let emoji = 0;
  try {
    emoji = (raw.match(/\p{Extended_Pictographic}/gu) || []).length;
  } catch (_) {
    emoji = (raw.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  }
  const questions = (raw.match(/\?/g) || []).length;
  const exclaims = (raw.match(/!/g) || []).length;
  const casual = CASUAL_RE.test(raw) ? 1 : 0;
  const tech = TECH_RE.test(raw) ? 1 : 0;
  const social = SOCIAL_RE.test(raw) ? 1 : 0;
  const friction = FRICTION_RE.test(raw) ? 1 : 0;
  const warm = WARM_RE.test(raw) ? 1 : 0;
  const capsRatio = len
    ? (raw.replace(/[^A-Za-z]/g, '').replace(/[^A-Z]/g, '').length)
      / Math.max(1, raw.replace(/[^A-Za-z]/g, '').length)
    : 0;
  const avgWordLen = wordCount
    ? words.reduce((s, w) => s + w.length, 0) / wordCount
    : 0;

  return {
    len,
    wordCount,
    emoji,
    questions,
    exclaims,
    casual,
    tech,
    social,
    friction,
    warm,
    capsRatio,
    avgWordLen,
  };
}

function emptyStats() {
  return {
    n: 0,
    len: 0,
    wordCount: 0,
    emoji: 0,
    questions: 0,
    exclaims: 0,
    casual: 0,
    tech: 0,
    social: 0,
    friction: 0,
    warm: 0,
    capsRatio: 0,
    avgWordLen: 0,
  };
}

function rollStats(stats, feat) {
  const s = stats || emptyStats();
  const n = (s.n || 0) + 1;
  // exponential-ish running mean (favor recent while n grows, cap weight)
  const w = n <= 20 ? 1 / n : 0.08;
  const blend = (prev, next) => (1 - w) * (prev || 0) + w * next;
  return {
    n,
    len: blend(s.len, feat.len),
    wordCount: blend(s.wordCount, feat.wordCount),
    emoji: blend(s.emoji, feat.emoji),
    questions: blend(s.questions, feat.questions),
    exclaims: blend(s.exclaims, feat.exclaims),
    casual: blend(s.casual, feat.casual),
    tech: blend(s.tech, feat.tech),
    social: blend(s.social, feat.social),
    friction: blend(s.friction, feat.friction),
    warm: blend(s.warm, feat.warm),
    capsRatio: blend(s.capsRatio, feat.capsRatio),
    avgWordLen: blend(s.avgWordLen, feat.avgWordLen),
    lastAt: Date.now(),
  };
}

/**
 * Classify a stats profile into communication types (ordered by strength).
 * @param {object} stats
 * @returns {{ primary: string, types: string[], scores: Record<string, number> }}
 */
function classifyStyle(stats) {
  if (!stats || !stats.n) {
    return { primary: 'newcomer', types: ['newcomer'], scores: { newcomer: 1 } };
  }
  const scores = {
    concise: 0,
    expressive: 0,
    technical: 0,
    social: 0,
    analytical: 0,
    frustrated: 0,
    warm: 0,
    newcomer: 0,
    balanced: 0.15,
  };

  if (stats.n < 4) scores.newcomer += 0.9;
  if (stats.wordCount <= 6 && stats.len < 80) scores.concise += 1.1;
  if (stats.wordCount >= 18 || stats.len > 160) scores.analytical += 0.45;
  if (stats.emoji >= 0.6 || stats.exclaims >= 0.5) scores.expressive += 1.0;
  if (stats.casual >= 0.35) scores.expressive += 0.45;
  if (stats.casual >= 0.35) scores.social += 0.35;
  if (stats.tech >= 0.3) scores.technical += 1.2;
  if (stats.social >= 0.35) scores.social += 0.9;
  if (stats.questions >= 0.35) scores.analytical += 1.0;
  if (stats.friction >= 0.25) scores.frustrated += 1.3;
  if (stats.warm >= 0.3) scores.warm += 1.0;
  if (stats.avgWordLen >= 5.5 && stats.casual < 0.2) scores.technical += 0.25;

  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);
  const top = ranked.filter(([, v]) => v >= 0.4).slice(0, 3).map(([k]) => k);
  const primary = top[0] || 'balanced';
  if (!top.includes(primary)) top.unshift(primary);
  return { primary, types: top.length ? top : ['balanced'], scores: Object.fromEntries(ranked) };
}

/**
 * Observe one real message → update people + community sense.
 * @param {{ userId?: string, userHash?: string, guildId?: string|null, content: string, source?: string }} evt
 */
function observeChat(evt = {}) {
  if (!senseEnabled()) return { ok: false, reason: 'sense_off' };
  const content = String(evt.content || '').trim();
  if (content.length < 2) return { ok: false, reason: 'empty' };
  if (/^[,/!]/.test(content) && content.length < 40) {
    // skip pure short commands — not conversational style
    return { ok: false, reason: 'command' };
  }

  const feat = analyzeUtterance(content);
  const userHash = evt.userHash || hashUser(evt.userId);
  const guildId = evt.guildId ? String(evt.guildId) : null;

  const people = loadJson(PEOPLE_PATH, { updatedAt: 0, people: {} });
  people.people = people.people || {};
  const prev = people.people[userHash] || { stats: emptyStats() };
  const stats = rollStats(prev.stats, feat);
  const classified = classifyStyle(stats);
  people.people[userHash] = {
    stats,
    primary: classified.primary,
    types: classified.types,
    scores: classified.scores,
    source: evt.source || 'discord',
    lastGuildId: guildId,
    updatedAt: Date.now(),
  };
  // prune to last 5000 people by recency
  const entries = Object.entries(people.people)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, 5000);
  people.people = Object.fromEntries(entries);
  people.updatedAt = Date.now();
  saveJson(PEOPLE_PATH, people);

  let communityRow = null;
  if (guildId) {
    const comm = loadJson(COMMUNITIES_PATH, { updatedAt: 0, communities: {} });
    comm.communities = comm.communities || {};
    const cprev = comm.communities[guildId] || { stats: emptyStats(), typeCounts: {} };
    const cstats = rollStats(cprev.stats, feat);
    const ctype = classifyStyle(cstats);
    const typeCounts = { ...(cprev.typeCounts || {}) };
    typeCounts[classified.primary] = (typeCounts[classified.primary] || 0) + 1;
    // prune typeCounts keys
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    communityRow = {
      stats: cstats,
      primary: ctype.primary,
      types: ctype.types,
      typeCounts: Object.fromEntries(topTypes),
      peopleSample: Math.min(5000, (cprev.peopleSample || 0) + 1),
      updatedAt: Date.now(),
    };
    comm.communities[guildId] = communityRow;
    comm.updatedAt = Date.now();
    saveJson(COMMUNITIES_PATH, comm);
  }

  // global type mix
  try {
    const types = loadJson(TYPES_PATH, { updatedAt: 0, counts: {} });
    types.counts = types.counts || {};
    types.counts[classified.primary] = (types.counts[classified.primary] || 0) + 1;
    types.updatedAt = Date.now();
    saveJson(TYPES_PATH, types);
  } catch (_) { /* ignore */ }

  // Dolonia data warehouse (Supabase) — durable quality profiles
  try {
    // eslint-disable-next-line global-require
    const dolonia = require('./dolonia-conversation-data');
    dolonia.upsertPersonStyle({
      userHash,
      sampleN: stats.n,
      primary: classified.primary,
      types: classified.types,
      stats,
      lastGuildId: guildId,
      source: evt.source || 'discord',
    });
    if (guildId && communityRow) {
      dolonia.upsertCommunity({
        communityId: guildId,
        sampleN: communityRow.peopleSample,
        primary: communityRow.primary,
        types: communityRow.types,
        typeCounts: communityRow.typeCounts,
        stats: communityRow.stats,
      });
    }
  } catch (_) { /* warehouse optional */ }

  return {
    ok: true,
    userHash,
    primary: classified.primary,
    types: classified.types,
  };
}

function getPersonStyle(userIdOrHash) {
  const people = loadJson(PEOPLE_PATH, { people: {} });
  const key = String(userIdOrHash || '').length === 12 && /^[a-f0-9]+$/i.test(String(userIdOrHash))
    ? String(userIdOrHash)
    : hashUser(userIdOrHash);
  const row = people.people?.[key];
  if (!row) {
    return {
      known: false,
      primary: 'newcomer',
      types: ['newcomer'],
      guidance: TYPE_GUIDANCE.newcomer,
      stats: null,
    };
  }
  return {
    known: true,
    primary: row.primary || 'balanced',
    types: row.types || ['balanced'],
    guidance: TYPE_GUIDANCE[row.primary] || TYPE_GUIDANCE.balanced,
    allGuidance: (row.types || []).map((t) => TYPE_GUIDANCE[t]).filter(Boolean),
    stats: row.stats,
    n: row.stats?.n || 0,
  };
}

function getCommunityVoice(guildId) {
  if (!guildId) return null;
  const comm = loadJson(COMMUNITIES_PATH, { communities: {} });
  const row = comm.communities?.[String(guildId)];
  if (!row) return null;
  const mix = Object.entries(row.typeCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, c]) => `${t}(${c})`);
  return {
    primary: row.primary || 'balanced',
    types: row.types || ['balanced'],
    mix,
    peopleSample: row.peopleSample || 0,
    guidance: TYPE_GUIDANCE[row.primary] || TYPE_GUIDANCE.balanced,
    stats: row.stats,
  };
}

/**
 * Build LLM system-prompt block for adapting to this person + community.
 */
function buildAdaptationBlock(opts = {}) {
  const person = getPersonStyle(opts.userId || opts.userHash);
  const community = opts.guildId ? getCommunityVoice(opts.guildId) : null;

  const lines = [
    'Conversation sense (learn how real people talk → reply more naturally):',
    'Adapt to THIS person\'s communication style. Do not stereotype identity — only chat style.',
  ];

  if (person.known) {
    lines.push(
      `Person style (from ~${person.n} msgs, hashed id only): primary=${person.primary}`
      + (person.types?.length ? ` · mix=${person.types.join('+')}` : ''),
      `How to talk to them: ${person.guidance.how}`,
    );
    if (person.stats) {
      lines.push(
        `Signals: ~${Math.round(person.stats.wordCount || 0)} words/msg`
        + `, emoji~${(person.stats.emoji || 0).toFixed(1)}`
        + `, casual~${(person.stats.casual || 0).toFixed(2)}`
        + `, tech~${(person.stats.tech || 0).toFixed(2)}`
        + `, questions~${(person.stats.questions || 0).toFixed(2)}`,
      );
    }
  } else {
    lines.push(
      'Person style: not enough history yet → treat as newcomer.',
      `How to talk to them: ${TYPE_GUIDANCE.newcomer.how}`,
    );
  }

  // Also adapt to the *current message* if they shift tone this turn
  if (opts.content) {
    const feat = analyzeUtterance(opts.content);
    const snap = classifyStyle({
      n: 10,
      len: feat.len,
      wordCount: feat.wordCount,
      emoji: feat.emoji,
      questions: feat.questions > 0 ? 1 : 0,
      exclaims: feat.exclaims > 0 ? 1 : 0,
      casual: feat.casual,
      tech: feat.tech,
      social: feat.social,
      friction: feat.friction,
      warm: feat.warm,
      capsRatio: feat.capsRatio,
      avgWordLen: feat.avgWordLen,
    });
    if (snap.primary && snap.primary !== person.primary) {
      lines.push(
        `This message leans ${snap.primary} — prefer that for THIS reply.`,
        `This-turn guidance: ${(TYPE_GUIDANCE[snap.primary] || TYPE_GUIDANCE.balanced).how}`,
      );
    }
  }

  if (community) {
    lines.push(
      `Community voice: primary=${community.primary}`
      + (community.mix?.length ? ` · people mix: ${community.mix.join(', ')}` : ''),
      `Room vibe: ${community.guidance.how}`,
    );
  }

  lines.push(
    'Match their length and energy. Sound like a real person in this server, not a support bot.',
    'Never claim you stored private DMs or real identities.',
  );

  return {
    block: lines.join('\n'),
    person,
    community,
  };
}

function buildSenseScorecard() {
  const people = loadJson(PEOPLE_PATH, { people: {} });
  const types = loadJson(TYPES_PATH, { counts: {} });
  const comm = loadJson(COMMUNITIES_PATH, { communities: {} });
  const peopleN = Object.keys(people.people || {}).length;
  const typeMix = Object.entries(types.counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count, label: TYPE_GUIDANCE[type]?.label || type }));
  const communitiesN = Object.keys(comm.communities || {}).length;

  return {
    ok: true,
    enabled: senseEnabled(),
    peopleKnown: peopleN,
    communities: communitiesN,
    typeMix,
    paths: { senseDir: SENSE_DIR, people: PEOPLE_PATH, communities: COMMUNITIES_PATH },
    notes: [
      peopleN === 0
        ? 'Not enough conversation yet — as people chat, Denizen learns how different styles work.'
        : `Tracking ${peopleN} conversation styles (hashed) across ${communitiesN} communities.`,
      'Improves how Denizen talks — not training model weights on your messages.',
    ],
  };
}

module.exports = {
  senseEnabled,
  analyzeUtterance,
  classifyStyle,
  observeChat,
  getPersonStyle,
  getCommunityVoice,
  buildAdaptationBlock,
  buildSenseScorecard,
  hashUser,
  TYPE_GUIDANCE,
  SENSE_DIR,
};
