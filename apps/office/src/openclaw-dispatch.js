(function () {
'use strict';
/**
 * OpenClaw Dispatch — classify a player utterance and route it.
 *
 * Two questions:
 *   1. Is this an action request ("deploy v2 to staging") or casual chat
 *      ("hey Abby, how's it going")?
 *   2. If action, send it to OpenClaw to actually run a tool. If chat,
 *      let the existing NPC brain answer.
 *
 * The classifier is pure: text in, `'action' | 'chat'` out, plus a few
 * derived hints (urgency, suggested target). Tested in isolation.
 *
 * The dispatcher is browser-only — it knows about
 * `window.__DenizenGatewayBridge` and `window.__DenizenPlayerChat`. It
 * uses the existing gateway-bridge.request() infrastructure to send
 * over WebSocket. The actual gateway method name is configurable
 * because OpenClaw's chat-send protocol may differ between versions —
 * defaults to 'chat.send', overridable via window.DenizenOpenClawChatMethod.
 */

// =====================================================================
// Pure classifier (CJS)
// =====================================================================

// Verbs that strongly suggest "do this now" rather than conversation.
const ACTION_VERBS = new Set([
  // Software / shell
  'deploy', 'ship', 'release', 'build', 'compile', 'install', 'restart',
  'run', 'execute', 'start', 'stop', 'kill', 'pause', 'resume',
  'fix', 'patch', 'rollback', 'revert',
  'create', 'make', 'generate', 'scaffold', 'init',
  'delete', 'remove', 'rm', 'drop',
  'rename', 'move', 'mv', 'copy', 'cp',
  'open', 'close',
  // Source control
  'commit', 'push', 'pull', 'merge', 'rebase', 'cherry-pick', 'branch',
  // Data / IO
  'read', 'write', 'save', 'load', 'fetch', 'download', 'upload',
  'search', 'find', 'lookup', 'query', 'list', 'show',
  // Comms
  'send', 'email', 'post', 'tweet', 'dm', 'message', 'notify', 'alert',
  // Web
  'browse', 'navigate', 'screenshot', 'scrape',
  // Generic ops
  'check', 'verify', 'test', 'review', 'audit', 'monitor',
  'schedule', 'cron', 'cancel', 'reschedule',
]);

// Tool/skill keywords that mark a sentence as action-y even without a verb.
const TOOL_KEYWORDS = [
  /\bgithub\b/i, /\bgit\b/i, /\bpull request\b/i, /\bpr\b/i, /\bissue\b/i,
  /\bsupabase\b/i, /\bdatabase\b/i, /\bsql\b/i, /\bschema\b/i,
  /\bintake[\s-]?triage\b/i, /\blead[\s-]?monitor\b/i, /\brfp[\s-]?status\b/i,
  /\bprediction[\s-]?brief\b/i, /\bclient[\s-]?lookup\b/i, /\boutcome[\s-]?standup\b/i,
  /\bwork[\s-]?history\b/i, /\bcost[\s-]?dashboard\b/i, /\bentity[\s-]?link\b/i,
  /\bvisitor[\s-]?claim\b/i, /\bassistant[\s-]?handoff\b/i, /\borg[\s-]?benchmark\b/i,
  /\bintake[\s-]?form\b/i, /\bnew\s+leads?\b/i, /\bbid\s+decision\b/i,
  /\bbrowser\b/i, /\bnavigate\b/i, /\bscreenshot\b/i,
  /\bdeploy\b/i, /\bstaging\b/i, /\bproduction\b/i, /\bprod\b/i,
  /\bbash\b/i, /\bshell\b/i, /\bterminal\b/i, /\bcommand\b/i,
  /\bn8n\b/i, /\bworkflow\b/i, /\bpipeline\b/i, /\bci\b/i,
  /\bweather\b/i, /\bspotify\b/i,
];

// Markers that strongly indicate CHAT (override action heuristics).
const CHAT_MARKERS = [
  /\bhow are you\b/i, /\bhow's it going\b/i, /\bgood morning\b/i,
  /\bgood afternoon\b/i, /\bgood evening\b/i, /\bhello\b/i, /\bhi\b/i,
  /\bhey\b/i, /\bthanks\b/i, /\bthank you\b/i, /\bnice\b/i, /\bcool\b/i,
  /\bwhat do you think\b/i, /\bdo you think\b/i,
];

// Explicit prefix overrides.
const FORCE_ACTION_PREFIX = /^\s*\/(do|run|exec|action)\b\s*/i;
const FORCE_CHAT_PREFIX   = /^\s*\/(say|chat|talk)\b\s*/i;
const POLICY_STORAGE_KEY = 'denizen.openclaw.action-policy';

/** STT often hears "hey Lucy" as "play Lucy" — fix before display or intent parsing. */
function fixVoiceMishearings(text) {
  let s = String(text || '').trim();
  s = s.replace(/^play\s+(?:lucy|lucie|loosey)(?=\s|[,.!?]|$)/i, 'hey Lucy');
  s = s.replace(/\bbrow?s+w?er\b/gi, 'browser');
  s = s.replace(/\b(?:your|you)\s+suck\b/gi, "you're stuck");
  s = s.replace(/\blnow\b/gi, 'know');
  s = s.replace(/\bbowerd\b/gi, 'powered');
  return s.trim();
}

/** Strip voice/UI prefixes ("play Lucy …", "hey Lucy …") before intent parsing. */
function normalizePlayerUtterance(text) {
  let s = fixVoiceMishearings(text);
  s = s.replace(/^play\s+(?:lucy|[a-z]+)\s*$/i, '');
  s = s.replace(/^play\s+(?:lucy|[a-z]+)\s+/i, '');
  s = s.replace(/^(?:hey|hi|hello|yo|sup|ok)[,!\s]+/i, '');
  s = s.replace(/^(?:hey|hi|hello|yo)\s+lucy[,:\s]+/i, '');
  s = s.replace(/^\s*lucy[,:\s]+/i, '');
  s = s.replace(/^(?:key|um|uh)\s+/i, '');
  return s.trim();
}

const JUNK_SEARCH_QUERY = /^(?:search(?:\s+up)?|google|look\s*up|on\s+the\s+web|the\s+web|web|for|please)$/i;

/** Quick lookup about yourself/capabilities — not a web search. */
const LOOKUP_ABOUT_SELF = /^(?:yourself|your\s+name|your\s+role|your\s+job|what\s+you\s+can\s+do|your\s+capabilit|how\s+you\s+work|our\s+relationship)\b/i;

function cleanSearchQuery(query) {
  let q = String(query || '')
    .replace(/\s+on\s+the\s+browser\b/gi, '')
    .replace(/\s+in\s+the\s+browser\b/gi, '')
    .replace(/\s+on\s+browser\b/gi, '')
    .replace(/\s+in\s+browser\b/gi, '')
    .replace(/^(?:on\s+)?(?:the\s+)?web\s+/i, '')
    .replace(/\s+on\s+(?:the\s+)?web\b/gi, '')
    .replace(/^the\s+web\s+for\s+/i, '')
    .replace(/^for\s+/i, '')
    .replace(/^(?:anything|something|everything)\s+(?:regarding|about|on|related\s+to)\s+/i, '')
    .replace(/^(?:regarding|about|related\s+to)\s+/i, '')
    .replace(/^(?:do you|can you|could you|would you)\s+/i, '')
    .replace(/^(?:key|um|uh|please)\s+/i, '')
    .replace(/[.?!]+$/, '')
    .trim();
  if (/^(?:the\s+)?web$/i.test(q) || JUNK_SEARCH_QUERY.test(q)) return '';
  return q;
}

function getDefaultActionPolicy() {
  return {
    mode: 'confirm', // suggest | confirm | auto-safe
    requireConfirmation: true,
    safeDomains: ['analysis', 'status', 'documentation', 'code review', 'planning', 'testing'],
    restrictedPatterns: [
      '\\bdelete\\b',
      '\\bdrop\\b',
      '\\bformat\\s+disk\\b',
      '\\bproduction\\s+deploy\\b',
      '\\brotate\\s+key\\b',
      '\\bbilling\\b',
      '\\bcredential\\b',
    ],
  };
}

function getActionPolicy() {
  const fallback = getDefaultActionPolicy();
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(POLICY_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...(parsed || {}),
      safeDomains: Array.isArray(parsed?.safeDomains) ? parsed.safeDomains : fallback.safeDomains,
      restrictedPatterns: Array.isArray(parsed?.restrictedPatterns) ? parsed.restrictedPatterns : fallback.restrictedPatterns,
    };
  } catch (_) {
    return fallback;
  }
}

function setActionPolicy(patch = {}) {
  const next = { ...getActionPolicy(), ...(patch || {}) };
  if (typeof window !== 'undefined' && window.localStorage) {
    try { window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
  }
  return next;
}

/** Bare hi / hey Lucy — answered instantly without LM Studio or OpenClaw. */
function isGreetingUtterance(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/^(?:hey|hi|hello|yo|sup|good\s+(?:morning|afternoon|evening))[!.?]*$/i.test(raw)) {
    return true;
  }
  if (/^(?:hey|hi|hello|yo|sup)\s+\w+[!.?]*$/i.test(raw)) {
    return true;
  }
  if (/^play\s+lucy\s*$/i.test(raw)) {
    return true;
  }
  const stripped = normalizePlayerUtterance(fixVoiceMishearings(raw));
  if (!stripped) return true;
  return /^(?:how are you|how'?s it going|what'?s up|whats up)$/i.test(stripped);
}

/** Search phrasing (even without a topic yet) — handled by Lucy locally. */
function isLucySearchIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (looksLikeLookupMessage(raw)) return true;
  const norm = normalizePlayerUtterance(fixVoiceMishearings(raw));
  if (looksLikeLookupMessage(norm)) return true;
  return /\b(?:search|google|look\s+up|browse\s+for)\b/i.test(norm);
}

