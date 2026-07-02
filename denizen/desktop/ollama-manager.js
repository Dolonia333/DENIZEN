'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let ollamaChild = null;

function bundledOllamaPath() {
  const base = process.resourcesPath
    ? path.join(process.resourcesPath, 'ollama')
    : path.join(__dirname, 'resources', 'ollama');
  const names = process.platform === 'win32'
    ? ['ollama.exe', 'Ollama.exe']
    : ['ollama'];
  for (const name of names) {
    const full = path.join(base, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function ollamaCommand() {
  return bundledOllamaPath() || 'ollama';
}

async function probeOllamaPort(url = 'http://127.0.0.1:11434') {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function ensureOllamaRunning(opts = {}) {
  const url = opts.url || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  if (await probeOllamaPort(url)) {
    return { ok: true, alreadyRunning: true, url };
  }

  if (opts.allowSpawn === false) {
    return { ok: false, error: 'Ollama not reachable' };
  }

  if (ollamaChild && !ollamaChild.killed) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await probeOllamaPort(url)) return { ok: true, spawned: true, url };
  }

  const cmd = ollamaCommand();
  const args = ['serve'];
  try {
    ollamaChild = spawn(cmd, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      shell: cmd === 'ollama',
      env: {
        ...process.env,
        OLLAMA_HOST: url.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '127.0.0.1:11434',
      },
    });
    ollamaChild.on('error', () => {});
    ollamaChild.unref?.();
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probeOllamaPort(url)) {
      return { ok: true, spawned: true, url, bundled: cmd !== 'ollama' };
    }
  }
  return { ok: false, error: 'Ollama failed to start within timeout' };
}

function stopOllama() {
  if (ollamaChild && !ollamaChild.killed) {
    try { ollamaChild.kill(); } catch (_) {}
  }
  ollamaChild = null;
}

module.exports = {
  ensureOllamaRunning,
  stopOllama,
  probeOllamaPort,
  bundledOllamaPath,
  ollamaCommand,
};
