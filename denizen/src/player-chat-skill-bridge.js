'use strict';

/**
 * Bridge player chat → Jelly run_skill for team visitors with a claimed assistant.
 * Parses [RUN_SKILL:...] tags from NPC replies and infers skills from user intent.
 */

const RUN_SKILL_TAG = /\[RUN_SKILL:([a-z][a-z0-9-]*):([^\]]+)\]/gi;

const SKILL_ALIASES = {
  'web-search': 'research',
  websearch: 'research',
  search: 'research',
  'supabase-bridge': 'supabase',
};

function normalizeSkillName(name) {
  const raw = String(name || '').trim().toLowerCase();
  return SKILL_ALIASES[raw] || raw;
}

function parseParamsBlob(blob) {
  const s = String(blob || '').trim();
  if (!s) return {};
  if (s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return { task: s };
    }
  }
  const out = {};
  for (const part of s.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      if (!out.query && !out.task) out.query = part.trim();
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function parseRunSkillTags(text) {
  const plans = [];
  const src = String(text || '');
  let match;
  while ((match = RUN_SKILL_TAG.exec(src)) !== null) {
    plans.push({
      skill: normalizeSkillName(match[1]),
      params: parseParamsBlob(match[2]),
      source: 'tag',
    });
  }
  return plans;
}

function stripRunSkillTags(text) {
  return String(text || '').replace(RUN_SKILL_TAG, '').replace(/\s+$/, '').trim();
}

function inferSkillFromMessage(npcName, message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  const name = String(npcName || '');

  if (/\b(build|create|draft)\b.*\b(skill|tool)\b/i.test(msg)) {
    const purpose = msg.replace(/^(?:please\s+)?(?:build|create|draft)\s+(?:a\s+)?(?:skill|tool)\s+(?:to\s+|for\s+)?/i, '').trim();
    return {
      skill: 'build-skill',
      params: {
        name: purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'new-tool',
        purpose: purpose.slice(0, 200) || msg.slice(0, 200),
        params: ['input'],
      },
      source: 'infer',
    };
  }

  if (/\b(research|look\s*up|find\s+out|google|what\s+is|how\s+do\s+i)\b/i.test(msg)) {
    const query = msg
      .replace(/^(?:please\s+)?(?:research|look\s*up|find\s+out|google)\s+/i, '')
      .replace(/^(?:what\s+is|how\s+do\s+i)\s+/i, '')
      .trim();
    return { skill: 'research', params: { query: query || msg, read: 1 }, source: 'infer' };
  }

  if (/\b(github|pull\s+request|\bpr\b|issue\s+#?\d+)/i.test(msg)) {
    return { skill: 'github', params: { task: msg }, source: 'infer' };
  }

  if (/\b(code|fix|bug|implement|refactor|patch)\b/i.test(msg)
    && /\b(dev|developer|senior|backend|frontend|intern)\b/i.test(name)
      || ['Alex', 'Josh', 'Edward', 'Jenny', 'Roki'].includes(name)) {
    return { skill: 'coding-agent', params: { task: msg }, source: 'infer' };
  }

  if (/\b(browser|navigate|scrape|browse)\b/i.test(msg)) {
    return { skill: 'browserclaw', params: { task: msg }, source: 'infer' };
  }

  if (/\b(supabase|database|sql|schema)\b/i.test(msg)) {
    return { skill: 'supabase', params: { task: msg }, source: 'infer' };
  }

  if (/\b(job|apply|linkedin|resume)\b/i.test(msg) && name === 'Lucy') {
    return { skill: 'job-pipeline', params: { task: msg }, source: 'infer' };
  }

  if (/\b(search|find)\b/i.test(msg) && msg.length > 12) {
    return { skill: 'research', params: { query: msg, read: 1 }, source: 'infer' };
  }

  if (lower.startsWith('/run ') || lower.startsWith('/skill ')) {
    const rest = msg.replace(/^\/(?:run|skill)\s+/i, '').trim();
    const [skill, ...paramParts] = rest.split(/\s+/);
    if (skill) {
      return {
        skill: normalizeSkillName(skill),
        params: { task: paramParts.join(' ') || msg },
        source: 'infer',
      };
    }
  }

  return null;
}

function isTaskLikeMessage(message) {
  return /\b(research|look\s*up|fix|build|code|github|deploy|search|find|create|implement|run|help\s+me|can\s+you)\b/i.test(String(message || ''));
}

/** Teammate asking Lucy to enable, unlock, or author a new gated skill. */
function isSkillAccessRequest(message) {
  const msg = String(message || '').trim();
  if (!msg) return false;
  if (/\b(build|create|draft|author|write|make)\s+(?:a\s+)?(?:new\s+)?(?:skill|tool|automation|workflow|capabilit)/i.test(msg)) {
    return true;
  }
  if (/\b(need|want|request|get)\s+(?:a\s+)?(?:new\s+)?(?:skill|tool|access|capabilit)/i.test(msg)) {
    return true;
  }
  if (/\b(enable|unlock|grant|approve|allow)\b/i.test(msg)
    && /\b(team|access|skill|tool|automation|browser|capabilit|workflow)/i.test(msg)) {
    return true;
  }
  if (/\b(skill|capabilit|access)\s+(?:for|to)\b/i.test(msg)) {
    return true;
  }
  if (/\b(run|use)\s+(?:a\s+)?(?:custom\s+)?skill\b/i.test(msg)) {
    return true;
  }
  if (/\b(package|propos|submit).*\b(skill|tool|access)\b/i.test(msg)) {
    return true;
  }
  return false;
}

function lucySkillGateReply(displayName) {
  const lead = displayName ? `${displayName}, ` : '';
  return `${lead}I'll package that skill request and run it by Dolonia for approval. Once she approves, your team's assistants can use it — I'll follow up when it's ready.`;
}

/**
 * Pick the first executable skill plan for a player chat turn.
 */
function planSkillExecution({
  npcName,
  message,
  responseText,
  isAssistant = false,
  canUseRealWork = false,
  forceInfer = false,
} = {}) {
  if (!canUseRealWork) return null;

  const tagged = parseRunSkillTags(responseText);
  if (tagged.length) return tagged[0];

  if (!isAssistant && !forceInfer) return null;

  const infer = inferSkillFromMessage(npcName, message);
  if (infer && (isAssistant || forceInfer) && isTaskLikeMessage(message)) {
    return infer;
  }

  return null;
}

module.exports = {
  parseRunSkillTags,
  parseParamsBlob,
  stripRunSkillTags,
  inferSkillFromMessage,
  planSkillExecution,
  isTaskLikeMessage,
  isSkillAccessRequest,
  lucySkillGateReply,
  normalizeSkillName,
};
