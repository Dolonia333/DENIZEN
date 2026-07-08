'use strict';

module.exports = {
  meta: {
    name: 'job-pipeline',
    description: 'Full job search + apply pipeline (Lucy)',
    mode: 'visible',
    aliases: ['job-scraper', 'job-applier'],
  },
  async run({ npcName, params, broadcast, deps, skill }) {
    if (npcName !== 'Lucy') {
      return {
        ok: false,
        output: 'Job pipeline is Lucy-only. Other NPCs can use research or web-search.',
        skill: 'job-pipeline',
      };
    }

    const activity = deps.pcActivity.record({
      npc: npcName, kind: 'job-pipeline',
      task: `${params.query || params.q || 'job search'} on ${params.site || 'linkedin'}`,
      mode: 'visible', status: 'started',
    });
    const pipelineStart = Date.now();

    try {
      const summary = await deps.jobApplication.runJobPipeline({
        query: params.query || params.q || 'software engineer',
        site: params.site || 'linkedin',
        pages: Number(params.pages || 2),
        remoteOnly: Boolean(params.remoteOnly || params['remote-only']),
        minSalary: Number(params.minSalary || 0),
      }, { npcBrains: deps.npcBrains });

      deps.pcActivity.record({
        id: activity.id, npc: npcName, kind: 'job-pipeline',
        task: activity.task, mode: 'visible', status: 'done',
        durationMs: Date.now() - pipelineStart, detail: String(summary).slice(0, 240),
      });
      broadcast({ type: 'lucy_job_pipeline_done', summary });
      deps.log?.info?.(deps.jelly?.logTag || 'Jelly 🪼', `Lucy ← job-pipeline: ${summary.slice(0, 80)}`);
      return { ok: true, output: summary, skill: 'job-pipeline' };
    } catch (err) {
      const output = `Job pipeline failed: ${err?.message || err}`;
      deps.pcActivity.record({
        id: activity.id, npc: npcName, kind: 'job-pipeline',
        task: activity.task, mode: 'visible', status: 'failed',
        durationMs: Date.now() - pipelineStart, detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: 'job-pipeline' };
    }
  },
};
