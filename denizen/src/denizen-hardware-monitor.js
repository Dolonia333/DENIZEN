'use strict';

const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { enrichLmStudioBlock } = require('./lm-studio-advertise');
const inferenceRuntime = require('./denizen-inference-runtime');

const execFileAsync = promisify(execFile);

let lastCpuSample = null;
let latestSnapshot = null;
let samplerTimer = null;
let samplerRunning = false;

function readCpuTotals() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    idle += Number(times.idle) || 0;
    total += (Number(times.user) || 0)
      + (Number(times.nice) || 0)
      + (Number(times.sys) || 0)
      + (Number(times.idle) || 0)
      + (Number(times.irq) || 0);
  }
  return { idle, total };
}

function sampleCpuPercent() {
  const sample = { ...readCpuTotals(), at: Date.now() };
  if (!lastCpuSample) {
    lastCpuSample = sample;
    return null;
  }
  const idleDiff = sample.idle - lastCpuSample.idle;
  const totalDiff = sample.total - lastCpuSample.total;
  lastCpuSample = sample;
  if (totalDiff <= 0) return null;
  const pct = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
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

function parseNvidiaSmiLine(line) {
  const parts = String(line || '').split(',').map((s) => s.trim());
  if (parts.length < 4) return null;
  const [model, util, memUsed, memTotal, temp] = parts;
  const vramTotal = Number(memTotal) || 0;
  const vramUsed = Number(memUsed) || 0;
  return {
    model: model || null,
    utilization_percent: Number(util) || 0,
    vram_used_mb: Math.round(vramUsed),
    vram_total_mb: Math.round(vramTotal),
    vram_used_percent: vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 1000) / 10 : null,
    temperature_c: temp != null && temp !== '' ? Number(temp) : null,
    source: 'nvidia-smi',
  };
}

async function sampleGpuNvidiaSmi() {
  const { stdout } = await execFileAsync('nvidia-smi', [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
    '--format=csv,noheader,nounits',
  ], { timeout: 6000, windowsHide: true, maxBuffer: 256 * 1024 });
  const line = String(stdout || '').trim().split('\n').find(Boolean);
  return parseNvidiaSmiLine(line);
}

async function sampleGpuWmic() {
  if (process.platform !== 'win32') return null;
  const { stdout } = await execFileAsync('wmic', [
    'path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv',
  ], { timeout: 8000, windowsHide: true, maxBuffer: 512 * 1024 });
  const lines = String(stdout || '').trim().split('\n').filter((l) => l && !/^Node,/i.test(l));
  for (const line of lines) {
    const cols = line.split(',');
    const name = cols[2]?.trim();
    if (!name || /microsoft basic|remote desktop/i.test(name)) continue;
    const ramBytes = Number(cols[1]) || 0;
    return {
      model: name,
      utilization_percent: null,
      vram_total_mb: ramBytes > 0 ? Math.round(ramBytes / (1024 * 1024)) : null,
      vram_used_mb: null,
      vram_used_percent: null,
      temperature_c: null,
      source: 'wmic',
    };
  }
  return null;
}

async function sampleGpu() {
  try {
    return await sampleGpuNvidiaSmi();
  } catch (_) {}
  try {
    return await sampleGpuWmic();
  } catch (_) {}
  return null;
}

function sampleProcess() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    memory_mb: Math.round((mem.rss || 0) / (1024 * 1024)),
    heap_mb: Math.round((mem.heapUsed || 0) / (1024 * 1024)),
  };
}

async function collectLiveMetrics(extra = {}) {
  const cpuPercent = sampleCpuPercent();
  const ram = sampleRam();
  const gpu = await sampleGpu().catch(() => null);
  const cpus = os.cpus() || [];

  let lmStudio = extra.lm_studio || null;
  let inference = extra.inference || null;

  if (!inference && extra.probe_inference !== false) {
    try {
      const probe = await inferenceRuntime.probeInferenceRuntime({
        timeoutMs: 3500,
        backend: extra.inference_backend,
        ollamaUrl: extra.ollama_url,
        lmStudioUrl: extra.lm_studio_url,
      });
      inference = inferenceRuntime.buildInferenceBlockFromProbe(probe, extra);
      if (!lmStudio && probe.backend === 'lmstudio') {
        lmStudio = enrichLmStudioBlock(probe, extra);
      }
    } catch (_) {
      inference = null;
    }
  }

  if (!lmStudio && !inference && extra.probe_lm_studio !== false) {
    try {
      const { probeLmStudioEndpoint } = require('./lm-studio-probe');
      const base = process.env.LM_STUDIO_URL
        || process.env.LM_STUDIO_BASE_URL
        || 'http://127.0.0.1:1234';
      lmStudio = await probeLmStudioEndpoint(base, {
        apiKey: process.env.LM_STUDIO_API_KEY,
        timeoutMs: 3500,
      });
      lmStudio = enrichLmStudioBlock(lmStudio, extra);
      if (!inference && lmStudio?.reachable) {
        inference = inferenceRuntime.buildInferenceBlockFromProbe({
          ...lmStudio,
          backend: 'lmstudio',
          reachable_local: true,
          rpc_capable: true,
        }, extra);
      }
    } catch (_) {
      lmStudio = null;
    }
  }

  const out = {
    sampled_at: new Date().toISOString(),
    machine_id: extra.machine_id || `host-${os.hostname()}`,
    role: extra.role || 'host',
    label: extra.label || os.hostname(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    cpu_cores: cpus.length || null,
    cpu_percent: cpuPercent,
    ram,
    gpu,
    process: sampleProcess(),
    load_avg: os.loadavg ? os.loadavg() : null,
    contributing: extra.contributing != null ? !!extra.contributing : null,
    jobs_completed: Number(extra.jobs_completed) || 0,
  };
  if (lmStudio) out.lm_studio = lmStudio;
  if (inference) out.inference = inference;
  return out;
}

function getLatestSnapshot() {
  return latestSnapshot ? { ...latestSnapshot } : null;
}

async function refreshSnapshot(extra = {}) {
  const snap = await collectLiveMetrics(extra);
  latestSnapshot = snap;
  return snap;
}

function startHostSampler(opts = {}) {
  if (samplerRunning) return { ok: true, alreadyRunning: true };
  const intervalMs = Math.max(2000, Number(opts.intervalMs) || 5000);
  const onSample = typeof opts.onSample === 'function' ? opts.onSample : null;

  const tick = async () => {
    try {
      const snap = await refreshSnapshot(opts.extra || {});
      if (onSample) onSample(snap);
    } catch (err) {
      if (onSample) {
        onSample({
          sampled_at: new Date().toISOString(),
          error: err?.message || String(err),
          machine_id: `host-${os.hostname()}`,
          role: 'host',
          label: os.hostname(),
        });
      }
    }
  };

  samplerRunning = true;
  tick();
  samplerTimer = setInterval(tick, intervalMs);
  return { ok: true, running: true, intervalMs };
}

function stopHostSampler() {
  if (samplerTimer) {
    clearInterval(samplerTimer);
    samplerTimer = null;
  }
  samplerRunning = false;
  return { ok: true, running: false };
}

module.exports = {
  collectLiveMetrics,
  refreshSnapshot,
  getLatestSnapshot,
  startHostSampler,
  stopHostSampler,
  sampleCpuPercent,
  sampleRam,
  sampleGpu,
};