/** True when the CEO is explicitly talking to a specific NPC by name. */
function explicitlyAddressesNpc(text, npcName) {
  const name = String(npcName || '').trim();
  if (!name) return false;
  const raw = String(text || '').trim();
  const norm = normalizePlayerUtterance(fixVoiceMishearings(raw));
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:hey|hi|hello|yo|ok)?[,!\\s]*${esc}\\b`, 'i').test(norm)
    || new RegExp(`\\b(?:hey|hi|hello)\\s+${esc}\\b`, 'i').test(raw)
    || new RegExp(`\\b${esc}[,:\\s]`, 'i').test(raw);
}

/** Browser/search/research staff work — always Lucy unless it's plain chat to someone else. */
function isLucyStaffIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const norm = normalizePlayerUtterance(fixVoiceMishearings(raw));
  return !!(
    isLucySearchIntent(raw) || isLucySearchIntent(norm)
    || extractOpenBrowserIntent(raw) || extractOpenBrowserIntent(norm)
    || extractBrowserRetryIntent(raw) || extractBrowserRetryIntent(norm)
    || extractBrowserReadIntent(raw) || extractBrowserReadIntent(norm)
    || extractCloseBrowserIntent(raw)
    || extractJobBoardSearchIntent(raw)
    || extractResearchBriefIntent(raw)
    || extractResearchQueueIntent(raw)
  );
}

/** Route player chat to Lucy for staff intents (search/browser/research). */
function resolveStaffIntentNpc(text, currentNpcName) {
  if (!isLucyStaffIntent(text)) return currentNpcName;
  return 'Lucy';
}

/** Browser/search/screen intents handled by Denizen Jelly — not OpenClaw gateway. */
function isDenizenNativeIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return !!(
    isGreetingUtterance(raw)
    || isLucySearchIntent(raw)
    || extractOpenBraveIntent(raw)
    || extractOpenBrowserIntent(raw)
    || extractBrowserRetryIntent(raw)
    || extractBrowserReadIntent(raw)
    || isCancelUtterance(raw)
    || extractCloseBrowserIntent(raw)
    || extractSearchQuery(raw)
    || extractJobBoardSearchIntent(raw)
    || extractScreenObserveIntent(raw)
    || extractScreenControlIntent(raw)
    || extractResearchQueueIntent(raw)
    || extractResearchBriefIntent(raw)
  );
}

function evaluateActionPolicy(text, classification) {
  const c = classification || classify(text);
  if (isDenizenNativeIntent(text)) {
    return { allowed: true, reason: 'denizen-native intent', policy: getActionPolicy() };
  }
  if (c.kind !== 'action') {
    return { allowed: true, reason: 'chat message', policy: getActionPolicy() };
  }
  const policy = getActionPolicy();
  const raw = String(text || '');
  const candidate = String(c.stripped || text || '').toLowerCase();
  const explicitUserConfirm = FORCE_ACTION_PREFIX.test(raw);

  const restricted = (policy.restrictedPatterns || []).some((pat) => {
    try { return new RegExp(pat, 'i').test(candidate); }
    catch (_) { return false; }
  });
  if (restricted) {
    return {
      allowed: false,
      reason: 'blocked by restricted policy pattern',
      policy,
    };
  }

  if (policy.mode === 'suggest') {
    return { allowed: false, reason: 'policy mode is suggest-only', policy };
  }

  if ((policy.mode === 'confirm' || policy.requireConfirmation) && !explicitUserConfirm) {
    return { allowed: false, requiresConfirmation: true, reason: 'confirmation required by policy', policy };
  }

  return { allowed: true, reason: 'allowed by policy', policy };
}

/**
 * Classify a player utterance.
 *
 * @param {string} text
 * @returns {{ kind: 'action'|'chat', confidence: number,
 *             stripped: string, urgent: boolean, reason: string }}
 *
 * `stripped` is the input with any /command prefix removed — what you
 * should actually send to the destination.
 */
function classify(text) {
  const raw = String(text || '');
  if (!raw.trim()) {
    return { kind: 'chat', confidence: 0, stripped: '', urgent: false, reason: 'empty' };
  }

  // Explicit overrides first.
  if (FORCE_ACTION_PREFIX.test(raw)) {
    return { kind: 'action', confidence: 1.0, stripped: raw.replace(FORCE_ACTION_PREFIX, ''), urgent: false, reason: '/do prefix' };
  }
  if (FORCE_CHAT_PREFIX.test(raw)) {
    return { kind: 'chat', confidence: 1.0, stripped: raw.replace(FORCE_CHAT_PREFIX, ''), urgent: false, reason: '/say prefix' };
  }

  const text2 = raw.trim();
  const lower = text2.toLowerCase();
  const stripped = text2;

  // Question marks lean toward chat unless the verb is unmistakably an action.
  const isQuestion = /[?]\s*$/.test(text2);

  // Chat markers are sticky.
  for (const re of CHAT_MARKERS) {
    if (re.test(text2)) {
      return { kind: 'chat', confidence: 0.85, stripped, urgent: false, reason: `chat marker: ${re}` };
    }
  }

  // Imperative-form check: first word is an action verb.
  const firstWord = (lower.match(/^[a-z][a-z'-]*/i) || [''])[0];
  const isImperativeStart = ACTION_VERBS.has(firstWord);

  // Tool keyword presence.
  let toolHits = 0;
  for (const re of TOOL_KEYWORDS) if (re.test(text2)) toolHits++;

  // "please <verb>" pattern.
  const polite = /^(please|hey|can you|could you|would you|will you)\s+([a-z][a-z'-]*)/i.exec(text2);
  const politeVerb = polite ? polite[2].toLowerCase() : '';
  const isPoliteImperative = polite && ACTION_VERBS.has(politeVerb);

  // Urgent flag.
  const urgent = /\b(now|asap|right now|immediately|urgently|stat)\b/i.test(text2);

  // Decision.
  let kind = 'chat';
  let confidence = 0.5;
  let reason = 'default';

  if (isImperativeStart) {
    kind = 'action';
    confidence = isQuestion ? 0.65 : 0.9;
    reason = `imperative verb: ${firstWord}`;
  } else if (isPoliteImperative) {
    kind = 'action';
    confidence = isQuestion ? 0.6 : 0.85;
    reason = `polite imperative: ${politeVerb}`;
  } else if (toolHits >= 2) {
    kind = 'action';
    confidence = 0.75;
    reason = `${toolHits} tool keywords`;
  } else if (toolHits === 1 && !isQuestion) {
    kind = 'action';
    confidence = 0.6;
    reason = '1 tool keyword';
  } else {
    kind = 'chat';
    confidence = isQuestion ? 0.85 : 0.7;
    reason = isQuestion ? 'question form' : 'no action signal';
  }

  return { kind, confidence, stripped, urgent, reason };
}

/**
 * Pull a web-search query out of a player utterance.
 * Returns null when the message isn't a search request.
 *
 * @param {string} text
 * @returns {string|null}
 */
function _looksLikeHostname(query) {
  const q = String(query || '').trim();
  return /^(?:https?:\/\/)?[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+(?:\/[^\s]*)?$/i.test(q);
}

function extractSearchQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Job-board searches go to Indeed/LinkedIn jobs URLs — not DuckDuckGo.
  if (extractJobBoardSearchIntent(raw)) return null;

  // Screen/desktop tasks — not web search.
  if (/\b(?:my screen|your screen|take over|typed it|do you see|look at (?:the |my )?(?:screen|window|page|browser)|check (?:the |my )?(?:screen|window|page)|on my pc|on your pc)\b/i.test(raw)) {
    return null;
  }

  const stripped = normalizePlayerUtterance(raw).replace(/\bserch\b/gi, 'search');

  const hasSearchVerb = /\b(?:search|google|look\s+up|browse\s+for)\b/i.test(raw)
    || /\b(?:search|google|look\s+up|browse\s+for)\b/i.test(stripped);

  const patterns = [
    /\bsearch\s+on\s+(?:the\s+)?web\s+(?:for\s+)?(.+)/i,
    /\bsearch(?:\s+(?:the\s+)?web)?\s+for\s+(.+)/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:search\s+up|search(?:\s+(?:the\s+)?web)?(?:\s+for)?|look\s+up|google|browse\s+for)\s+(.+)/i,
    /\bsearch\s+up\s+(.+)/i,
    /\bsearch(?:\s+(?:the\s+)?web)?(?:\s+for)\s+(.+)/i,
    /\b(?:do you|can you|could you|would you)\s+look\s+up\s+(.+)/i,
    /\blook\s+up\s+(.+)/i,
    /\blook\s+(?:something|it)\s+up(?:\s+(?:about|on|for))?\s+(.+)/i,
    /\b(?:can you|could you|would you)\s+look\s+(?:something|it)\s+up(?:\s+(?:about|on|for))?\s+(.+)/i,
  ];
  for (const candidate of [stripped, normalizePlayerUtterance(raw.replace(/\bserch\b/gi, 'search'))]) {
    for (const re of patterns) {
      const m = candidate.match(re);
      if (m && m[1]) {
        const query = cleanSearchQuery(m[1]);
        if (query.length > 1 && !/^(?:the\s+)?web$/i.test(query)) return query;
      }
    }
  }

  const firstWord = (stripped.toLowerCase().match(/^[a-z][a-z'-]*/i) || [''])[0];
  if (['search', 'lookup', 'google'].includes(firstWord)) {
    const rest = cleanSearchQuery(
      stripped.replace(/^[a-z][a-z'-]*\s+(?:(?:on\s+)?(?:the\s+)?web\s+)?(?:for\s+|up\s+)?/i, '')
    );
    if (rest && rest.length > 1 && !/^(?:the\s+)?web$/i.test(rest) && !JUNK_SEARCH_QUERY.test(rest)) {
      return rest;
    }
    return null;
  }

  // Bare hostnames/URLs are not searches unless the user said search/google/look up.
  if (_looksLikeHostname(stripped) && !hasSearchVerb) return null;

  // Deep brief / research-queue — Bob handles those, not DuckDuckGo quick lookup.
  if (extractResearchBriefIntent(raw) || extractResearchBriefIntent(stripped)) return null;
  if (extractResearchQueueIntent(raw) || extractResearchQueueIntent(stripped)) return null;

  const lookupPatterns = [
    /^(?:please\s+|can you\s+|could you\s+|would you\s+|lucy[,:]?\s+)?(?:tell me about|find out about|find info(?:rmation)? (?:on|about)|look into)\s+(.+)/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:what is|what's|who is|who's)\s+(.+)/i,
    /\b(?:can you|could you|would you)\s+(?:find|get)\s+(?:info(?:rmation)?)\s+(?:on|about)\s+(.+)/i,
    /\b(?:tell me about|find out about|look into)\s+(.+)/i,
  ];
  for (const candidate of [stripped, raw]) {
    for (const re of lookupPatterns) {
      const m = candidate.match(re);
      if (m && m[1]) {
        const query = cleanSearchQuery(m[1]);
        if (query.length > 1 && !/^(?:the\s+)?web$/i.test(query)
          && !JUNK_SEARCH_QUERY.test(query) && !LOOKUP_ABOUT_SELF.test(query)) {
          return query;
        }
      }
    }
  }

  return null;
}

/** True when the player wants a quick web lookup (CEO Lucy fast-path + skill followup). */
function looksLikeLookupMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (extractResearchBriefIntent(raw) || extractResearchQueueIntent(raw)) return false;
  if (extractSearchQuery(raw)) return true;
  const norm = normalizePlayerUtterance(fixVoiceMishearings(raw));
  return !!extractSearchQuery(norm);
}

/**
 * Bare topic after a search thread — e.g. "Takis", "Goldendoodles".
 * @param {string} text
 * @returns {string|null}
 */
function isCancelUtterance(text) {
  const s = normalizePlayerUtterance(fixVoiceMishearings(String(text || '').trim()));
  if (!s) return false;
  return /^(?:no|nah|nope|stop|cancel|wait|never\s*mind|nevermind|forget\s+it|scratch\s+that)\b/i.test(s)
    || /^(?:no|stop|cancel|wait)\s+/i.test(s)
    || /^no\s+luc(?:y|ie)?\b/i.test(s);
}

/** CEO wants Lucy to read/summarize what's in the browser. */
function extractBrowserReadIntent(text) {
  const raw = fixVoiceMishearings(String(text || '').trim());
  if (!raw) return false;
  const norm = normalizePlayerUtterance(raw);
  const variants = [raw, norm];
  for (const v of variants) {
    if (!v) continue;
    if (/\b(?:read|review|look\s+over|summarize|check\s+out)\b[\s\S]{0,80}\b(?:doc|document|page|article|site|tab)\b/i.test(v)
      && /\bbrowser\b/i.test(v)) return true;
    if (/\b(?:read|review|look\s+over)[\s\S]{0,40}\b(?:in\s+)?(?:the\s+)?browser\b/i.test(v)) return true;
    if (/\b(?:this\s+doc|the\s+doc|that\s+page)\b[\s\S]{0,40}\bbrowser\b/i.test(v)) return true;
  }
  return false;
}

function extractBareSearchTopic(text) {
  const s = normalizePlayerUtterance(fixVoiceMishearings(String(text || '').trim()));
  if (!s || s.length < 2) return null;
  if (isCancelUtterance(s)) return null;
  if (/\b(?:search|google|look\s+up|open|close|browser|meeting|follow|deploy|hey|hi|hello|thanks|thank you)\b/i.test(s)) {
    return null;
  }
  if (/^(?:yes|no|ok|okay|sure|stop|cancel|nope|yep)$/i.test(s)) return null;
  if (/^(?:no|stop|cancel|wait)\s+\w+/i.test(s)) return null;
  if (/[?!]/.test(s) && s.split(/\s+/).length > 4) return null;
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;
  const topic = cleanSearchQuery(s);
  if (!topic || topic.length < 2 || JUNK_SEARCH_QUERY.test(topic)) return null;
  return topic;
}

/**
 * CEO wants an NPC to control their real screen (click, type, fill forms).
 * Only when explicitly asked — not for read-only observe.
 * @param {string} text
 * @returns {boolean}
 */
function extractScreenControlIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\b(crm|meridian)\b/i.test(raw) && /\b(enter|add|log|create|save|put|type|insert)\b/i.test(raw)) {
    return false;
  }
  if (extractOpenBraveIntent(raw) || extractOpenBrowserIntent(raw)) return false;
  if (/\b(?:fill\s+(?:out|in)|complete (?:this |the )?(?:form|application)|help me (?:fill|apply|complete)|type (?:this |it |that )?for me|enter (?:this |it |that )?for me)\b/i.test(raw)) {
    return true;
  }
  if (/\b(?:fill out|fill in)\b.*\b(?:on my screen|for me|what you see|on screen|in brave)\b/i.test(raw)) {
    return true;
  }
  if (/\bdo it (?:on my screen|for me|on my computer|on my pc)\b/i.test(raw)) {
    return true;
  }
  if (/\b(?:on my (?:screen|computer|pc|machine)|use my (?:pc|computer|screen)|take over (?:my )?(?:screen|computer|pc)|control my (?:screen|computer|mouse|keyboard|desktop))\b/i.test(raw)) {
    return /\b(?:fill|click|type|enter|complete|apply|submit|help me|navigate|go to|open|do|run|install|download|search|find|write|edit|move|scroll|cowork)\b/i.test(raw);
  }
  if (/\b(?:cowork|co-work|like claude cowork|control (?:this|my) (?:pc|computer)|use (?:this|my) computer)\b/i.test(raw)) {
    return true;
  }
  if (/\b(?:do (?:this|that|it)|handle (?:this|that)|take care of (?:this|that))\b/i.test(raw)
    && /\b(?:on my (?:pc|computer|machine|desktop)|for me on (?:my )?(?:pc|computer)|locally)\b/i.test(raw)) {
    return true;
  }
  return false;
}

/**
 * True when the CEO wants an NPC to look at their real screen (read-only).
 * @param {string} text
 * @returns {boolean}
 */
function extractScreenObserveIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (extractScreenControlIntent(raw)) return false;
  if (/https?:\/\/\S+/i.test(raw) && /\b(?:i'?m on|im on|on here|look at|see what|on there|jobs on there|find jobs on there|scan|what(?:'s| is) on)\b/i.test(raw)) {
    return true;
  }
  return /\b(?:do you see(?:\s+it)?|can you see(?:\s+it)?|what(?:'s| is) (?:on |this |there)|see what (?:i |you )?typed|see (?:it|this|what|my|the)|look at (?:this|it|my screen|there|what i)|typed it for you|i typed it(?: for you)?|on my screen|what am i looking at|watch(?:ing)? (?:my |what i'?m )|look over (?:my |everything)|over my shoulder|i'?m on |im on |scan(?:ning)? (?:my |the )?(?:screen|feed|page|browser|brave)|take a screenshot|screenshot (?:my |the )?screen|look for jobs on there|jobs on there)\b/i.test(raw);
}

/**
 * Open Indeed or LinkedIn job search directly (not DDG).
 * @param {string} text
 * @returns {{ site: string, query: string, url: string }|null}
 */
function extractJobBoardSearchIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const stripped = raw
    .replace(/^(?:hey|hi|hello|ok)[,!\s]+/i, '')
    .replace(/^(?:hey|hi|hello)\s+lucy[,:\s]+/i, '')
    .replace(/^\s*lucy[,:\s]+/i, '')
    .trim();

  let site = null;
  if (/\bindeed\b/i.test(stripped)) site = 'indeed';
  else if (/\blinkedin\b/i.test(stripped)) site = 'linkedin';
  if (!site) return null;

  const wantsJobs = /\b(?:jobs?|roles?|openings?|positions?|look(?:ing)?\s+(?:for|up)|search(?:ing)?|find|hiring)\b/i.test(stripped)
    || /\b(?:on|at|in)\s+(?:indeed|linkedin)\b/i.test(stripped);
  if (!wantsJobs) return null;

  let query = '';
  const qm = stripped.match(/\b(?:for|searching?\s+for|look(?:ing)?\s+(?:for|up))\s+(.+)/i);
  if (qm && qm[1]) {
    query = qm[1]
      .replace(/[.?!]+$/, '')
      .replace(/\b(?:on|at|in)\s+(?:indeed|linkedin)\b/gi, '')
      .replace(/\b(?:indeed|linkedin)\b/gi, '')
      .trim();
  }

  const urls = {
    indeed: (q) => `https://www.indeed.com/jobs${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    linkedin: (q) => `https://www.linkedin.com/jobs/search/${q ? `?keywords=${encodeURIComponent(q)}` : ''}`,
  };
  return { site, query, url: urls[site](query) };
}

