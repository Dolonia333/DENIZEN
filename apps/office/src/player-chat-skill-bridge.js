'use strict';

/**
 * Bridge player chat → Jelly run_skill for team visitors with a claimed assistant.
 * Parses [RUN_SKILL:...] tags from NPC replies and infers skills from user intent.
 */

let crmNpcPersonas = null;
try { crmNpcPersonas = require('./denizen-crm-npc-personas'); } catch (_) {}
let openclawDispatch = null;
try { openclawDispatch = require('./openclaw-dispatch'); } catch (_) {}

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

const DELEGATE_NPC_NAMES = [
  'Abby', 'Alex', 'Marcus', 'Sarah', 'Edward', 'Josh', 'Molly', 'Oscar', 'Pier', 'Rob',
  'Roki', 'Bouncer', 'Dan', 'Lucy', 'Jenny', 'Bob',
];

/** CEO message names another NPC to execute (e.g. "have Alex run_skill …"). */
function extractDelegateTarget(message) {
  const msg = String(message || '');
  const m = msg.match(/\b(?:have|ask|tell|get)\s+([A-Z][a-z]+)\s+(?:to\s+)?(?:run_skill|run)\b/);
  if (!m) return null;
  const name = m[1];
  return DELEGATE_NPC_NAMES.includes(name) ? name : null;
}

/** When CEO delegates, speaker must not run the inferred skill. */
function shouldDeferSkillToDelegatee(message, delegation) {
  const target = delegation?.delegateTo || extractDelegateTarget(message);
  return target || null;
}

