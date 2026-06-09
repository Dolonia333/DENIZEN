'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

const MAX_SANDBOXES = Number(process.env.DENIZEN_MAX_SANDBOXES) || 8;
const DEFAULT_IMAGE = process.env.DENIZEN_SANDBOX_IMAGE || 'node:20-alpine';

function storePath(denizenRoot) {
  const root = denizenRoot || path.join(__dirname, '..');
  const dir = path.join(root, 'data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return path.join(dir, 'vm-sandboxes.json');
}

function readStore(denizenRoot) {
  try {
    const raw = fs.readFileSync(storePath(denizenRoot), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : { sandboxes: [] };
  } catch (_) {
    return { sandboxes: [] };
  }
}

function writeStore(denizenRoot, data) {
  fs.writeFileSync(storePath(denizenRoot), JSON.stringify(data, null, 2), 'utf8');
}

function slugId(npcName, label) {
  const base = `${String(npcName || 'npc').toLowerCase()}-${String(label || 'sandbox').toLowerCase()}`
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `denizen-${base}-${Date.now().toString(36)}`;
}

async function dockerAvailable() {
  try {
    await execAsync('docker version --format "{{.Server.Version}}"', { windowsHide: true, timeout: 8000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function dockerRun(image, name, cmd) {
  const runCmd = cmd
    ? `docker run -d --name "${name}" "${image}" sh -c "${String(cmd).replace(/"/g, '\\"')}"`
    : `docker run -d --name "${name}" "${image}" sleep infinity`;
  const { stdout } = await execAsync(runCmd, { windowsHide: true, timeout: 120000 });
  return (stdout || '').trim();
}

async function createSandbox({ npcName, label, image, command, denizenRoot, approved = false } = {}) {
  if (!approved) {
    return { ok: false, error: 'docker-sandbox create requires CEO-approved skill or DevOps NPC' };
  }
  if (!(await dockerAvailable())) {
    return { ok: false, error: 'Docker is not installed or not running on this host' };
  }
  const store = readStore(denizenRoot);
  const active = (store.sandboxes || []).filter((s) => s.status !== 'destroyed');
  if (active.length >= MAX_SANDBOXES) {
    return { ok: false, error: `Sandbox limit reached (${MAX_SANDBOXES}). Destroy an old sandbox first.` };
  }
  const id = slugId(npcName, label);
  const img = image || DEFAULT_IMAGE;
  try {
    const containerId = await dockerRun(img, id, command);
    const entry = {
      id,
      container_id: containerId.slice(0, 12),
      npc: npcName,
      label: label || id,
      image: img,
      status: 'running',
      created_at: new Date().toISOString(),
      host: os.hostname(),
    };
    store.sandboxes = [...active, entry];
    writeStore(denizenRoot, store);
    return { ok: true, sandbox: entry };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function execInSandbox({ id, command, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  const sb = (store.sandboxes || []).find((s) => s.id === id && s.status === 'running');
  if (!sb) return { ok: false, error: `Sandbox not found: ${id}` };
  try {
    const { stdout, stderr } = await execAsync(
      `docker exec "${sb.id}" sh -c "${String(command || 'echo ok').replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
    );
    return { ok: true, output: (stdout || stderr || '').slice(0, 4000), sandbox: sb };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || String(err)).slice(0, 800), sandbox: sb };
  }
}

async function destroySandbox({ id, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  const sb = (store.sandboxes || []).find((s) => s.id === id);
  if (!sb) return { ok: false, error: `Sandbox not found: ${id}` };
  try {
    await execAsync(`docker rm -f "${sb.id}"`, { windowsHide: true, timeout: 30000 }).catch(() => {});
    sb.status = 'destroyed';
    sb.destroyed_at = new Date().toISOString();
    writeStore(denizenRoot, store);
    return { ok: true, sandbox: sb };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function listSandboxes({ npcName, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  let list = (store.sandboxes || []).filter((s) => s.status !== 'destroyed');
  if (npcName) list = list.filter((s) => s.npc === npcName);
  return { ok: true, sandboxes: list, limit: MAX_SANDBOXES };
}

function statusSandbox({ id, denizenRoot } = {}) {
  const store = readStore(denizenRoot);
  const sb = (store.sandboxes || []).find((s) => s.id === id);
  if (!sb) return { ok: false, error: `Sandbox not found: ${id}` };
  return { ok: true, sandbox: sb };
}

const DEVOPS_NPCS = new Set(['Oscar', 'Abby', 'Edward', 'Alex']);

function canCreateSandbox(npcName, approvedMap = {}) {
  if (DEVOPS_NPCS.has(npcName)) return true;
  return !!approvedMap['docker-sandbox'];
}

module.exports = {
  createSandbox,
  execInSandbox,
  destroySandbox,
  listSandboxes,
  statusSandbox,
  dockerAvailable,
  canCreateSandbox,
  MAX_SANDBOXES,
};
