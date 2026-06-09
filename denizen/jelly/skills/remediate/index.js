'use strict';

module.exports = {
  meta: {
    name: 'remediate',
    description: 'Remediate common Denizen failures (mesh queue, stale jobs, verify)',
    mode: 'background',
    aliases: ['health-remediate', 'fix-health'],
  },
  async run({ npcName, params, deps, skill }) {
    const action = String(params.action || 'verify').toLowerCase();
    const runbook = deps.healthRunbook;
    if (!runbook?.remediate) {
      return { ok: false, output: 'health-runbook module unavailable', skill };
    }
    const destructive = [
      'drain-mesh-queue', 'clear-stale-jobs', 'reclaim-stale',
      'restart-lm-studio', 'lm-studio-restart',
    ].includes(action);
    const allowed = deps.canRemediate?.(npcName) !== false;
    if (destructive && !allowed) {
      return { ok: false, output: 'Remediate actions require CEO or DevOps role', skill };
    }
    if ((action === 'restart-lm-studio' || action === 'lm-studio-restart')
      && process.env.DENIZEN_AUTO_HEAL !== '1'
      && !allowed) {
      return { ok: false, output: 'LM Studio restart requires DevOps or DENIZEN_AUTO_HEAL=1', skill };
    }
    const result = await runbook.remediate({ action, deps });
    const output = typeof result.summary === 'string'
      ? result.summary
      : JSON.stringify(result, null, 2).slice(0, 1500);
    return { ok: result.ok !== false, output, skill, result };
  },
};
