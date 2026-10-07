'use strict';

/**
 * computer-use — general Playwright + vision browser agent (Muse/Grok-style).
 * Distinct from browserclaw (HTTP sidecar) and desktop-agent (nut-js whole PC).
 */

const computerUseAgent = require('../../../src/computer-use-agent');

module.exports = {
  meta: {
    name: 'computer-use',
    description: 'General browser computer-use (Playwright + vision) — Muse/Grok-style live browser tasks',
    mode: 'visible',
    aliases: ['computer-use-agent'],
  },
  async run({ npcName, params, broadcast, deps }) {
    const instruction = String(
      params?.task
      || params?.instruction
      || params?.query
      || params?.q
      || '',
    ).trim();
    if (!instruction) {
      return {
        ok: false,
        output: 'computer-use needs task/instruction describing what to do in the browser.',
        skill: 'computer-use',
      };
    }

    const url = params?.url || params?.directUrl || null;
    const taskMode = String(params?.taskMode || params?.mode || 'general').toLowerCase() === 'job-apply'
      ? 'job-apply'
      : 'general';
    const pcActivity = deps.pcActivity;
    const activity = pcActivity?.record?.({
      npc: npcName || 'Lucy',
      kind: 'computer-use',
      task: instruction.slice(0, 160),
      mode: 'visible',
      status: 'started',
    });
    const startedAt = Date.now();

    // Fire-and-forget — progress streams over WS (computer_use_* + browser mirror).
    computerUseAgent.runBrowserTask({
      instruction,
      url,
      profile: params?.profile || null,
      broadcast: broadcast || deps.broadcast,
      provider: params?.provider || null,
      browserMode: params?.browserMode || process.env.LUCY_BROWSER_MODE || 'auto',
      taskMode,
      mirror: params?.mirror !== false,
    }).then((result) => {
      pcActivity?.record?.({
        id: activity?.id,
        npc: npcName || 'Lucy',
        kind: 'computer-use',
        task: instruction.slice(0, 160),
        mode: 'visible',
        status: result?.ok ? 'done' : 'failed',
        durationMs: Date.now() - startedAt,
        detail: String(result?.error || `steps=${result?.steps || 0}`).slice(0, 240),
      });
      try {
        deps.npcBrains?.injectSkillResult?.(
          npcName || 'Lucy',
          'computer-use',
          result?.ok
            ? `Computer-use finished in ${result.steps || 0} steps.`
            : `Computer-use failed: ${result?.error || 'unknown'}`,
        );
      } catch (_) {}
    }).catch((err) => {
      pcActivity?.record?.({
        id: activity?.id,
        npc: npcName || 'Lucy',
        kind: 'computer-use',
        task: instruction.slice(0, 160),
        mode: 'visible',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        detail: String(err?.message || err).slice(0, 240),
      });
    });

    return {
      ok: true,
      async: true,
      output: `${npcName || 'Lucy'} is running computer-use in a live browser — watch the browser mirror.`,
      skill: 'computer-use',
    };
  },
};
