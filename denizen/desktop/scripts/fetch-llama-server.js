#!/usr/bin/env node
'use strict';

/**
 * Download llama-server from ggml-org/llama.cpp releases into resources/llama/.
 * Runs on prebuild:win (and when LLAMACPP_FETCH=1).
 *
 * Env:
 *   LLAMACPP_VERSION=b7525     (default pinned build)
 *   LLAMACPP_VARIANT=cpu       cpu | vulkan | cuda12 | cuda13
 *   LLAMACPP_FETCH=0           skip download
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'llama');
const VERSION = String(process.env.LLAMACPP_VERSION || 'b7525').trim();
const VARIANT = String(process.env.LLAMACPP_VARIANT || 'cpu').trim().toLowerCase();
const REPO = 'ggml-org/llama.cpp';

function log(msg) {
  console.log(`[fetch-llama-server] ${msg}`);
}

function outBinaryName() {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

function resolveAssetName() {
  const v = VERSION;
  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    if (VARIANT === 'vulkan') return `llama-${v}-bin-win-vulkan-x64.zip`;
    if (VARIANT === 'cuda12') return `llama-${v}-bin-win-cuda-12.4-x64.zip`;
    if (VARIANT === 'cuda13') return `llama-${v}-bin-win-cuda-13.1-x64.zip`;
    return `llama-${v}-bin-win-cpu-${arch}.zip`;
  }
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return `llama-${v}-bin-macos-${arch}.zip`;
  }
  return `llama-${v}-bin-ubuntu-x64.zip`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'DenizenDesktop/1.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', reject);
  });
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    return;
  }
  try {
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
  } catch (_) {
    execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
  }
}

function findBinary(root, name) {
  if (!fs.existsSync(root)) return null;
  const direct = path.join(root, name);
  if (fs.existsSync(direct)) return direct;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = findBinary(path.join(root, entry.name), name);
    if (nested) return nested;
  }
  return null;
}

async function main() {
  const outBin = path.join(OUT_DIR, outBinaryName());
  if (fs.existsSync(outBin)) {
    log(`already staged: ${outBin}`);
    return;
  }
  if (/^(0|false|no)$/i.test(String(process.env.LLAMACPP_FETCH || ''))) {
    log('skip (LLAMACPP_FETCH=0)');
    return;
  }

  const asset = resolveAssetName();
  const url = `https://github.com/${REPO}/releases/download/${VERSION}/${asset}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-llama-'));
  const zipPath = path.join(tmpRoot, asset);

  log(`downloading ${asset} (${process.platform}/${process.arch}, ${VARIANT})`);
  try {
    await download(url, zipPath);
    const extractDir = path.join(tmpRoot, 'extract');
    extractZip(zipPath, extractDir);
    const found = findBinary(extractDir, outBinaryName());
    if (!found) {
      throw new Error(`llama-server binary not found inside ${asset}`);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(path.join(OUT_DIR, 'models'), { recursive: true });
    fs.copyFileSync(found, outBin);
    if (process.platform !== 'win32') {
      fs.chmodSync(outBin, 0o755);
    }
  // Copy sibling DLLs on Windows (CUDA/Vulkan builds)
    const binDir = path.dirname(found);
    for (const f of fs.readdirSync(binDir)) {
      if (/\.(dll|so|dylib)$/i.test(f)) {
        fs.copyFileSync(path.join(binDir, f), path.join(OUT_DIR, f));
      }
    }
    log(`staged ${outBin}`);
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(`[fetch-llama-server] FAIL: ${err?.message || err}`);
  process.exit(1);
});
