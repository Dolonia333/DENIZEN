'use strict';

const { exec } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30000;

let skillContracts = null;
try { skillContracts = require('../src/denizen-skill-contracts'); } catch (_) {}

let impactGates = null;
try { impactGates = require('../src/denizen-impact-gates'); } catch (_) {}

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

    // A+ P1.2 — contract gate (validate + cooldown). Unknown contracts pass through.
    let params = skillParams && typeof skillParams === 'object' ? skillParams : {};
    const contract = skillContracts?.getContract?.(skill) || null;
    if (skillContracts?.validateSkillArgs) {
      const v = skillContracts.validateSkillArgs(skill, params);
      if (!v.ok) {
        skillContracts.recordSkillOutcome?.(skill, 'invalid', {
          error: (v.errors || []).join('; '),
          npc: npcName,
        });
        const result = {
          ok: false,
          error: 'invalid_skill_args',
          errors: v.errors || [],
          output: `Invalid args for ${skill}: ${(v.errors || []).join('; ')}`,
          skill,
          npcName,
        };
        broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output: result.output.slice(0, 200), ts: Date.now() });
        return result;
      }
      params = v.normalized || params;

      const cd = skillContracts.checkCooldown?.(skill);
      if (cd && cd.ok === false) {
        const result = {
          ok: false,
          error: 'skill_cooldown',
          waitMs: cd.waitMs || 0,
          output: `Skill ${skill} cooling down (${Math.ceil((cd.waitMs || 0) / 1000)}s left)`,
          skill,
          npcName,
        };
        broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output: result.output.slice(0, 200), ts: Date.now() });
        return result;
      }
      skillContracts.markSkillStart?.(skill);
    }

    // A+ trust gate — high-impact skills need human approval first.
    if (impactGates?.gateSkillRun) {
      try {
        const gated = impactGates.gateSkillRun(npcName, skill, params, ctx.policy || this.deps.orgPolicy || null);
        if (gated && gated.ok === false) {
          broadcast({
            type: 'npc_skill_result',
            npcName,
            skill,
            ok: false,
            output: String(gated.output || gated.error || 'approval_required').slice(0, 200),
            approvalId: gated.approvalId || null,
            ts: Date.now(),
          });
          return gated;
        }
      } catch (_) {
        // fail-open if gate module errors
      }
    }

    if (resolved.source === 'legacy' || !resolved.run) {
      return this._runLegacy(npcName, skill, params, resolved, ctx, contract);
    }

    const runCtx = {
      npcName,
      params,
      skill,
      broadcast,
      contract,
      deps: {
        ...this.deps,
        identityId: ctx.identityId || this.deps.identityId || null,
        ownerIdentityId: ctx.identityId || this.deps.ownerIdentityId || null,
        ownerProfile: ctx.ownerProfile || this.deps.ownerProfile || null,
      },
      config: this.deps.config || {},
      ...ctx,
      params,
    };

    const tag = this.deps.jelly?.logTag || 'Jelly 🪼';
    this.deps.log?.info?.(tag, `${npcName} → ${skill} (native)`);
    broadcast({ type: 'npc_skill_start', npcName, skill, skillParams: params, ts: Date.now() });

    const timeoutMs = contract?.timeout_ms || this.timeoutMs;
    const started = Date.now();
    let timer = null;
    try {
      const result = await Promise.race([
        resolved.run(runCtx),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`skill timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      const out = {
        ok: result?.ok !== false,
        output: result?.output || '',
        skill: result?.skill || skill,
        npcName,
        ...result,
      };
      if (contract?.inject_template && out.output && result?.inject !== false) {
        const injectText = _applyInjectTemplate(contract.inject_template, { ...params, output: out.output });
        this.deps.npcBrains?.injectSkillResult(npcName, out.skill, injectText);
      } else if (result?.inject !== false && out.output) {
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
      skillContracts?.recordSkillOutcome?.(skill, out.ok ? 'success' : 'fail', {
        durationMs: Date.now() - started,
        npc: npcName,
      });
      return out;
    } catch (err) {
      if (timer) clearTimeout(timer);
      const output = `${skill} failed: ${err.message}`;
      this.deps.npcBrains?.injectSkillResult(npcName, skill, output);
      broadcast({ type: 'npc_skill_result', npcName, skill, ok: false, output: output.slice(0, 200), ts: Date.now() });
      skillContracts?.recordSkillOutcome?.(skill, 'fail', {
        durationMs: Date.now() - started,
        error: err.message,
        npc: npcName,
      });
      return { ok: false, output, skill, npcName };
    }
  }

  _runLegacy(npcName, skill, skillParams, resolved, ctx, contract) {
    const broadcast = ctx.broadcast || this.deps.broadcast || (() => {});
    const log = this.deps.log;
    const tag = this.deps.jelly?.logTag || 'Jelly 🪼';
    log?.info?.(tag, `${npcName} → ${skill} (legacy subprocess)`);

    const scripts = ctx.approvedSkillScripts || this.deps.approvedSkillScripts || {};
    const scriptPath = resolved.scriptPath || scripts[skill];
    if (!scriptPath) {
      return Promise.resolve({
        ok: false,
        output: `No script path for legacy skill: ${skill}`,
        skill,
        npcName,
      });
    }

    const timeoutMs = contract?.timeout_ms || this.timeoutMs;
    const started = Date.now();
    return new Promise((resolve) => {
      const args = JSON.stringify(skillParams || {});
      const child = exec(
        `node "${scriptPath}" ${JSON.stringify(args)}`,
        { timeout: timeoutMs, windowsHide: true, cwd: this.deps.denizenRoot || process.cwd() },
        (err, stdout, stderr) => {
          const output = String(stdout || stderr || err?.message || '').trim();
          const ok = !err;
          if (output) this.deps.npcBrains?.injectSkillResult(npcName, skill, output);
          broadcast({
            type: 'npc_skill_result',
            npcName,
            skill,
            ok,
            output: output.slice(0, 200),
            ts: Date.now(),
          });
          skillContracts?.recordSkillOutcome?.(skill, ok ? 'success' : 'fail', {
            durationMs: Date.now() - started,
            npc: npcName,
          });
          resolve({ ok, output, skill, npcName });
        },
      );
      child.on('error', (e) => {
        resolve({ ok: false, output: e.message, skill, npcName });
      });
    });
  }
}

function _applyInjectTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v).slice(0, 400);
  });
}

module.exports = { SkillExecutor };
