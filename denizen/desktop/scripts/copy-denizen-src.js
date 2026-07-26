'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = path.join(ROOT, '..', 'src');
const DESKTOP_SRC = path.join(ROOT, 'src');

// Every module below is copied into desktop/src so the packaged asar can
// resolve it — denizen/src is OUTSIDE the electron-builder files root and is
// never packaged. If a module here gains a new top-level require('./x'), x
// MUST be added to this list or the packaged app dies during main-process
// module eval with no log (see the Jun-30..Jul-24 packaging regression).
const MODULES = [
  'denizen-hardware-monitor.js',
  'denizen-node-client.js',
  'denizen-mesh-job-runner.js',
  'denizen-inference-runtime.js',
  'denizen-embedding-worker.js',
  'denizen-sim-tick.js',
  'lm-studio-probe.js',
  'lm-studio-advertise.js',
  // hard top-level requires added after 2026-07-02 — their absence broke packaging
  'inference-usage-tracker.js',
  'denizen-bouncer-mesh-patrol.js',
  // soft (lazy/guarded) requires — included so packaged features don't silently degrade
  'inference-sampling.js',
  'lm-studio-router.js',
  'lm-studio-model-manager.js',
];

fs.mkdirSync(DESKTOP_SRC, { recursive: true });

for (const name of MODULES) {
  const from = path.join(SERVER_SRC, name);
  const to = path.join(DESKTOP_SRC, name);
  if (!fs.existsSync(from)) {
    console.error(`[copy-denizen-src] missing ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-denizen-src] ${name}`);
}
