'use strict';

const path = require('node:path');

let cloudVm = null;
try { cloudVm = require('../../../src/cloud-vm-provider'); } catch (_) {}

module.exports = {
  meta: {
    name: 'cloud-vm',
    description: 'Provision cloud/Proxmox/Docker VMs for isolated NPC workloads',
    mode: 'background',
    aliases: ['proxmox-vm', 'provision-vm'],
  },
  async run({ npcName, params, deps, skill }) {
    const action = String(params.action || 'list').toLowerCase();
    const denizenRoot = deps.denizenRoot || path.join(__dirname, '..', '..', '..');
    const approvedMap = typeof deps.approvedSkillScripts === 'function'
      ? deps.approvedSkillScripts()
      : (deps.approvedSkillScripts || {});

    if (!cloudVm) {
      return { ok: false, output: 'cloud-vm-provider unavailable', skill };
    }

    if (action === 'create' || action === 'provision') {
      const result = await cloudVm.createVm({
        npcName,
        label: params.label || params.name || 'workload',
        provider: params.provider || 'auto',
        cores: params.cores,
        memoryMb: params.memory_mb || params.memoryMb,
        image: params.image,
        denizenRoot,
        approved: cloudVm.canProvision(npcName, approvedMap),
        approvedMap,
      });
      const output = result.ok
        ? `VM ${result.vm.id} via ${result.vm.provider}`
        : `Provision failed: ${result.error}`;
      return { ok: result.ok, output, skill, vm: result.vm };
    }

    if (action === 'destroy') {
      const result = await cloudVm.destroyVm({ id: params.id, denizenRoot });
      return { ok: result.ok, output: result.ok ? `Destroyed ${params.id}` : result.error, skill };
    }

    const list = cloudVm.listVms({ npcName: params.all ? null : npcName, denizenRoot });
    const lines = list.vms.map((v) => `${v.id} · ${v.provider} · ${v.label} · ${v.status}`);
    return {
      ok: true,
      output: lines.length ? lines.join('\n') : '(no cloud VMs)',
      skill,
    };
  },
};