function extractBrowserStatusIntent(text) {
  return /\b(?:what browser|which browser|browser are you using)\b/i.test(String(text || ''));
}

/**
 * Open Lucy's visible Playwright browser — not full desktop control.
 * @param {string} text
 * @returns {boolean}
 */
function extractOpenBraveIntent(text) {
  const raw = String(text || '').trim().replace(/\bbroser\b/gi, 'browser');
  if (!raw) return false;
  return /\b(?:open|launch|start)\s+(?:the\s+|your\s+|my\s+)?brave(?:\s+browser)?\b/i.test(raw)
    || /\b(?:open|launch)\s+(?:the\s+|my\s+)?browser\s+in\s+brave\b/i.test(raw);
}

function extractOpenBrowserIntent(text) {
  const raw = fixVoiceMishearings(String(text || '').trim()).replace(/\bbroser\b/gi, 'browser');
  if (!raw) return false;
  if (/\b(crm|meridian)\b/i.test(raw) && /\b(enter|add|log|create|save|put|type|insert)\b/i.test(raw)) {
    return false;
  }
  const norm = normalizePlayerUtterance(raw).replace(/\bbroser\b/gi, 'browser');
  if (extractOpenBraveIntent(raw) || extractOpenBraveIntent(norm)) return false;
  if (extractSearchQuery(raw) || extractSearchQuery(norm) || extractJobBoardSearchIntent(raw)) return false;
  const openBrowserRe = /\b(?:open|launch|start|culture)\s+(?:up\s+)?(?:the\s+|your\s+|my\s+|a\s+)?(?:web\s+)?browser\b/i;
  const openUpBrowserRe = /\b(?:open|launch|start)\s+up\s+(?:a\s+|the\s+|your\s+|my\s+)?(?:web\s+)?browser\b/i;
  // "open the web", "can you open the web", polite wrappers
  const openWebRe = /(?:^|\b)(?:(?:can|could|would)\s+you\s+|please\s+)?(?:open|launch|start)\s+(?:the\s+|your\s+|my\s+|a\s+)?web\b/i;
  const wantsBrowser = openBrowserRe.test(raw) || openBrowserRe.test(norm)
    || openUpBrowserRe.test(raw) || openUpBrowserRe.test(norm)
    || openWebRe.test(raw) || openWebRe.test(norm);
  return wantsBrowser
    && !/\b(?:notepad|calculator|spotify|chrome\s+app|brave|file|folder)\b/i.test(raw);
}

