'use strict';

/**
 * Replay NPC-to-NPC dialogue from past LLM output (MEMORY.md + runtime memories).
 * Ambient chatter and npc_conversation use this corpus — no fresh LLM calls.
 * Player chat and think-loop actions still use AI separately.
 */

const path = require('path');
const fs = require('fs');

const NPCS_DIR = path.join(__dirname, '..', '..', 'npcs');
const CORPUS_TTL_MS = 30000;

/** Original ambient openers — used only until the corpus has real LLM lines. */
const AMBIENT_TOPICS_FALLBACK = [
  'Hey, have you had coffee yet?',
  'Did you see the deploy went smooth this morning?',
  'Quick question when you have a second.',
  'Long week already and it is only Tuesday.',
  'How is that task going for you?',
  'Anyone else feel like we need a whiteboard session?',
  'I was just thinking about the architecture on that last feature.',
  'You hungry? I am about to grab something.',
  'Did you check the latest logs?',
  'I found something interesting while researching earlier.',
  'Hey, good work on that last one.',
  'Do you know if Abby is in today?',
  'I keep meaning to refactor that module.',
  'The build is green, finally.',
  'We should sync up on this before end of day.',
];

const NAME_TO_FOLDER = {
  Abby: 'abby', Alex: 'alex', Bob: 'bob', Jenny: 'jenny',
  Dan: 'dan', Lucy: 'lucy', Bouncer: 'bouncer',
  Marcus: 'conference_man', Sarah: 'conference_woman',
  Edward: 'edward', Josh: 'josh', Molly: 'molly',
  Oscar: 'oscar', Pier: 'pier', Rob: 'rob', Roki: 'roki',
};

const REASONING_META = [
  /Thinking\s*Process/i,
  /^Analyze the Request/i,
  /^Determine Persona/i,
  /Persona Constraints/i,
  /Bouncer Lock/i,
  /The user is roleplaying/i,
  /^\d+\.\s*\*?\*?(Analyze|Assess|Consider|Identify)/i,
];

let _corpusCache = null;
let _corpusBuiltAt = 0;
const _replayCursor = new Map();

