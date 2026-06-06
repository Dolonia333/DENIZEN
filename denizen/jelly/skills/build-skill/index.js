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
      const cfg = deps.npcBrains.providers?.kimi
        || deps.npcBrains.providers?.lmstudio
        || deps.npcBrains.providers?.demo;
      if (!cfg || cfg.type === 'demo') return null;
      return deps.npcBrains._callProvider(cfg,
        'You are a careful Node.js tool author. Output ONLY runnable code, no prose, no fences.',
        [{ role: 'user', content: prompt }],
        { maxTokens: 1200, sliceLen: 6000, kind: 'skill-codegen', npc: npcName });
    };

    const result = await deps.skillBuilder.requestSkill({
      npc: npcName,
      name: params?.name,
      purpose: params?.purpose || params?.task,
      params: params?.params || [],
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
    return { ok, output, skill: 'build-skill' };
  },
};
