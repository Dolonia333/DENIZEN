'use strict';

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792').replace(/\/$/, '');

let _starting = false;

export async function ensureBrowserclawRunning() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return { ok: true, url: BASE, started: false };
  } catch (_) {}

  if (_starting) return { ok: false, url: BASE, started: false, note: 'already starting' };
  _starting = true;

  const serverPath = path.join(__dirname, 'server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BROWSERCLAW_PORT: String(new URL(BASE).port || 18792) },
  });
  child.unref();

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        _starting = false;
        return { ok: true, url: BASE, started: true };
      }
    } catch (_) {}
  }

  _starting = false;
  return { ok: false, url: BASE, started: true, note: 'health check failed after spawn' };
}