function pick(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function systematicPick(arr, key) {
  if (!arr?.length) return null;
  const idx = (_replayCursor.get(key) || 0) % arr.length;
  _replayCursor.set(key, idx + 1);
  return arr[idx];
}

function cleanLine(text, npcBrains, npcName) {
  let t = String(text ?? '').trim();
  if (!t) return '';
  if (npcBrains?._cleanDisplayText) {
    t = npcBrains._cleanDisplayText(t, npcName);
  } else if (npcBrains?._stripReasoningLeak) {
    t = npcBrains._stripReasoningLeak(t);
  }
  t = t.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();
  t = t.replace(/^["']|["']$/g, '').trim();
  // Memory replay sometimes embeds "Name says:" from chat-template formatting.
  t = t.replace(/^[A-Za-z][A-Za-z ]{0,24}\s+says:\s*/i, '').trim();
  return t;
}

function isUsableLine(text) {
  const t = String(text ?? '').trim();
  if (t.length < 8 || t.length > 320) return false;
  if (REASONING_META.some((re) => re.test(t))) return false;
  if (/^(No reply|CEO said|\[OUTCOME|\[CONTINUING|\[TOPIC:)/i.test(t)) return false;
  if (/Cascaded decision|directed:/i.test(t)) return false;
  return true;
}

function addPair(corpus, { responder, from, said, replied, source }) {
  const cleanSaid = String(said || '').trim();
  const cleanReplied = String(replied || '').trim();
  if (!isUsableLine(cleanSaid) || !isUsableLine(cleanReplied)) return;
  const pair = { responder, from, said: cleanSaid, replied: cleanReplied, source };
  corpus.pairs.push(pair);

  const pairKey = `${from}→${responder}`;
  if (!corpus.pairsByKey[pairKey]) corpus.pairsByKey[pairKey] = [];
  corpus.pairsByKey[pairKey].push(pair);

  if (!corpus.openersByNpc[from]) corpus.openersByNpc[from] = [];
  corpus.openersByNpc[from].push(cleanSaid);

  if (!corpus.repliesByNpc[responder]) corpus.repliesByNpc[responder] = [];
  corpus.repliesByNpc[responder].push(cleanReplied);
}

function parseMemoryLine(line, responder, npcBrains) {
  const convo = line.match(/^(.+?) said: "(.+?)" — I replied: "(.+?)"/);
  if (convo) {
    const from = convo[1].replace(/\s+says?$/i, '').trim();
    const said = cleanLine(convo[2], npcBrains, responder);
    const replied = cleanLine(convo[3], npcBrains, responder);
    return { from, said, replied };
  }
  return null;
}

function loadMemoryFilePairs(responder, npcBrains, corpus) {
  const folder = NAME_TO_FOLDER[responder];
  if (!folder) return;
  const memPath = path.join(NPCS_DIR, folder, 'MEMORY.md');
  let raw = '';
  try { raw = fs.readFileSync(memPath, 'utf8'); } catch { return; }

  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/^-\s*\[[^\]]+\]\s*/, '').trim();
    const parsed = parseMemoryLine(trimmed, responder, npcBrains);
    if (parsed) {
      addPair(corpus, {
        responder,
        from: parsed.from,
        said: parsed.said,
        replied: parsed.replied,
        source: 'memory.md',
      });
    }
  }
}

function loadRuntimeMemoryPairs(npcBrains, corpus) {
  if (!npcBrains?.memories) return;
  for (const [responder, mem] of Object.entries(npcBrains.memories)) {
    if (!Array.isArray(mem) || mem.length < 2) continue;
    for (let i = 0; i < mem.length - 1; i++) {
      const incoming = mem[i];
      const outgoing = mem[i + 1];
      if (!incoming || !outgoing) continue;
      if (incoming.from === responder || incoming.from === 'CEO') continue;
      if (outgoing.from !== responder) continue;
      addPair(corpus, {
        responder,
        from: incoming.from,
        said: cleanLine(incoming.text, npcBrains, responder),
        replied: cleanLine(outgoing.text, npcBrains, responder),
        source: 'runtime',
      });
    }
  }
}

/** Build replay corpus from persisted + in-session LLM dialogue. */
function buildCorpus(npcBrains, { skipDisk = false } = {}) {
  const corpus = {
    pairs: [],
    pairsByKey: {},
    openersByNpc: {},
    repliesByNpc: {},
  };

  if (!skipDisk) {
    for (const name of Object.keys(NAME_TO_FOLDER)) {
      loadMemoryFilePairs(name, npcBrains, corpus);
    }
  }
  loadRuntimeMemoryPairs(npcBrains, corpus);

  // Dedupe openers/replies while preserving order for systematic rotation
  for (const npc of Object.keys(corpus.openersByNpc)) {
    corpus.openersByNpc[npc] = [...new Set(corpus.openersByNpc[npc])];
  }
  for (const npc of Object.keys(corpus.repliesByNpc)) {
    corpus.repliesByNpc[npc] = [...new Set(corpus.repliesByNpc[npc])];
  }

  return corpus;
}

function getCorpus(npcBrains, { force = false, skipDisk = false } = {}) {
  if (!force && !skipDisk && _corpusCache && Date.now() - _corpusBuiltAt < CORPUS_TTL_MS) {
    return _corpusCache;
  }
  const corpus = buildCorpus(npcBrains, { skipDisk });
  if (!skipDisk) {
    _corpusCache = corpus;
    _corpusBuiltAt = Date.now();
  }
  return corpus;
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
}

function overlapScore(a, b) {
  const ta = new Set(tokenize(a));
  const tb = tokenize(b);
  if (!ta.size || !tb.length) return 0;
  let hits = 0;
  for (const w of tb) if (ta.has(w)) hits++;
  return hits;
}

/** Pick an opener the initiator has said before (systematic rotation). */
function pickAmbientOpener(initiator, responder, npcBrains, opts = {}) {
  const corpus = opts.corpus || getCorpus(npcBrains);
  const key = `ambient-opener:${initiator}:${responder}`;

  const pairKey = `${initiator}→${responder}`;
  const pairOpeners = (corpus.pairsByKey[pairKey] || []).map((p) => p.said);
  if (pairOpeners.length) {
    return systematicPick(pairOpeners, key);
  }

  const initiatorOpeners = corpus.openersByNpc[initiator] || [];
  if (initiatorOpeners.length) {
    return systematicPick(initiatorOpeners, key);
  }

  // Lines that appeared in any past ambient-style exchange
  const ambientLike = corpus.pairs
    .map((p) => p.said)
    .filter((s) => AMBIENT_TOPICS_FALLBACK.some((t) => t.toLowerCase() === s.toLowerCase()));
  if (ambientLike.length) {
    return systematicPick(ambientLike, key);
  }

  return systematicPick(AMBIENT_TOPICS_FALLBACK, key);
}

/** Find the best past LLM reply for this exchange. */
function pickReplayReply(responder, fromName, message, npcBrains, opts = {}) {
  const corpus = opts.corpus || getCorpus(npcBrains);
  const safeMessage = String(message || '').trim();
  const pairKey = `${fromName}→${responder}`;
  const candidates = corpus.pairsByKey[pairKey] || [];

  if (candidates.length) {
    const scored = candidates
      .map((p) => ({ pair: p, score: overlapScore(p.said, safeMessage) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].pair.replied;
    const key = `ambient-reply:${pairKey}`;
    return systematicPick(candidates.map((p) => p.replied), key);
  }

  // Same responder, different partner — match by topic overlap on what was said
  const responderPairs = corpus.pairs.filter((p) => p.responder === responder);
  if (responderPairs.length) {
    const scored = responderPairs
      .map((p) => ({ pair: p, score: overlapScore(p.said, safeMessage) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length) return scored[0].pair.replied;
    const key = `ambient-reply:${responder}`;
    const replies = corpus.repliesByNpc[responder] || [];
    if (replies.length) return systematicPick(replies, key);
  }

  if (npcBrains?._cannedResponse) {
    return npcBrains._cannedResponse(responder, fromName, safeMessage);
  }
  return 'On it — let me get back to you.';
}

function getNpcConversationReply(npcBrains, responder, fromName, message, opts = {}) {
  const safeMessage = String(message || '').trim();
  if (!responder || !safeMessage) return '(No reply right now.)';
  return pickReplayReply(responder, fromName, safeMessage, npcBrains, opts);
}

function generateAmbientPair(initiator, responder, npcBrains, opts = {}) {
  const corpus = getCorpus(npcBrains);
  const opener = pickAmbientOpener(initiator, responder, npcBrains, { corpus });
  const reply = pickReplayReply(responder, initiator, opener, npcBrains, { corpus });
  return { opener, reply, scripted: true, source: 'replay-corpus' };
}

function resetCorpusCache() {
  _corpusCache = null;
  _corpusBuiltAt = 0;
}

module.exports = {
  AMBIENT_TOPICS_FALLBACK,
  buildCorpus,
  getCorpus,
  pickAmbientOpener,
  pickReplayReply,
  getNpcConversationReply,
  generateAmbientPair,
  resetCorpusCache,
};
