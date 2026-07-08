'use strict';

/**
 * When an agent cannot run a task, orchestrate:
 *   discover local/GitHub skills → web research → build-skill (quarantined) → CEO notification.
 */

const skillDiscovery = require('./skill-discovery');

function extractPurpose(message) {
  const msg = String(message || '').trim();
  if (!msg) return 'custom automation';
  return msg
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:i\s+)?(?:need|want)\s+(?:a\s+)?(?:new\s+)?(?:skill|tool)\s+(?:to\s+|for\s+|that\s+)?/i, '')
    .replace(/^(?:build|create|draft|make)\s+(?:a\s+)?(?:skill|tool)\s+(?:to\s+|for\s+)?/i, '')
    .replace(/^(?:enable|unlock|grant)\s+(?:access\s+to\s+)?/i, '')
    .slice(0, 400) || msg.slice(0, 400);
}

function slugFromPurpose(purpose) {
  return String(purpose || 'custom-tool').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'custom-tool';
}

function isUnknownSkillResult(result) {
  const out = String(result?.output || result?.error || '').toLowerCase();
  return !result?.ok
    && (/unknown skill|no script for skill|could not draft skill/i.test(out)
      || result?.skill === '__unknown__');
}

function shouldOrchestrate({
  message,
  skillResult = null,
  plan = null,
  registry = null,
  approvedMap = {},
  isAssistant = false,
  canUseRealWork = false,
} = {}) {
  if (!canUseRealWork || !isAssistant) return false;
  const msg = String(message || '').trim();
  if (!msg) return false;

  if (isUnknownSkillResult(skillResult)) return true;

  const purpose = extractPurpose(msg);
  const slug = slugFromPurpose(purpose);

  if (plan?.skill && plan.skill !== 'build-skill') {
    const resolved = registry?.resolve?.(plan.skill);
    const approved = approvedMap[plan.skill];
    if (!resolved && !approved && plan.skill !== 'research' && plan.skill !== 'github') {
      return true;
    }
  }

  if (!plan?.skill) {
    if (/\b(build|create|draft|need|want|request)\b.*\b(skill|tool|automation|workflow)\b/i.test(msg)) {
      return true;
    }
    if (/\b(automate|monitor|scrape|integrate|scheduled|every\s+day)\b/i.test(msg)) {
      return true;
    }
    if (/\b(enable|unlock|grant)\b.*\b(access|skill|tool|automation)\b/i.test(msg)) {
      return true;
    }
  }

  if (approvedMap[slug]) return false;

  return false;
}

function buildProviderOverrides(providerKeys, npcBrains, meshContext) {
  const keys = providerKeys && typeof providerKeys === 'object' ? providerKeys : {};
  const anthropicKey = String(keys.anthropic || '').trim();
  const openaiKey = String(keys.openai || '').trim();

  if (!npcBrains) return null;

  if (anthropicKey && npcBrains.providers?.claude) {
    return {
      primary: { ...npcBrains.providers.claude, apiKey: anthropicKey, providerKey: 'anthropic' },
      fallback: npcBrains.providers.lmstudio || npcBrains.providers.claude,
      source: 'visitor_byok_anthropic',
    };
  }

  if (openaiKey && npcBrains.providers?.openai) {
    return {
      primary: { ...npcBrains.providers.openai, apiKey: openaiKey, providerKey: 'openai' },
      fallback: npcBrains.providers.lmstudio || npcBrains.providers.claude,
      source: 'visitor_byok_openai',
    };
  }

  return null;
}

function formatPipelineReply({ requestedBy, purpose, discovery, buildResult, usedExisting }) {
  if (usedExisting) {
    return `${requestedBy ? `${requestedBy}, ` : ''}You already have a skill for this: **${usedExisting.name}**. Ask me to run \`${usedExisting.name}\` with your task.`;
  }
  if (!buildResult?.ok) {
    return `${requestedBy ? `${requestedBy}, ` : ''}I researched "${purpose}" but could not draft a skill yet: ${buildResult?.error || 'generation failed'}. Try rephrasing or hand off to Lucy.`;
  }
  const p = buildResult.proposal;
  const flags = p?.scanFlags?.length ? ` (review flags: ${p.scanFlags.join('; ')})` : '';
  return `${requestedBy ? `${requestedBy}, ` : ''}I packaged a skill proposal **${p?.slug || 'new-skill'}** for Dolonia${flags}. Status: ${p?.status || 'pending'}. You'll be able to use it after CEO approval in Account → Skills.`;
}