/** Retry last Lucy browser search — e.g. "open a browser and do it again". */
function extractBrowserRetryIntent(text) {
  const raw = String(text || '').trim();
  const retryRe = /\b(?:again|retry|do it again|try again|search(?:\s+it)?\s+again|run it again|one more time)\b/i;
  if (!raw || !retryRe.test(raw)) return null;
  const norm = normalizePlayerUtterance(raw);
  const wantsOpen = extractOpenBrowserIntent(raw) || extractOpenBrowserIntent(norm)
    || wantsLucyBrowserOpen(raw) || wantsLucyBrowserOpen(norm);
  const retryOnly = /\b(?:try|search|do it|run it)(?:\s+it)?\s+again\b/i.test(raw)
    || /\b(?:try|search|do it|run it)(?:\s+it)?\s+again\b/i.test(norm);
  if (wantsOpen) return { openBrowser: true, retrySearch: true };
  if (retryOnly && !extractSearchQuery(raw) && !extractSearchQuery(norm)) {
    return { openBrowser: false, retrySearch: true };
  }
  return null;
}

/** True when the CEO wants Lucy's Playwright browser — checks raw + STT-fixed + normalized forms. */
function wantsLucyBrowserOpen(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const variants = [raw, fixVoiceMishearings(raw), normalizePlayerUtterance(raw)];
  const fixed = fixVoiceMishearings(raw);
  if (fixed !== raw) variants.push(normalizePlayerUtterance(fixed));
  for (const v of variants) {
    if (v && extractOpenBrowserIntent(v)) return true;
  }
  return false;
}

