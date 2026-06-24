'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let llamaChild = null;

const DEFAULT_PORT = 8081;
const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

function bundledLlamaServerPath() {
  const base = process.resourcesPath
    ? path.join(process.resourcesPath, 'llama')
    : path.join(__dirname, 'resources', 'llama');
  const names = process.platform === 'win32'
    ? ['llama-server.exe', 'server.exe']
    : ['llama-server', 'server'];
  for (const name of names) {
    const full = path.join(base, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function llamaServerCommand() {
  return bundledLlamaServerPath() || process.env.LLAMACPP_BIN || 'llama-server';
}

function defaultModelPath() {
  const userDir = (() => {
    try {
      const { app } = require('electron');
      if (app?.getPath) return path.join(app.getPath('userData'), 'llama-models');
    } catch (_) {}
    return null;
  })();
  const dirs = [
    userDir,
    process.env.LLAMACPP_MODEL_DIR,
    process.resourcesPath
      ? path.join(process.resourcesPath, 'llama', 'models')
      : path.join(__dirname, 'resources', 'llama', 'models'),
  ].filter(Boolean);
  const envModel = process.env.LLAMACPP_MODEL;
  if (envModel && fs.existsSync(envModel)) return envModel;
  for (const base of dirs) {
    if (!fs.existsSync(base)) continue;
    const ggufs = fs.readdirSync(base).filter((f) => /\.gguf$/i.test(f));
    if (ggufs.length) return path.join(base, ggufs[0]);
  }
  return null;
}

async function probeLlamaPort(url = DEFAULT_URL) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function ensureLlamaServerRunning(opts = {}) {
  const port = Number(opts.port || process.env.LLAMACPP_PORT || DEFAULT_PORT);
  const url = opts.url || process.env.LLAMACPP_URL || `http://127.0.0.1:${port}`;
  if (await probeLlamaPort(url)) {
    return { ok: true, alreadyRunning: true, url };
  }

  if (opts.allowSpawn === false) {
    return { ok: false, error: 'llama-server not reachable' };
  }

  const model = opts.model || defaultModelPath();
  if (!model) {
    return { ok: false, error: 'No GGUF model — set LLAMACPP_MODEL or place .gguf in resources/llama/models' };
  }

  if (llamaChild && !llamaChild.killed) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await probeLlamaPort(url)) return { ok: true, spawned: true, url };
  }

  const cmd = llamaServerCommand();
  const args = ['-m', model, '--port', String(port), '--host', '127.0.0.1', '-c', '4096'];
  const useShell = !path.isAbsolute(cmd) && cmd === 'llama-server';
  try {
    llamaChild = spawn(cmd, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      shell: useShell,
    });
    llamaChild.on('error', () => {});
    llamaChild.unref?.();
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probeLlamaPort(url)) {
      return { ok: true, spawned: true, url, model, bundled: cmd !== 'llama-server' };
    }
  }
  return { ok: false, error: 'llama-server failed to start within timeout' };
}

function stopLlamaServer() {
  if (llamaChild && !llamaChild.killed) {
    try { llamaChild.kill(); } catch (_) {}
  }
  llamaChild = null;
}

module.exports = {
  DEFAULT_URL,
  bundledLlamaServerPath,
  llamaServerCommand,
  probeLlamaPort,
  ensureLlamaServerRunning,
  stopLlamaServer,
};
