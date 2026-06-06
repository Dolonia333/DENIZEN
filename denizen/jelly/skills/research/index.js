'use strict';

module.exports = {
  meta: {
    name: 'research',
    description: 'Brave web search + optional page read for NPC reasoning',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    const webResearch = deps.webResearch;
    const pcActivity = deps.pcActivity;
    const query = params?.query || params?.q || params?.topic || params?.task || '';
    const researchStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'research', task: `research: ${String(query).slice(0, 120)}`,
      mode: 'background', status: 'started',
    });

    const result = await webResearch.research(query, {
      count: Number(params?.count) || 5,
      read: params?.read != null ? Number(params.read) : 1,
    });
    const formatted = webResearch.formatForNpc(result);
    const ok = !result.error || result.results.length > 0;
    pcActivity.record({
      id: activity.id, npc: npcName, kind: 'research', task: activity.task,
      mode: 'background', status: ok ? 'done' : 'failed',
      durationMs: Date.now() - researchStart,
      detail: `${result.results.length} results`,
    });
    broadcast({
      type: 'npc_research', npcName, query: result.query,
      sources: result.results.map(r => ({ title: r.title, url: r.url })),
      ts: Date.now(),
    });
    deps.log?.info?.(deps.jelly?.logTag || 'Jelly 🪼', `${npcName} researched "${String(query).slice(0, 60)}" → ${result.results.length} sources`);
    return {
      ok,
      output: formatted,
      skill: 'research',
      broadcastResult: true,
      inject: true,
    };
  },
};
