'use strict';

const path = require('node:path');

let vmSandbox = null;
try { vmSandbox = require('../../../src/compute/vm-sandbox'); } catch (_) {}

module.exports = {
  meta: {
    name: 'docker-sandbox',
    description: 'Isolated Docker sandboxes (lightweight VMs) for NPC workloads',
    mode: 'background',
    aliases: ['vm-sandbox', 'sandbox'],
  },
  async run({ npcName, params, deps, skill }) {
    const action = String(params.action || 'list').toLowerCase();
    const denizenRoot = deps.denizenRoot || path.join(__dirname, '..', '..', '..');
    const approvedMap = typeof deps.approvedSkillScripts === 'function'
      ? deps.approvedSkillScripts()
      : (deps.approvedSkillScripts || {});

    if (!vmSandbox) {
      return { ok: false, output: 'vm-sandbox module unavailable', skill };
    }

    if (action === 'create') {
      const approved = vmSandbox.canCreateSandbox(npcName, approvedMap);
      const result = await vmSandbox.createSandbox({
        npcName,
        label: params.label || params.name || 'workload',
        image: params.image,
        command: params.command || params.cmd,
        denizenRoot,
        approved,
      });
      const output = result.ok
        ? `Sandbox created: ${result.sandbox.id} (${result.sandbox.image})`
        : `Create failed: ${result.error}`;
      return { ok: result.ok, output, skill, sandbox: result.sandbox };
    }

    if (action === 'exec') {
      const result = await vmSandbox.execInSandbox({
        id: params.id || params.sandbox_id,
        command: params.command || params.cmd || 'echo hello',
        denizenRoot,
      });
      return {
        ok: result.ok,
        output: result.ok ? result.output : result.error,
        skill,
      };
    }

    if (action === 'destroy') {
      const result = await vmSandbox.destroySandbox({ id: params.id || params.sandbox_id, denizenRoot });
      const output = result.ok ? `Destroyed ${result.sandbox.id}` : result.error;
      return { ok: result.ok, output, skill };
    }

    if (action === 'status') {
      const result = vmSandbox.statusSandbox({ id: params.id || params.sandbox_id, denizenRoot });
      const output = result.ok ? JSON.stringify(result.sandbox, null, 2) : result.error;
      return { ok: result.ok, output: output.slice(0, 800), skill };
    }

    const list = vmSandbox.listSandboxes({ npcName: params.all ? null : npcName, denizenRoot });
    const lines = list.sandboxes.map((s) => `${s.id} · ${s.label} · ${s.status} · ${s.image}`);
    return {
      ok: true,
      output: lines.length ? lines.join('\n') : '(no active sandboxes)',
      skill,
    };
  },
};
