'use strict';

module.exports = {
  meta: {
    name: 'health-check',
    description: 'Server, LM Studio, and mesh health diagnostics',
    mode: 'background',
    aliases: ['health', 'diagnostics'],
  },
  async run({ npcName, params, deps, skill }) {
    const action = String(params.action || params.scope || 'full').toLowerCase();
    const runbook = deps.healthRunbook;
    if (!runbook?.check) {
      return { ok: false, output: 'health-runbook module unavailable', skill };
    }
    const report = await runbook.check({ scope: action, deps });
    const output = JSON.stringify(report, null, 2).slice(0, 2000);
    const ok = report?.ok !== false;
    return { ok, output, skill, report };
  },
};
