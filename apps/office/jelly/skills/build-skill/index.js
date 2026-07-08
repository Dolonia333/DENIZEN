'use strict';

module.exports = {
  meta: {
    name: 'build-skill',
    description: 'Draft a new NPC tool (quarantined until CEO approval)',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    const buildStart = Date.now();
    const activity = deps.pcActivity.record({
      npc: npcName, kind: 'build-skill',
      task: `draft skill: ${params?.name || params?.purpose || '?'}`,
      mode: 'background', status: 'started',
    });

    const generateFn = async (spec) => {
      const prompt = deps.skillBuilder.buildGenerationPrompt(spec);
      const overrides = params?.providerOverrides;
      let cfg = overrides?.primary
        || deps.npcBrains.providers?.kimi
        || deps.npcBrains.providers?.claude
        || deps.npcBrains.providers?.openai
        || deps.npcBrains.providers?.lmstudio
        || deps.npcBrains.providers?.demo;
      if (!cfg || cfg.type === 'demo') return null;
      const code = await deps.npcBrains._callProvider(cfg,
        'You are a careful Node.js tool author. Output ONLY runnable code, no prose, no fences.',
        [{ role: 'user', content: prompt }],
        { maxTokens: 1400, sliceLen: 8000, kind: 'skill-codegen', npc: npcName });
      if (!code && overrides?.fallback) {
        return deps.npcBrains._callProvider(overrides.fallback,
          'You are a careful Node.js tool author. Output ONLY runnable code, no prose, no fences.',
          [{ role: 'user', content: prompt }],
          { maxTokens: 1400, sliceLen: 8000, kind: 'skill-codegen', npc: npcName });
      }
      return code;
    };

    const result = await deps.skillBuilder.requestSkill({
      npc: npcName,
      name: params?.name,
      purpose: params?.purpose || params?.task,
      params: params?.params || [],
      researchContext: params?.researchContext || '',
      githubContext: params?.githubContext || '',
      requestedBy: params?.requestedBy || null,
      sourceMessage: params?.sourceMessage || '',
      generateFn,
    });

    const ok = !!result.ok;
    const output = ok
      ? `Drafted skill "${result.proposal.slug}" (${result.proposal.status}) — awaiting CEO approval before it can run.${result.proposal.scanFlags.length ? ' Safety flags: ' + result.proposal.scanFlags.join('; ') : ''}`
      : `Could not draft skill: ${result.error}`;

    deps.pcActivity.record({
      id: activity.id, npc: npcName, kind: 'build-skill', task: activity.task,
      mode: 'background', status: ok ? 'done' : 'failed',
      durationMs: Date.now() - buildStart, detail: output.slice(0, 240),
    });
    if (ok) {
      broadcast({
        type: 'npc_skill_proposal', npcName,
        proposal: {
          id: result.proposal.id, name: result.proposal.slug,
          status: result.proposal.status, scanFlags: result.proposal.scanFlags,
        },
        ts: Date.now(),
      });
    }
    deps.log?.info?.('SkillBuilder', `${npcName} drafted "${result.proposal?.slug || '?'}" → ${result.proposal?.status || 'error'}`);
    return {
      ok,
      output,
      skill: 'build-skill',
      proposal: ok ? result.proposal : null,
    };
  },
};
