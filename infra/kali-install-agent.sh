#!/bin/bash
# Paste this entire file on Kali: nano ~/kali-install-agent.sh then chmod +x && ./kali-install-agent.sh
set -eu
AGENT="$HOME/denizen-agent"
mkdir -p "$AGENT/src"

if [[ -z "${DENIZEN_FLEET_AGENT_TOKEN:-}" ]]; then
  echo "Export DENIZEN_FLEET_AGENT_TOKEN first (from denizen/.env on dolonia)."
  echo "Prefer: bash infra/pull-install-kali-agent.sh"
  exit 1
fi

cat > "$AGENT/.env" << EOF
DENIZEN_URL=\${DENIZEN_URL:-https://denizen.dolonia.cloud}
DENIZEN_PUBLIC_URL=\${DENIZEN_PUBLIC_URL:-https://denizen.dolonia.cloud}
DENIZEN_IDENTITY_ID=\${DENIZEN_FLEET_IDENTITY_ID:-}
DENIZEN_FLEET_AGENT_TOKEN=${DENIZEN_FLEET_AGENT_TOKEN}
DENIZEN_MACHINE_ID=\${DENIZEN_MACHINE_ID:-$(hostname -s)}
DENIZEN_MACHINE_LABEL=\${DENIZEN_MACHINE_LABEL:-Kali compute agent}
DENIZEN_REPORT_INTERVAL_MS=30000
DENIZEN_WORKER_POLL_MS=5000
# Optional — auto-register + persist to .node-credentials.json when unset:
# DENIZEN_NODE_ID=
# DENIZEN_NODE_TOKEN=
DENIZEN_AGENT_ROOT=/home/dolo/denizen-agent
EOF

sed -i "s|/home/dolo|$HOME|g" "$AGENT/.env"

cat > "$AGENT/nas-metrics-agent.js" << 'ENDOFFILE'
'use strict';
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
const agentRoot = process.env.DENIZEN_AGENT_ROOT || path.join(__dirname, '..');
loadEnvFile(path.join(agentRoot, '.env'));
const hardwareMonitor = require(
  process.env.DENIZEN_HARDWARE_MONITOR_PATH
  || path.join(agentRoot, 'src', 'denizen-hardware-monitor'),
);
const REPORT_INTERVAL_MS = Math.max(10000, Number(process.env.DENIZEN_REPORT_INTERVAL_MS) || 30000);
const SERVER_URL = String(process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || '').replace(/\/+$/, '');
const IDENTITY_ID = String(process.env.DENIZEN_IDENTITY_ID || '').trim();
const FLEET_TOKEN = String(process.env.DENIZEN_FLEET_AGENT_TOKEN || '').trim();
const MACHINE_ID = String(process.env.DENIZEN_MACHINE_ID || `nas-${os.hostname()}`).trim();
const MACHINE_LABEL = String(process.env.DENIZEN_MACHINE_LABEL || `NAS · ${os.hostname()}`).trim();
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
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
}
async function reportMetrics(liveMetrics) {
  const res = await fetch(`${SERVER_URL}/api/compute/fleet/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fleet-Agent-Token': FLEET_TOKEN },
    body: JSON.stringify({
      identity_id: IDENTITY_ID, machine_id: MACHINE_ID, role: 'node',
      label: MACHINE_LABEL, contributing: true, live_metrics: liveMetrics,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `report failed (${res.status})`);
  return data;
}
async function sampleOnce() {
  if (!lastCpuWarm) {
    hardwareMonitor.sampleCpuPercent();
    lastCpuWarm = true;
    await new Promise((r) => setTimeout(r, 1100));
  }
  return hardwareMonitor.collectLiveMetrics({
    role: 'node', machine_id: MACHINE_ID, label: MACHINE_LABEL, contributing: true,
  });
}
async function tick() {
  const live = await sampleOnce();
  const result = await reportMetrics(live);
  const cpu = live.cpu_percent != null ? `${live.cpu_percent}%` : 'n/a';
  const ram = live.ram?.used_percent != null ? `${live.ram.used_percent}%` : 'n/a';
  log(`reported ${MACHINE_ID} -> ${result.machine_id || MACHINE_ID} | CPU ${cpu} RAM ${ram}`);
}
async function main() {
  requireConfig();
  log(`starting agent for ${MACHINE_LABEL} (${MACHINE_ID})`);
  log(`server ${SERVER_URL} identity ${IDENTITY_ID}`);
  await tick();
  setInterval(() => { tick().catch((err) => log('report error:', err?.message || err)); }, REPORT_INTERVAL_MS);
}
if (require.main === module) {
  main().catch((err) => { console.error('[nas-agent] fatal:', err?.message || err); process.exit(1); });
}
ENDOFFILE

cat > "$AGENT/src/denizen-hardware-monitor.js" << 'ENDOFFILE'
'use strict';
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
let lastCpuSample = null;
function readCpuTotals() {
  const cpus = os.cpus() || [];
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    idle += Number(times.idle) || 0;
    total += (Number(times.user) || 0) + (Number(times.nice) || 0) + (Number(times.sys) || 0)
      + (Number(times.idle) || 0) + (Number(times.irq) || 0);
  }
  return { idle, total };
}
function sampleCpuPercent() {
  const sample = { ...readCpuTotals(), at: Date.now() };
  if (!lastCpuSample) { lastCpuSample = sample; return null; }
  const idleDiff = sample.idle - lastCpuSample.idle;
  const totalDiff = sample.total - lastCpuSample.total;
  lastCpuSample = sample;
  if (totalDiff <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 1000) / 10));
}
function sampleRam() {
  const total = os.totalmem() || 0;
  const free = os.freemem() || 0;
  const used = Math.max(0, total - free);
  return {
    total_mb: Math.round(total / (1024 * 1024)),
    used_mb: Math.round(used / (1024 * 1024)),
    free_mb: Math.round(free / (1024 * 1024)),
    used_percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}
async function sampleGpu() {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 6000, maxBuffer: 256 * 1024 });
    const line = String(stdout || '').trim().split('\n').find(Boolean);
    if (!line) return null;
    const [model, util, memUsed, memTotal, temp] = line.split(',').map((s) => s.trim());
    const vramTotal = Number(memTotal) || 0;
    const vramUsed = Number(memUsed) || 0;
    return {
      model: model || null, utilization_percent: Number(util) || 0,
      vram_used_mb: Math.round(vramUsed), vram_total_mb: Math.round(vramTotal),
      vram_used_percent: vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 1000) / 10 : null,
      temperature_c: temp != null && temp !== '' ? Number(temp) : null, source: 'nvidia-smi',
    };
  } catch (_) { return null; }
}
async function collectLiveMetrics(extra = {}) {
  const cpus = os.cpus() || [];
  return {
    sampled_at: new Date().toISOString(),
    machine_id: extra.machine_id || `host-${os.hostname()}`,
    role: extra.role || 'host', label: extra.label || os.hostname(),
    hostname: os.hostname(), platform: process.platform, arch: os.arch(),
    cpu_cores: cpus.length || null, cpu_percent: sampleCpuPercent(),
    ram: sampleRam(), gpu: await sampleGpu().catch(() => null),
    load_avg: os.loadavg ? os.loadavg() : null,
    contributing: extra.contributing != null ? !!extra.contributing : null,
    jobs_completed: Number(extra.jobs_completed) || 0,
  };
}
module.exports = { collectLiveMetrics, sampleCpuPercent, sampleRam, sampleGpu };
ENDOFFILE

# Optional: copy compute worker from denizen checkout or infra/kali-agent-bundle
for REPO in "$HOME/Denizen/infra/kali-agent-bundle" "$HOME/Denizen/denizen" "$(dirname "$0")/.." .; do
  COMPUTE=""
  NODE_CLIENT=""
  MESH_RUNNER=""
  if [ -f "$REPO/scripts/nas-compute-agent.js" ]; then
    COMPUTE="$REPO/scripts/nas-compute-agent.js"
    NODE_CLIENT="$REPO/src/denizen-node-client.js"
    MESH_RUNNER="$REPO/src/denizen-mesh-job-runner.js"
  elif [ -f "$REPO/nas-compute-agent.js" ]; then
    COMPUTE="$REPO/nas-compute-agent.js"
    NODE_CLIENT="$REPO/src/denizen-node-client.js"
    MESH_RUNNER="$REPO/src/denizen-mesh-job-runner.js"
  fi
  if [ -n "$COMPUTE" ] && [ -f "$NODE_CLIENT" ] && [ -f "$MESH_RUNNER" ]; then
    cp "$COMPUTE" "$AGENT/nas-compute-agent.js"
    cp "$NODE_CLIENT" "$AGENT/src/denizen-node-client.js"
    cp "$MESH_RUNNER" "$AGENT/src/denizen-mesh-job-runner.js"
    echo "Installed compute worker from $REPO"
    break
  fi
done


echo "Files installed in $AGENT"
ls -la "$AGENT" "$AGENT/src"
echo ""
echo "Testing cloud reachability..."
curl -fsS --max-time 10 https://denizen.dolonia.cloud/api/health | head -c 200 || echo "WARN: cannot reach denizen.dolonia.cloud"
echo ""
AGENT_SCRIPT="nas-metrics-agent.js"
if [ -f "$AGENT/nas-compute-agent.js" ] && [ -f "$AGENT/src/denizen-node-client.js" ] && [ -f "$AGENT/src/denizen-mesh-job-runner.js" ]; then
  AGENT_SCRIPT="nas-compute-agent.js"
  echo "Compute worker enabled ($AGENT_SCRIPT)"
else
  echo "Metrics-only mode ($AGENT_SCRIPT) — copy nas-compute-agent.js + src/denizen-node-client.js for job claiming"
fi
echo "Starting agent (Ctrl+C to stop)..."
export DENIZEN_AGENT_ROOT="$AGENT"
export DENIZEN_HARDWARE_MONITOR_PATH="$AGENT/src/denizen-hardware-monitor.js"
cd "$AGENT"
node "$AGENT_SCRIPT"
