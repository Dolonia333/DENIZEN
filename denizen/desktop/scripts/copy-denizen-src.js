'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = path.join(ROOT, '..', 'src');
const DESKTOP_SRC = path.join(ROOT, 'src');

const MODULES = [
  'denizen-hardware-monitor.js',
  'denizen-node-client.js',
  'denizen-mesh-job-runner.js',
  'denizen-inference-runtime.js',
  'denizen-embedding-worker.js',
  'denizen-sim-tick.js',
  'lm-studio-probe.js',
  'lm-studio-advertise.js',
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
