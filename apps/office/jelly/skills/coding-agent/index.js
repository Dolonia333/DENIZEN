'use strict';

module.exports = {
  meta: {
    name: 'coding-agent',
    description: 'Run Claude Code in an isolated worktree',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    const { targetFiles, task: skillTask } = params || {};
    const taskDesc = skillTask || `NPC ${npcName} coding task`;
    const activity = deps.pcActivity.record({
      npc: npcName, kind: 'coding-agent',
      task: taskDesc, mode: 'background', status: 'started',
      detail: Array.isArray(targetFiles) && targetFiles.length
        ? `files: ${targetFiles.join(', ').slice(0, 200)}` : null,
    });
    const codingStart = Date.now();
    const result = await deps.codingTaskRunner.runCodingTask({
      npc: npcName,
      task: taskDesc,
      targetFiles: Array.isArray(targetFiles) ? targetFiles : [],
      skillParams: params,
      broadcast,
    });
    const output = result.ok ? JSON.stringify(result) : `Error: ${result.error}`;
    deps.pcActivity.record({
      id: activity.id, npc: npcName, kind: 'coding-agent',
      task: taskDesc, mode: 'background',
      status: result.ok ? 'done' : 'failed',
      durationMs: Date.now() - codingStart,
      detail: String(output).slice(0, 240),
    });
    return { ok: result.ok, output, skill: 'coding-agent' };
  },
};
