'use strict';

/**
 * Stage Ollama binary into resources/ollama for electron-builder extraResources.
 * Skips unless OLLAMA_FETCH=1 or binary already present.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'ollama');
const OUT_BIN = process.platform === 'win32'
  ? path.join(OUT_DIR, 'ollama.exe')
  : path.join(OUT_DIR, 'ollama');

function log(msg) {
  console.log(`[fetch-ollama] ${msg}`);
}

function findSystemOllama() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
    );
    try {
      const where = execFileSync('where', ['ollama'], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim().split('\n')[0];
      if (where) candidates.unshift(where.trim());
    } catch (_) {}
  } else if (process.platform === 'darwin') {
    candidates.push('/usr/local/bin/ollama', '/opt/homebrew/bin/ollama');
  } else {
    candidates.push('/usr/bin/ollama', '/usr/local/bin/ollama');
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function main() {
  if (fs.existsSync(OUT_BIN)) {
    log(`already staged: ${OUT_BIN}`);
    return;
  }
  if (!/^(1|true|yes)$/i.test(String(process.env.OLLAMA_FETCH || ''))) {
    log('skip (set OLLAMA_FETCH=1 to bundle Ollama from this machine)');
    return;
  }

  const src = process.env.OLLAMA_LOCAL_PATH || findSystemOllama();
  if (!src) {
    log('no Ollama binary found — install Ollama or set OLLAMA_LOCAL_PATH');
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(src, OUT_BIN);
  if (process.platform !== 'win32') {
    fs.chmodSync(OUT_BIN, 0o755);
  }
  log(`staged ${src} → ${OUT_BIN}`);
}

main();