function inferCodingTargetFiles(message, params = {}) {
  if (Array.isArray(params.targetFiles) && params.targetFiles.length) {
    return params.targetFiles;
  }
  const msg = String(message || '');
  const files = [];
  const quoted = msg.match(/[`"']([^`"']+\.[a-z0-9]{1,8})[`"']/gi) || [];
  for (const q of quoted) {
    const f = q.replace(/[`"']/g, '').trim();
    if (f && !files.includes(f)) files.push(f);
  }
  if (/\breadme\b/i.test(msg) && !files.includes('README.md')) files.push('README.md');
  return files;
}

function enrichCodingAgentParams(message, params = {}) {
  const out = { ...params };
  if (!out.task) out.task = String(message || '').trim();
  const targets = inferCodingTargetFiles(message, out);
  if (targets.length) out.targetFiles = targets;
  return out;
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

function skillParamsContentFromMessage(msg) {
  const block = String(msg || '').match(/```[\s\S]*?```/);
  if (block) return block[0].replace(/```/g, '').trim();
  const quoted = String(msg || '').match(/content\s*[`"']([^`"']+)[`"']/i);
  if (quoted) return quoted[1];
  return '';
}

function inferSkillFromMessage(npcName, message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  const name = String(npcName || '');

  const runSkillExplicit = msg.match(/\brun_skill\s*:?\s*([a-z][a-z0-9-]*)/i);
  if (runSkillExplicit) {
    const skill = normalizeSkillName(runSkillExplicit[1]);
    const quoted = msg.match(/(?:on|for|about)\s+["']([^"']+)["']/i);
    const topic = quoted?.[1]?.trim()
      || msg.replace(/^[\s\S]*?\brun_skill\s*:?\s*[a-z][a-z0-9-]*\s*/i, '').replace(/\s+and\s+save.*$/i, '').trim();
    if (skill === 'research' || skill === 'web-search') {
      return { skill: 'research', params: { query: topic || msg, read: 1 }, source: 'infer-explicit' };
    }
    return { skill, params: { task: topic || msg }, source: 'infer-explicit' };
  }

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

  const crmPlan = crmNpcPersonas?.inferCrmAction?.(msg);
  if (crmPlan) {
    if (crmNpcPersonas?.canNpcRunSkill?.(name, crmPlan.skill)) return crmPlan;
    return crmNpcPersonas.deferSkillPlan(msg, crmPlan.skill);
  }

  const businessPlan = crmNpcPersonas?.inferBusinessAction?.(msg);
  if (businessPlan) {
    if (crmNpcPersonas?.canNpcRunSkill?.(name, businessPlan.skill)) return businessPlan;
    return crmNpcPersonas.deferSkillPlan(msg, businessPlan.skill);
  }

  if (/\b(trend|trending|rss|news)\b/i.test(msg) && /\b(scrape|monitor|watch|feed)\b/i.test(msg)) {
    return { skill: 'trend-scraper', params: { task: msg }, source: 'infer' };
  }

  if (/\b(moderate|brand safety|legal scan|review)\b.*\b(content|post|publish)\b/i.test(msg)) {
    return { skill: 'content-moderation', params: { task: msg }, source: 'infer' };
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

  if (/\b(dossier|partnership\s+(?:pdf|brief|dossier)|technical\s+dossier|capability\s+statement|pdf\s+dossier)\b/i.test(msg)) {
    const params = { task: msg };
    if (/partnership|teaming|rm\s*cyber/i.test(msg)) {
      params.type = 'partnership-dossier';
      params.reader = 'partner';
      params.subject = '1921';
      params.skin = '1921';
      const forMatch = msg.match(/\bfor\s+([A-Z][A-Za-z0-9\s.&-]{2,40})/);
      if (forMatch) params.recipient = forMatch[1].trim();
      else if (/rm\s*cyber/i.test(msg)) params.recipient = 'RM Cyber';
    } else if (/technical|denizen/i.test(msg)) {
      params.type = 'technical-dossier';
      params.subject = 'denizen';
      params.skin = 'denizen';
      params.facts_ref = 'HEAD';
    } else if (/capability\s+statement|gov\s+buyer/i.test(msg)) {
      params.type = 'capability-statement';
      params.subject = '1921';
      params.skin = '1921';
    }
    return { skill: 'pdf-dossier', params, source: 'infer-dossier' };
  }

  if (/\b(pdf|report)\b/i.test(msg) && /\b(generate|build|draft|write)\b/i.test(msg)) {
    return { skill: 'pdf-generator', params: { task: msg }, source: 'infer' };
  }

  if (/\b(code|fix|bug|implement|refactor|patch)\b/i.test(msg)
    && /\b(dev|developer|senior|backend|frontend|intern)\b/i.test(name)
      || ['Alex', 'Josh', 'Edward', 'Jenny', 'Roki'].includes(name)) {
    return { skill: 'coding-agent', params: { task: msg }, source: 'infer' };
  }

  if (/\b(browser|navigate|scrape|browse)\b/i.test(msg)) {
    if (crmNpcPersonas?.isCrmDataEntryIntent?.(msg)) return null;
    return { skill: 'browserclaw', params: { task: msg }, source: 'infer' };
  }

  if (/\b(read|open|show)\b.*\b(file|document|folder)\b/i.test(msg)) {
    const pathMatch = msg.match(/(?:file|path)\s+[`"']?([^\s`"']+)[`"']?/i)
      || msg.match(/[`"']([^`"']+\.[a-z0-9]{1,6})[`"']/i);
    return {
      skill: 'file-read',
      params: { path: pathMatch?.[1] || msg.replace(/.*\b(?:read|open)\b/i, '').trim() },
      source: 'infer',
    };
  }

  if (/\b(write|save|create)\b.*\b(file|document)\b/i.test(msg)) {
    const pathMatch = msg.match(/(?:to|file|path)\s+[`"']?([^\s`"']+)[`"']?/i);
    return {
      skill: 'file-write',
      params: {
        path: pathMatch?.[1] || 'notes.txt',
        content: skillParamsContentFromMessage(msg),
      },
      source: 'infer',
    };
  }

  if (/\b(run|execute)\b.*\b(code|script|python|node)\b/i.test(msg)) {
    const cmdMatch = msg.match(/(?:run|execute)\s+(.+)/i);
    return {
      skill: 'run-code',
      params: { command: 'node', args: [cmdMatch?.[1]?.trim() || msg], task: msg },
      source: 'infer',
    };
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
  return /\b(research|look\s*up|fix|build|code|github|deploy|search|find|create|implement|run|help\s+me|can\s+you|crm|meridian|pipeline|contact|deal|setup|onboarding|industry|task|follow.?up)\b/i.test(String(message || ''));
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
  ceoLookup = false,
  ceoDirectOrder = false,
  extraSkills = null,
} = {}) {
  const extras = Array.isArray(extraSkills) ? extraSkills : [];
  const canRun = (name, skill) => crmNpcPersonas?.canNpcRunSkill?.(name, skill, extras);
  const crmInfer = crmNpcPersonas?.inferCrmAction?.(message);
  const businessInfer = !crmInfer ? crmNpcPersonas?.inferBusinessAction?.(message) : null;
  const dataInfer = crmInfer || businessInfer;
  if (dataInfer) {
    if (!canUseRealWork) {
      if (crmNpcPersonas?.isWriteSkill?.(dataInfer.skill)) {
        return {
          skill: 'crm-setup-status',
          params: { task: message, demoCoach: true },
          source: 'infer-crm-demo',
        };
      }
      if (canRun(npcName, dataInfer.skill)) return dataInfer;
    } else if (canRun(npcName, dataInfer.skill)) {
      return dataInfer;
    } else {
      return crmNpcPersonas.deferSkillPlan(message, dataInfer.skill);
    }
  }

  if (!canUseRealWork) return null;

  const tagged = parseRunSkillTags(responseText);
  if (tagged.length) return tagged[0];

  const inferLookup = ceoLookup
    || (npcName === 'Lucy' && openclawDispatch?.looksLikeLookupMessage?.(message));
  if (!isAssistant && !forceInfer && !inferLookup && !ceoDirectOrder) return null;

  const infer = inferSkillFromMessage(npcName, message);
  const taskLike = isTaskLikeMessage(message) || /\brun_skill\b/i.test(message);
  if (infer && (isAssistant || forceInfer || inferLookup || ceoDirectOrder) && taskLike) {
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
  extractDelegateTarget,
  shouldDeferSkillToDelegatee,
  inferCodingTargetFiles,
  enrichCodingAgentParams,
};
