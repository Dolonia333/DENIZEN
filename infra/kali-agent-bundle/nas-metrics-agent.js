'use strict';

/**
 * Headless Denizen fleet agent for Synology NAS / Linux hosts.
 * Samples local CPU/RAM/GPU and reports to the Denizen server.
 *
 * Env:
 *   DENIZEN_URL              — e.g. https://denizen.dolonia.cloud or http://192.168.1.x:8081
 *   DENIZEN_IDENTITY_ID      — platform identity to attach metrics to (CEO fleet)
 *   DENIZEN_FLEET_AGENT_TOKEN — shared secret (must match server .env)
 *   DENIZEN_MACHINE_ID       — optional stable machine id (default nas-<hostname>)
 *   DENIZEN_REPORT_INTERVAL_MS — default 30000
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function expandHome(dir) {
  if (!dir) return dir;
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return dir;
}

function detectAgentRoot() {
  const bundledSrc = path.join(__dirname, 'src', 'denizen-hardware-monitor.js');
  if (fs.existsSync(bundledSrc)) return __dirname;
  return path.join(__dirname, '..');
}

const preliminaryRoot = detectAgentRoot();
loadEnvFile(path.join(preliminaryRoot, '.env'));
const agentRoot = expandHome(process.env.DENIZEN_AGENT_ROOT) || preliminaryRoot;

const hardwareMonitor = require(
  process.env.DENIZEN_HARDWARE_MONITOR_PATH
  || path.join(agentRoot, 'src', 'denizen-hardware-monitor'),
);

const REPORT_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.DENIZEN_REPORT_INTERVAL_MS) || 30000,
);
const SERVER_URL = String(process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || '').replace(/\/+$/, '');
const IDENTITY_ID = String(process.env.DENIZEN_IDENTITY_ID || '').trim();
const FLEET_TOKEN = String(process.env.DENIZEN_FLEET_AGENT_TOKEN || '').trim();
const MACHINE_ID = String(
  process.env.DENIZEN_MACHINE_ID || `nas-${os.hostname()}`,
).trim();
const MACHINE_LABEL = String(
  process.env.DENIZEN_MACHINE_LABEL || `NAS · ${os.hostname()}`,
).trim();

let lastCpuWarm = false;

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [nas-agent]`, ...args);
}

function requireConfig() {
  const missing = [];
  if (!SERVER_URL) missing.push('DENIZEN_URL');
  if (!IDENTITY_ID) missing.push('DENIZEN_IDENTITY_ID');
  if (!FLEET_TOKEN) missing.push('DENIZEN_FLEET_AGENT_TOKEN');
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

async function reportMetrics(liveMetrics) {
  const res = await fetch(`${SERVER_URL}/api/compute/fleet/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fleet-Agent-Token': FLEET_TOKEN,
    },
    body: JSON.stringify({
      identity_id: IDENTITY_ID,
      machine_id: MACHINE_ID,
      role: 'nas',
      label: MACHINE_LABEL,
      contributing: true,
      live_metrics: liveMetrics,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `report failed (${res.status})`);
  }
  return data;
}

async function sampleOnce() {
  if (!lastCpuWarm) {
    hardwareMonitor.sampleCpuPercent();
    lastCpuWarm = true;
    await new Promise((r) => setTimeout(r, 1100));
  }
  return hardwareMonitor.collectLiveMetrics({
    role: 'nas',
    machine_id: MACHINE_ID,
    label: MACHINE_LABEL,
    contributing: true,
  });
}

async function tick() {
  const live = await sampleOnce();
  const result = await reportMetrics(live);
  const cpu = live.cpu_percent != null ? `${live.cpu_percent}%` : 'n/a';
  const ram = live.ram?.used_percent != null ? `${live.ram.used_percent}%` : 'n/a';
  const gpu = live.gpu?.utilization_percent != null ? `${live.gpu.utilization_percent}%` : 'n/a';
  log(`reported ${MACHINE_ID} -> ${result.machine_id || MACHINE_ID} | CPU ${cpu} RAM ${ram} GPU ${gpu}`);
}

async function main() {
  requireConfig();
  log(`starting agent for ${MACHINE_LABEL} (${MACHINE_ID})`);
  log(`server ${SERVER_URL} identity ${IDENTITY_ID}`);
  await tick();
  setInterval(() => {
    tick().catch((err) => {
      log('report error:', err?.message || err);
    });
  }, REPORT_INTERVAL_MS);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[nas-agent] fatal:', err?.message || err);
    process.exit(1);
  });
}

module.exports = { sampleOnce, reportMetrics, main };