/**
 * CEO wants to close Lucy's visible browser.
 * @param {string} text
 * @returns {boolean}
 */
function extractCloseBrowserIntent(text) {
  const raw = String(text || '').trim().replace(/\bbroser\b/gi, 'browser');
  return /\b(?:close|shut)\s+(?:the\s+|your\s+|my\s+)?(?:web\s+)?browser(?:\s+now)?\b/i.test(raw)
    || /\bclose\s+the\s+browser\s+now\b/i.test(raw);
}

function extractJobBoardHelpIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (/\b(?:no|was asking|asked|meant)\s+lucy\b/i.test(raw)) return null;
  if (/\b(?:do you know how to use|how do you use|can you use|know how to use)\b/i.test(raw)
    && /\b(?:indeed|linkedin)\b/i.test(raw)
    && /\b(?:job|search|tool)\b/i.test(raw)) {
    return /\blinkedin\b/i.test(raw) ? 'linkedin' : 'indeed';
  }
  if (/\b(?:linkedin|indeed)\b/i.test(raw) && /\b(?:job search|jobs tool|search tool)\b/i.test(raw)) {
    return /\blinkedin\b/i.test(raw) ? 'linkedin' : 'indeed';
  }
  return null;
}

function isTunnelHost(url) {
  try {
    return /(?:^|\.)dolonia\.cloud$/i.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Pull a research-queue topic out of a player utterance.
 * Returns null when the message isn't a queue-add request.
 *
 * @param {string} text
 * @returns {{ topic: string, priority?: string }|null}
 */
function extractResearchQueueIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const stripped = raw
    .replace(/^(?:hey|hi|hello|ok)[,!\s]+/i, '')
    .replace(/^(?:hey|hi|hello)\s+lucy[,:\s]+/i, '')
    .replace(/^\s*lucy[,:\s]+/i, '')
    .trim();

  const priorityRe = /\b(?:priority|prio)\s+(high|low|normal|urgent)\b/i;
  const priorityMatch = stripped.match(priorityRe);
  const priority = priorityMatch ? priorityMatch[1].toLowerCase() : undefined;
  const noPriority = stripped.replace(priorityRe, '').replace(/\s+/g, ' ').trim();

  const patterns = [
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?add\s+(.+?)\s+to\s+(?:my\s+)?research\s+(?:list|queue)\b/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?queue\s+research\s+(?:on|about|for)\s+(.+)/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?put\s+(.+?)\s+on\s+(?:my\s+)?research\s+(?:list|queue)\b/i,
    /\bqueue\s+research\s+(?:on|about|for)\s+(.+)/i,
    /\badd\s+(.+?)\s+to\s+(?:my\s+)?research\s+(?:list|queue)\b/i,
  ];

  for (const candidate of [noPriority, stripped, raw]) {
    for (const re of patterns) {
      const m = candidate.match(re);
      if (m && m[1]) {
        const topic = m[1].replace(/[.?!]+$/, '').trim();
        if (topic && topic.length > 1) {
          return priority ? { topic, priority } : { topic };
        }
      }
    }
  }

  return null;
}

/**
 * Pull a deep-research brief topic out of a player utterance.
 * Returns null when the message isn't a brief request.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractResearchBriefIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const stripped = raw
    .replace(/^(?:hey|hi|hello|ok)[,!\s]+/i, '')
    .replace(/^(?:hey|hi|hello)\s+lucy[,:\s]+/i, '')
    .replace(/^\s*lucy[,:\s]+/i, '')
    .trim();

  const patterns = [
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?research\s+(.+?)\s+and\s+write\s+a\s+brief\b/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?do\s+(?:a\s+)?deep\s+research\s+(?:on|about|for)\s+(.+)/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?deep\s+research\s+(?:on|about|for)\s+(.+)/i,
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?write\s+a\s+(?:research\s+)?brief\s+(?:on|about|for)\s+(.+)/i,
    /\bdeep\s+research\s+(?:on|about|for)\s+(.+)/i,
    /\bresearch\s+(.+?)\s+and\s+write\s+a\s+brief\b/i,
  ];

  for (const candidate of [stripped, raw]) {
    for (const re of patterns) {
      const m = candidate.match(re);
      if (m && m[1]) {
        const topic = m[1].replace(/[.?!]+$/, '').trim();
        if (topic && topic.length > 1) return topic;
      }
    }
  }

  return null;
}

var __OpenClawDispatchApi = {
  classify,
  fixVoiceMishearings,
  normalizePlayerUtterance,
  cleanSearchQuery,
  extractSearchQuery,
  looksLikeLookupMessage,
  extractBareSearchTopic,
  cleanSearchQuery,
  extractScreenObserveIntent,
  extractScreenControlIntent,
  extractJobBoardSearchIntent,
  extractBrowserStatusIntent,
  extractOpenBrowserIntent,
  extractBrowserRetryIntent,
  extractBrowserReadIntent,
  isCancelUtterance,
  wantsLucyBrowserOpen,
  extractOpenBraveIntent,
  extractCloseBrowserIntent,
  extractJobBoardHelpIntent,
  isGreetingUtterance,
  isLucySearchIntent,
  isLucyStaffIntent,
  explicitlyAddressesNpc,
  resolveStaffIntentNpc,
  isDenizenNativeIntent,
  isTunnelHost,
  getActionPolicy,
  setActionPolicy,
  evaluateActionPolicy,
  extractResearchQueueIntent,
  extractResearchBriefIntent,
  ACTION_VERBS,
  TOOL_KEYWORDS,
  CHAT_MARKERS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __OpenClawDispatchApi;
}

// =====================================================================
// Browser dispatcher (skipped under Node — gated on `window`)
// =====================================================================

if (typeof window !== 'undefined') {

  const DEFAULT_GATEWAY_METHOD = 'chat.send';

  /**
   * Tiny helper: post an OpenClaw telemetry event to the server.
   * Fire-and-forget — never blocks the actual dispatch.
   */
  function _telemetry(event) {
    try {
      fetch('/api/telemetry/openclaw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    } catch (_) { /* never let telemetry IO break dispatch */ }
  }

  async function sendToGateway(text, opts = {}) {
    const correlationId = opts.correlationId || `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    _telemetry({
      tool: opts.tool || 'chat.send', source: 'gateway',
      args: { text: String(text || '').slice(0, 240), urgent: !!opts.urgent },
      status: 'started', correlationId,
    });

    const bridge = window.__DenizenGatewayBridge;
    if (!bridge || !bridge.connected) {
      _telemetry({
        tool: opts.tool || 'chat.send', source: 'gateway',
        status: 'failed', latencyMs: Date.now() - startedAt,
        error: 'gateway not connected', correlationId,
      });
      return { ok: false, error: 'gateway not connected', via: 'gateway', correlationId };
    }
    try {
      let res;
      if (typeof bridge.sendChat === 'function') {
        res = await bridge.sendChat(text, { urgent: !!opts.urgent });
      } else {
        const method = window.DenizenOpenClawChatMethod || DEFAULT_GATEWAY_METHOD;
        res = await bridge.request(method, {
          text,
          urgent: !!opts.urgent,
          source: 'denizen-player',
        });
      }
      _telemetry({
        tool: opts.tool || 'chat.send', source: 'gateway',
        status: 'succeeded', latencyMs: Date.now() - startedAt,
        response: res, correlationId,
      });
      return { ok: true, response: res, via: 'gateway', correlationId };
    } catch (err) {
      const msg = err?.message || String(err);
      _telemetry({
        tool: opts.tool || 'chat.send', source: 'gateway',
        status: 'failed', latencyMs: Date.now() - startedAt,
        error: msg, correlationId,
      });
      return { ok: false, error: msg, via: 'gateway', correlationId };
    }
  }

  async function sendToHttpProxy(text, opts = {}) {
    // Fallback path — POST to the OpenClaw HTTP proxy.
    // Endpoint is overridable via window.DenizenOpenClawChatPath (defaults to /openclaw/api/chat).
    const path = window.DenizenOpenClawChatPath || '/openclaw/api/chat';
    const correlationId = opts.correlationId || `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    _telemetry({
      tool: opts.tool || 'http.chat', source: 'http',
      args: { text: String(text || '').slice(0, 240), urgent: !!opts.urgent },
      status: 'started', correlationId,
    });
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, urgent: !!opts.urgent, source: 'denizen-player' }),
      });
      if (!res.ok) {
        const msg = `HTTP ${res.status}`;
        _telemetry({
          tool: opts.tool || 'http.chat', source: 'http',
          status: 'failed', latencyMs: Date.now() - startedAt,
          error: msg, correlationId,
        });
        return { ok: false, error: msg, via: 'http', correlationId };
      }
      let body = null;
      try { body = await res.json(); } catch (_) { body = await res.text(); }
      _telemetry({
        tool: opts.tool || 'http.chat', source: 'http',
        status: 'succeeded', latencyMs: Date.now() - startedAt,
        response: body, correlationId,
      });
      return { ok: true, response: body, via: 'http', correlationId };
    } catch (err) {
      const msg = err?.message || String(err);
      _telemetry({
        tool: opts.tool || 'http.chat', source: 'http',
        status: 'failed', latencyMs: Date.now() - startedAt,
        error: msg, correlationId,
      });
      return { ok: false, error: msg, via: 'http', correlationId };
    }
  }

  /**
   * Dispatch a player utterance.
   * 1. Classify.
   * 2. If action: try gateway → then HTTP fallback. Surface result.
   * 3. If chat: forward to PlayerChat.sendMessage (existing path).
   * Returns { kind, ok, via, error?, classification }
   */
  async function dispatch(text, opts = {}) {
    const c = classify(text);
    const out = { ...c };

    if (c.kind === 'chat') {
      if (window.__DenizenPlayerChat?.sendMessage) {
        try { window.__DenizenPlayerChat.sendMessage(c.stripped); }
        catch (err) { out.ok = false; out.error = err?.message; return out; }
        out.ok = true; out.via = 'player-chat';
        return out;
      }
      out.ok = false; out.error = 'no PlayerChat available'; return out;
    }

    const gate = evaluateActionPolicy(c.stripped, c);
    if (!gate.allowed) {
      return {
        ...out,
        ok: false,
        via: 'policy',
        requiresConfirmation: !!gate.requiresConfirmation,
        error: gate.reason,
        policy: gate.policy,
      };
    }

    // Action — gateway first
    let r = await sendToGateway(c.stripped, { urgent: c.urgent });
    if (r.ok) return { ...out, ...r };

    // Fall back to HTTP
    const r2 = await sendToHttpProxy(c.stripped, { urgent: c.urgent });
    if (r2.ok) return { ...out, ...r2, gatewayError: r.error };

    // Both failed — emit a visible error in the chat log AND fall back to chat.
    if (window.__DenizenPlayerChat?.sendMessage) {
      try { window.__DenizenPlayerChat.sendMessage(c.stripped); }
      catch (_) {}
      return { ...out, ok: false, via: 'fallback-chat',
               error: `gateway: ${r.error}; http: ${r2.error}` };
    }
    return { ...out, ok: false, error: `gateway: ${r.error}; http: ${r2.error}` };
  }

  window.DenizenOpenClawDispatch = {
    classify,
    fixVoiceMishearings,
    normalizePlayerUtterance,
    cleanSearchQuery,
    extractSearchQuery,
  looksLikeLookupMessage,
  extractBareSearchTopic,
  cleanSearchQuery,
    extractScreenObserveIntent,
    extractScreenControlIntent,
    extractJobBoardSearchIntent,
    extractBrowserStatusIntent,
    extractOpenBrowserIntent,
  extractBrowserRetryIntent,
  extractBrowserReadIntent,
  isCancelUtterance,
  wantsLucyBrowserOpen,
    extractOpenBraveIntent,
    extractCloseBrowserIntent,
    extractJobBoardHelpIntent,
    isGreetingUtterance,
  isLucySearchIntent,
  isLucyStaffIntent,
  explicitlyAddressesNpc,
  resolveStaffIntentNpc,
  isDenizenNativeIntent,
    isTunnelHost,
    extractResearchQueueIntent,
    extractResearchBriefIntent,
    dispatch,
    sendToGateway,
    sendToHttpProxy,
    getActionPolicy,
    setActionPolicy,
    evaluateActionPolicy,
  };
}

})();
