'use strict';

/**
 * Headless Denizen fleet + compute agent for Synology NAS / Linux hosts.
 * Reports metrics and claims/completes compute jobs.
 *
 * Env:
 *   DENIZEN_URL, DENIZEN_IDENTITY_ID, DENIZEN_FLEET_AGENT_TOKEN — required (fleet metrics)
 *   DENIZEN_MACHINE_ID, DENIZEN_MACHINE_LABEL, DENIZEN_REPORT_INTERVAL_MS — optional
 *   DENIZEN_NODE_ID, DENIZEN_NODE_TOKEN — optional; auto-register + persist if unset
 *   DENIZEN_WORKER_POLL_MS — claim poll interval (default 5000)
 *   DENIZEN_AGENT_ROOT — install root (default: script dir if src/ present, else parent)
 *   DENIZEN_NODE_CLIENT_PATH — override path to denizen-node-client.js
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
const nodeClient = require(
  process.env.DENIZEN_NODE_CLIENT_PATH
  || path.join(agentRoot, 'src', 'denizen-node-client.js'),
);
const { processMeshJob } = require(
  process.env.DENIZEN_MESH_JOB_RUNNER_PATH
  || path.join(agentRoot, 'src', 'denizen-mesh-job-runner.js'),
);

const REPORT_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.DENIZEN_REPORT_INTERVAL_MS) || 30000,
);
const WORKER_POLL_MS = Math.max(
  500,
  Number(process.env.DENIZEN_WORKER_POLL_MS) || 5000,
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
const CREDENTIALS_PATH = path.join(agentRoot, '.node-credentials.json');

let lastCpuWarm = false;
let nodeId = String(process.env.DENIZEN_NODE_ID || '').trim();
let nodeToken = String(process.env.DENIZEN_NODE_TOKEN || '').trim();

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [nas-compute]`, ...args);
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

function loadPersistedCredentials() {
  if (nodeId && nodeToken) return;
  if (!fs.existsSync(CREDENTIALS_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    if (!nodeId && data.nodeId) nodeId = String(data.nodeId).trim();
    if (!nodeToken && data.nodeToken) nodeToken = String(data.nodeToken).trim();
  } catch (_) {}
}

function saveCredentials(credentials) {
  const payload = {
    nodeId: credentials.nodeId,
    nodeToken: credentials.nodeToken,
    identityId: IDENTITY_ID,
    registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  nodeId = payload.nodeId;
  nodeToken = payload.nodeToken;
}

async function registerNode() {
  const res = await fetch(`${SERVER_URL}/api/compute/node/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityId: IDENTITY_ID }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.node?.id || !data.node?.endpoint_token) {
    throw new Error(data.error || `register failed (${res.status})`);
  }
  const credentials = {
    nodeId: data.node.id,
    nodeToken: data.node.endpoint_token,
  };
  saveCredentials(credentials);
  log(`registered compute node ${credentials.nodeId}`);
  return credentials;
}

async function ensureNodeCredentials() {
  loadPersistedCredentials();
  if (nodeToken) return { nodeId, nodeToken };
  return registerNode();
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

async function metricsTick() {
  const live = await sampleOnce();
  const result = await reportMetrics(live);
  const cpu = live.cpu_percent != null ? `${live.cpu_percent}%` : 'n/a';
  const ram = live.ram?.used_percent != null ? `${live.ram.used_percent}%` : 'n/a';
  const gpu = live.gpu?.utilization_percent != null ? `${live.gpu.utilization_percent}%` : 'n/a';
  log(`reported ${MACHINE_ID} -> ${result.machine_id || MACHINE_ID} | CPU ${cpu} RAM ${ram} GPU ${gpu}`);
}

async function processJobLocally(job, _ctx = {}) {
  const jobType = String(job?.job_type || job?.jobType || '').trim();
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  return processMeshJob(jobType, payload);
}

async function startComputeWorker() {
  const credentials = await ensureNodeCredentials();
  if (!credentials.nodeToken) {
    throw new Error('compute node token unavailable after register');
  }

  const worker = nodeClient.startWorkerLoop({
    identityId: IDENTITY_ID,
    nodeToken: credentials.nodeToken,
    baseUrl: SERVER_URL,
    pollIntervalMs: WORKER_POLL_MS,
    processJobLocally,
  });

  log(`worker loop started (poll ${WORKER_POLL_MS}ms, node ${credentials.nodeId || 'by-identity'})`);
  return worker;
}

async function main() {
  requireConfig();
  log(`starting agent for ${MACHINE_LABEL} (${MACHINE_ID})`);
  log(`server ${SERVER_URL} identity ${IDENTITY_ID}`);

  await metricsTick();
  setInterval(() => {
    metricsTick().catch((err) => {
      log('report error:', err?.message || err);
    });
  }, REPORT_INTERVAL_MS);

  await startComputeWorker();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[nas-compute] fatal:', err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  sampleOnce,
  reportMetrics,
  processJobLocally,
  ensureNodeCredentials,
  startComputeWorker,
  main,
};
