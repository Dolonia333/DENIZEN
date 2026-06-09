'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vmSandbox = require('./vm-sandbox');

const MAX_CLOUD_VMS = Number(process.env.DENIZEN_MAX_CLOUD_VMS) || 4;

function storePath(denizenRoot) {
  const root = denizenRoot || path.join(__dirname, '..');
  const dir = path.join(root, 'data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return path.join(dir, 'cloud-vms.json');
}

function readStore(denizenRoot) {
  try {
    return JSON.parse(fs.readFileSync(storePath(denizenRoot), 'utf8'));
  } catch (_) {
    return { vms: [] };
  }
}

function writeStore(denizenRoot, data) {
  fs.writeFileSync(storePath(denizenRoot), JSON.stringify(data, null, 2), 'utf8');
}

function slugVm(npcName, label) {
  return `vm-${String(npcName || 'npc').toLowerCase().slice(0, 8)}-${String(label || 'work').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${Date.now().toString(36)}`;
}

const DEVOPS_NPCS = new Set(['Oscar', 'Abby', 'Edward', 'Alex']);

function canProvision(npcName, approvedMap = {}) {
  if (DEVOPS_NPCS.has(npcName)) return true;
  return !!(approvedMap['cloud-vm'] || approvedMap['docker-sandbox']);
}

async function createProxmoxVm({ name, cores = 2, memoryMb = 4096, templateId } = {}) {
  const base = process.env.PROXMOX_API_URL;
  const token = process.env.PROXMOX_TOKEN;
  const node = process.env.PROXMOX_NODE || 'pve';
  if (!base || !token) {
    return { ok: false, error: 'PROXMOX_API_URL and PROXMOX_TOKEN required for Proxmox VMs' };
  }
  const url = `${base.replace(/\/$/, '')}/api2/json/nodes/${encodeURIComponent(node)}/qemu`;
  const body = {
    vmid: Number(process.env.PROXMOX_VMID_START || 9000) + Math.floor(Math.random() * 500),
    name: name.slice(0, 63),
    cores: Number(cores) || 2,
    memory: Number(memoryMb) || 4096,
    ...(templateId ? { clone: templateId } : {}),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `PVEAPIToken=${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Proxmox HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  return { ok: true, provider: 'proxmox', vmid: body.vmid, response: data };
}

async function createWebhookVm({ name, spec, npcName } = {}) {
  const hook = process.env.CLOUD_VM_WEBHOOK_URL;
  if (!hook) {
    return { ok: false, error: 'CLOUD_VM_WEBHOOK_URL not configured' };
  }
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', name, spec, npc: npcName, ts: Date.now() }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `Webhook HTTP ${res.status}: ${text.slice(0, 200)}` };
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 500) }; }
  return { ok: true, provider: 'webhook', response: data };
}

async function createVm({
  npcName,
  label,
  provider = 'auto',
  cores,
  memoryMb,
  image,
  denizenRoot,
  approved = false,
  approvedMap = {},
} = {}) {
  if (!canProvision(npcName, approvedMap) && !approved) {
    return { ok: false, error: 'cloud-vm requires DevOps NPC or CEO-approved skill' };
  }

  const store = readStore(denizenRoot);
  const active = (store.vms || []).filter((v) => v.status !== 'destroyed');
  if (active.length >= MAX_CLOUD_VMS) {
    return { ok: false, error: `Cloud VM limit reached (${MAX_CLOUD_VMS})` };
  }

  const id = slugVm(npcName, label);
  const chosen = provider === 'auto'
    ? (process.env.PROXMOX_API_URL ? 'proxmox' : (process.env.CLOUD_VM_WEBHOOK_URL ? 'webhook' : 'docker'))
    : provider;

  let result;
  if (chosen === 'proxmox') {
    result = await createProxmoxVm({ name: id, cores, memoryMb, templateId: process.env.PROXMOX_TEMPLATE_ID });
  } else if (chosen === 'webhook') {
    result = await createWebhookVm({ name: id, spec: { cores, memoryMb, image }, npcName });
  } else {
    result = await vmSandbox.createSandbox({
      npcName,
      label: label || id,
      image,
      denizenRoot,
      approved: true,
    });
    if (result.ok) {
      result.provider = 'docker';
      result.vm = { id: result.sandbox.id, provider: 'docker', ...result.sandbox };
    }
  }

  if (!result.ok) return result;

  const entry = {
    id,
    npc: npcName,
    label: label || id,
    provider: result.provider || chosen,
    status: 'running',
    cores: cores || null,
    memory_mb: memoryMb || null,
    external_id: result.vmid || result.sandbox?.id || result.response?.id || null,
    created_at: new Date().toISOString(),
  };
  store.vms = [...active, entry];
  writeStore(denizenRoot, store);

  return { ok: true, vm: entry, detail: result };
}

async function destroyVm({ id, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  const vm = (store.vms || []).find((v) => v.id === id);
  if (!vm) return { ok: false, error: `VM not found: ${id}` };

  if (vm.provider === 'docker' && vm.external_id) {
    await vmSandbox.destroySandbox({ id: vm.external_id, denizenRoot }).catch(() => null);
  }

  vm.status = 'destroyed';
  vm.destroyed_at = new Date().toISOString();
  writeStore(denizenRoot, store);
  return { ok: true, vm };
}

function listVms({ npcName, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  let list = (store.vms || []).filter((v) => v.status !== 'destroyed');
  if (npcName) list = list.filter((v) => v.npc === npcName);
  return { ok: true, vms: list, limit: MAX_CLOUD_VMS };
}

module.exports = {
  createVm,
  destroyVm,
  listVms,
  canProvision,
  createProxmoxVm,
  createWebhookVm,
  MAX_CLOUD_VMS,
};