/**
 * @param {object} ctx
 * @param {string} ctx.npcName
 * @param {string} ctx.message
 * @param {string} [ctx.requestedBy]
 * @param {object} ctx.deps — webResearch, skillBuilder, runBuildSkill, registry, approvedMap, denizenRoot, providerKeys, meshContext, npcBrains, broadcast
 */
async function runGapPipeline({
  npcName,
  message,
  requestedBy = null,
  purpose: purposeIn = null,
  deps = {},
} = {}) {
  const purpose = purposeIn || extractPurpose(message);
  const slug = slugFromPurpose(purpose);
  const broadcast = deps.broadcast || (() => {});

  const emit = (phase, detail = {}) => {
    broadcast({
      type: 'skill_gap_progress',
      npcName,
      phase,
      purpose: purpose.slice(0, 200),
      requestedBy,
      ...detail,
      ts: Date.now(),
    });
  };

  emit('discover');

  const discovery = await skillDiscovery.discoverSkills({
    purpose,
    registry: deps.registry,
    approvedMap: deps.approvedMap || {},
    denizenRoot: deps.denizenRoot,
    webResearch: deps.webResearch,
  });

  if (discovery.localMatch && discovery.localMatch.score >= 0.55) {
    const output = formatPipelineReply({
      requestedBy,
      purpose,
      discovery,
      usedExisting: discovery.localMatch,
    });
    emit('existing_skill', { skill: discovery.localMatch.name });
    broadcast({
      type: 'skill_gap_complete',
      npcName,
      ok: true,
      phase: 'existing_skill',
      skill: discovery.localMatch.name,
      output: output.slice(0, 500),
      ts: Date.now(),
    });
    return { ok: true, phase: 'existing_skill', skill: discovery.localMatch.name, output, discovery };
  }

  emit('research');

  let researchContext = '';
  if (deps.webResearch?.research) {
    try {
      const r = await deps.webResearch.research(
        `how to implement ${purpose} — API docs tutorial step by step`,
        { count: 5, read: 1 },
      );
      researchContext = deps.webResearch.formatForNpc(r).slice(0, 3500);
    } catch (_) {}
  }

  emit('github', { hits: discovery.github?.hits?.length || 0 });

  const githubContext = [
    discovery.github?.raw || '',
    discovery.webHints || '',
    discovery.summary || '',
  ].filter(Boolean).join('\n\n').slice(0, 3000);

  emit('build');

  const providerOverrides = buildProviderOverrides(
    deps.providerKeys,
    deps.npcBrains,
    deps.meshContext,
  );

  let buildResult = { ok: false, error: 'runBuildSkill not configured' };
  if (typeof deps.runBuildSkill === 'function') {
    buildResult = await deps.runBuildSkill(npcName, {
      name: slug,
      purpose,
      params: ['input', 'task'],
      researchContext,
      githubContext,
      providerOverrides,
      requestedBy,
      sourceMessage: String(message || '').slice(0, 500),
    });
  } else if (deps.skillBuilder?.requestSkill) {
    const generateFn = deps.makeGenerateFn?.(npcName, { providerOverrides });
    buildResult = await deps.skillBuilder.requestSkill({
      npc: npcName,
      name: slug,
      purpose,
      params: ['input', 'task'],
      generateFn,
      researchContext,
      githubContext,
    });
  }

  const output = formatPipelineReply({
    requestedBy,
    purpose,
    discovery,
    buildResult,
  });

  emit('complete', { proposalId: buildResult.proposal?.id, slug: buildResult.proposal?.slug });

  broadcast({
    type: 'skill_gap_complete',
    npcName,
    ok: !!buildResult.ok,
    phase: 'build_skill',
    proposal: buildResult.proposal ? {
      id: buildResult.proposal.id,
      slug: buildResult.proposal.slug,
      status: buildResult.proposal.status,
    } : null,
    output: output.slice(0, 600),
    ts: Date.now(),
  });

  if (buildResult.ok && typeof deps.notifyCeo === 'function') {
    try {
      await deps.notifyCeo({
        proposal: buildResult.proposal,
        requestedBy,
        message,
        purpose,
        npcName,
      });
    } catch (_) {}
  }

  return {
    ok: !!buildResult.ok,
    phase: 'build_skill',
    purpose,
    discovery,
    researchContext,
    githubContext,
    proposal: buildResult.proposal,
    output,
  };
}

module.exports = {
  extractPurpose,
  slugFromPurpose,
  isUnknownSkillResult,
  shouldOrchestrate,
  buildProviderOverrides,
  formatPipelineReply,
  runGapPipeline,
};
