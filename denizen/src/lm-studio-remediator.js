'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

function lmBaseUrl() {
  const raw = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
  return String(raw).replace(/\/v1\/?$/, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probe(probeFn) {
  if (typeof probeFn === 'function') return probeFn(lmBaseUrl());
  const http = require('node:http');
  const url = `${lmBaseUrl()}/v1/models`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ reachable: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'timeout' }); });
  });
}

function defaultLmStudioPaths() {
  const paths = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    paths.push(
      path.join(local, 'Programs', 'LM Studio', 'LM Studio.exe'),
      path.join(local, 'LM Studio', 'LM Studio.exe'),
    );
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    paths.push(path.join(progFiles, 'LM Studio', 'LM Studio.exe'));
  } else if (process.platform === 'darwin') {
    paths.push('/Applications/LM Studio.app/Contents/MacOS/LM Studio');
  } else {
    paths.push('/usr/bin/lmstudio', '/usr/local/bin/lmstudio');
  }
  return paths.filter((p) => p && fs.existsSync(p));
}

async function restartLmStudio() {
  const custom = process.env.LM_STUDIO_RESTART_CMD;
  if (custom) {
    await execAsync(custom, { windowsHide: true, shell: true, timeout: 120000 });
    return { method: 'custom_cmd', ok: true };
  }

  const paths = defaultLmStudioPaths();
  if (paths.length) {
    const bin = paths[0];
    spawn(bin, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { method: 'spawn', path: bin, ok: true };
  }

  if (process.platform === 'win32') {
    try {
      await execAsync('start "" "lmstudio://"', { shell: true, windowsHide: true, timeout: 15000 });
      return { method: 'lmstudio_uri', ok: true };
    } catch (_) {}
  }

  return {
    ok: false,
    error: 'Set LM_STUDIO_RESTART_CMD or install LM Studio in the default path',
  };
}

async function pollUntilHealthy({
  probeFn,
  maxAttempts = 12,
  intervalMs = 5000,
} = {}) {
  const attempts = [];
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await probe(probeFn);
    attempts.push({ attempt: i + 1, ...status });
    if (status.reachable) {
      return { ok: true, attempts, waited_ms: i * intervalMs };
    }
    if (i < maxAttempts - 1) await sleep(intervalMs);
  }
  const last = attempts[attempts.length - 1] || {};
  return { ok: false, attempts, error: last.error || 'LM Studio did not become reachable' };
}

async function restartAndVerify(opts = {}) {
  const restart = await restartLmStudio();
  if (!restart.ok) return { ok: false, restart, verify: null };

  await sleep(Number(opts.warmupMs) || 8000);
  const verify = await pollUntilHealthy({
    probeFn: opts.probeFn,
    maxAttempts: opts.maxAttempts || 12,
    intervalMs: opts.intervalMs || 5000,
  });

  return {
    ok: verify.ok,
    restart,
    verify,
    summary: verify.ok
      ? `LM Studio restarted via ${restart.method} and passed health poll`
      : `LM Studio restart attempted (${restart.method}) but health poll failed`,
  };
}

module.exports = {
  restartLmStudio,
  pollUntilHealthy,
  restartAndVerify,
  probe,
  lmBaseUrl,
};
