'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const execAsync = promisify(exec);

module.exports = {
  meta: {
    name: 'github',
    description: 'GitHub operations via gh CLI',
    mode: 'background',
  },
  async run({ npcName, params, deps }) {
    const repo = params.repo || deps.githubRepo || 'Dolonia333/DENIZEN';
    const action = params.action || 'pr-list';
    let cmd;
    if (action === 'pr-list') cmd = `gh pr list --repo ${repo}`;
    else if (action === 'run-list') cmd = `gh run list --repo ${repo} --limit ${params.limit || 5}`;
    else if (action === 'issue-list') cmd = `gh issue list --repo ${repo}`;
    else cmd = `gh ${action} --repo ${repo}`;

    const activity = deps.pcActivity?.record?.({
      npc: npcName, kind: 'github', task: action, mode: 'background', status: 'started',
    });
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(cmd, { windowsHide: true, timeout: 30000 });
      const output = (stdout || stderr || 'no output').slice(0, 800);
      deps.pcActivity?.record?.({
        id: activity?.id, npc: npcName, kind: 'github', task: action,
        mode: 'background', status: 'done', durationMs: Date.now() - start,
        detail: output.slice(0, 240),
      });
      return { ok: true, output, skill: 'github' };
    } catch (err) {
      const output = (err.stdout || err.stderr || err.message || 'gh failed').slice(0, 800);
      deps.pcActivity?.record?.({
        id: activity?.id, npc: npcName, kind: 'github', task: action,
        mode: 'background', status: 'failed', durationMs: Date.now() - start,
        detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: 'github' };
    }
  },
};
