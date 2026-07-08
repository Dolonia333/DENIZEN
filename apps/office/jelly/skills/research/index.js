'use strict';

const researchRouter = require('../../../src/intelligence/research-router');

module.exports = {
  meta: {
    name: 'research',
    description: 'Web research — Brave API or visible browser via mesh/desktop station',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps, skill }) {
    const webResearch = deps.webResearch;
    const pcActivity = deps.pcActivity;
    const query = researchRouter.extractQuery(params);
    const { backend } = researchRouter.resolveResearchRoute({ skillParams: params });
    const researchStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'research', task: `research: ${String(query).slice(0, 120)}`,
      mode: 'background', status: 'started',
    });

    const finish = (ok, output, extra = {}) => {
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'research', task: activity.task,
        mode: 'background', status: ok ? 'done' : 'failed',
        durationMs: Date.now() - researchStart,
        detail: String(output).slice(0, 240),
      });
      if (query) {
        broadcast({
          type: 'npc_research', npcName, query,
          sources: extra.sources || [],
          ts: Date.now(),
        });
      }
      return {
        ok,
        output,
        skill: 'research',
        broadcastResult: true,
        inject: true,
        ...extra,
      };
    };

    if (!query) {
      return finish(false, 'Research needs a query/topic.');
    }

    if (backend === 'mesh' && deps.computeQueue) {
      const mesh = await researchRouter.runMeshWebSearch({
        computeQueue: deps.computeQueue,
        npcName,
        query,
      });
      if (mesh.routed) {
        deps.log?.info?.(deps.jelly?.logTag || 'Jelly', `${npcName} research → mesh browser (${query.slice(0, 40)})`);
        return finish(mesh.ok, mesh.output || mesh.summary, { mesh: true, job_id: mesh.job_id });
      }
    }

    if ((backend === 'browser' || backend === 'mesh') && deps.runWebSearch) {
      deps.log?.info?.(deps.jelly?.logTag || 'Jelly', `${npcName} research → visible browser (${query.slice(0, 40)})`);
      broadcast({ type: 'npc_skill_start', npcName, skill: 'web-search', skillParams: { query }, ts: Date.now() });
      const r = await deps.runWebSearch(npcName, query, {
        broadcast,
        headless: false,
        quiet: false,
      });
      return finish(!!r.ok, r.summary || r.error || 'Browser search finished.', { browser: true });
    }

    const result = await webResearch.research(query, {
      count: Number(params?.count) || 5,
      read: params?.read != null ? Number(params.read) : 1,
    });
    const formatted = webResearch.formatForNpc(result);
    const ok = !result.error || result.results.length > 0;
    deps.log?.info?.(deps.jelly?.logTag || 'Jelly 🪼', `${npcName} researched "${String(query).slice(0, 60)}" → ${result.results.length} sources`);
    return finish(ok, formatted, { sources: result.results.map((r) => ({ title: r.title, url: r.url })) });
  },
};
