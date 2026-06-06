'use strict';

const { exec } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30000;

class SkillExecutor {
  /**
   * @param {import('./skill-registry').SkillRegistry} registry
   * @param {object} deps — npcBrains, pcActivity, log, broadcast helpers, etc.
   */
  constructor(registry, deps = {}) {
    this.registry = registry;
    this.deps = deps;
    this.timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  async run(npcName, skill, skillParams = {}, ctx = {}) {
    const broadcast = ctx.broadcast || this.deps.broadcast || (() => {});
    const resolved = this.registry.resolve(skill);
    if (!resolved) {
      const result = { ok: false, output: `Unknown skill: ${skill}`, skill, npcName };
      broadcast({ type: 'npc_skill_result', ...result, ts: Date.now() });
      return result;
    }

    if (resolved.source === 'legacy' || !resolved.run) {
      return this._runLegacy(npcName, skill, skillParams, resolved, ctx);
    }

    const runCtx = {
      npcName,
      params: skillParams,
      skill,
      broadcast,
      deps: this.deps,
      config: this.deps.config || {},
      ...ctx,
    };

    const tag = this.deps.jelly?.logTag || 'Jelly 🪼';
    this.deps.log?.info?.(tag, `${npcName} → ${skill} (native)`);
    broadcast({ type: 'npc_skill_start', npcName, skill, skillParams, ts: Date.now() });

    try {
      const result = await resolved.run(runCtx);
      const out = {
        ok: result?.ok !== false,
        output: result?.output || '',
        skill: result?.skill || skill,
        npcName,
        ...result,
      };
      if (result?.inject !== false && out.output) {
        this.deps.npcBrains?.injectSkillResult(npcName, out.skill, out.output);
      }
      if (result?.broadcastResult !== false) {
        broadcast({
          type: 'npc_skill_result',
          npcName,
          skill: out.skill,
          ok: out.ok,
          output: String(out.output).slice(0, 200),
          ts: Date.now(),
        });
      }
      return out;
    } catch (err) {
      const output = `${skill} failed: ${err.message}`;
      this.deps.npcBrains?.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output: output.slice(0, 200), ts: Date.now() });
      return { ok: false, output, skill, npcName };
    }
  }

  _runLegacy(npcName, skill, skillParams, resolved, ctx) {
    const broadcast = ctx.broadcast || this.deps.broadcast || (() => {});
    const { pcActivity, log, npcBrains } = this.deps;
    const approved = ctx.approvedSkillScripts?.[skill];
    const scriptPath = approved || resolved.scriptPath;
    if (!scriptPath) {
      const result = { ok: false, output: `No script for skill: ${skill}`, skill, npcName };
      broadcast({ type: 'npc_skill_result', ...result, ts: Date.now() });
      return Promise.resolve(result);
    }

    const args = Object.entries(skillParams)
      .map(([k, v]) => `--${k} ${String(v).replace(/"/g, '\\"')}`)
      .join(' ');
    const cmd = `node "${scriptPath}"${args ? ` ${args}` : ''}`;
    const skillTaskDesc = skillParams?.task || skillParams?.query || skill;
    const activity = pcActivity?.record?.({
      npc: npcName, kind: 'skill', skill,
      task: String(skillTaskDesc).slice(0, 240),
      mode: skillParams?.mode === 'visible' ? 'visible' : 'background',
      status: 'started',
    });
    const skillStart = Date.now();

    log?.info?.('Harness', `${npcName} → ${skill} (legacy subprocess)`);
    broadcast({ type: 'npc_skill_start', npcName, skill, skillParams, ts: Date.now() });

    return new Promise((resolve) => {
      const child = exec(cmd, {
        windowsHide: true,
        timeout: this.timeoutMs,
        env: {
          ...process.env,
          AGENT_TOKEN: process.env.AGENT_TOKEN || '',
          SUPABASE_BRIDGE_URL: process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790',
          BROWSERCLAW_URL: process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792',
        },
      }, (err, stdout, stderr) => {
        const output = (stdout || stderr || (err ? err.message : 'no output')).slice(0, 800);
        const ok = !err;
        const result = { ok, output, skill, npcName };
        pcActivity?.record?.({
          id: activity?.id, npc: npcName, kind: 'skill', skill,
          task: activity?.task, mode: activity?.mode,
          status: ok ? 'done' : 'failed',
          durationMs: Date.now() - skillStart,
          detail: output.slice(0, 240),
        });
        npcBrains?.injectSkillResult(npcName, skill, output);
        broadcast({ type: 'npc_skill_result', npcName, skill, ok, output: output.slice(0, 200), ts: Date.now() });
        log?.info?.(tag, `${npcName} ← ${skill} (${ok ? 'ok' : 'err'}): ${output.slice(0, 80)}`);
        resolve(result);
      });
      setTimeout(() => { try { child.kill(); } catch (_) {} }, this.timeoutMs + 2000);
    });
  }
}

module.exports = { SkillExecutor };
