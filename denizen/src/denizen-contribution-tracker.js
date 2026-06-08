'use strict';

const computeCredits = require('./denizen-compute-credits.js');

const activeJobs = new Map();
const samplesByKey = new Map();
const dailyByIdentity = new Map();
const fleetBonusAwarded = new Set();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function sampleKey(identityId, machineId) {
  return `${String(identityId)}::${String(machineId || 'default')}`;
}

function getDailyState(identityId) {
  const id = String(identityId || '').trim();
  if (!id) return null;
  const date = todayKey();
  let row = dailyByIdentity.get(id);
  if (!row || row.date !== date) {
    row = {
      date,
      totals: {
        job: 0,
        uptime: 0,
        host_stipend: 0,
        fleet_bonus: 0,
        total: 0,
      },
    };
    dailyByIdentity.set(id, row);
  }
  return row;
}

function recordDailyGrant(identityId, category, amount) {
  const state = getDailyState(identityId);
  if (!state || amount <= 0) return state;
  state.totals[category] = (state.totals[category] || 0) + amount;
  state.totals.total = (state.totals.total || 0) + amount;
  return state;
}

function grantWithCap(identityId, category, requested) {
  const state = getDailyState(identityId);
  const cap = computeCredits.applyDailyCap({
    identityId,
    category,
    requested: Math.max(0, Math.trunc(requested)),
    dailyState: state,
  });
  if (cap.granted > 0) recordDailyGrant(identityId, category, cap.granted);
  return cap;
}

function startJob({
  jobId,
  nodeId,
  identityId,
  jobType,
  hardwareScore = 0,
  contributionLevel = 'standard',
  liveMetrics = null,
} = {}) {
  if (!jobId || !nodeId) return null;
  const entry = {
    job_id: String(jobId),
    node_id: String(nodeId),
    identity_id: identityId ? String(identityId) : null,
    job_type: String(jobType || ''),
    hardware_score: Number(hardwareScore) || 0,
    contribution_level: String(contributionLevel || 'standard'),
    started_at: Date.now(),
    start_metrics: liveMetrics && typeof liveMetrics === 'object' ? { ...liveMetrics } : null,
    util_samples: [],
  };
  activeJobs.set(entry.job_id, entry);
  return entry;
}

function touchJob(jobId, liveMetrics = null) {
  const job = activeJobs.get(String(jobId));
  if (!job) return null;
  if (liveMetrics && typeof liveMetrics === 'object') {
    job.util_samples.push({
      at: Date.now(),
      cpu_percent: liveMetrics.cpu_percent ?? null,
      gpu_utilization_percent: liveMetrics.gpu?.utilization_percent ?? null,
    });
  }
  return job;
}

function finishJob(jobId, liveMetrics = null) {
  const job = activeJobs.get(String(jobId));
  if (!job) return null;
  touchJob(jobId, liveMetrics);
  activeJobs.delete(String(jobId));
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - (job.started_at || endedAt));
  let cpuSum = 0;
  let cpuCount = 0;
  let gpuSum = 0;
  let gpuCount = 0;
  for (const sample of job.util_samples) {
    if (Number.isFinite(Number(sample.cpu_percent))) {
      cpuSum += Number(sample.cpu_percent);
      cpuCount += 1;
    }
    if (Number.isFinite(Number(sample.gpu_utilization_percent))) {
      gpuSum += Number(sample.gpu_utilization_percent);
      gpuCount += 1;
    }
  }
  const startCpu = job.start_metrics?.cpu_percent;
  const startGpu = job.start_metrics?.gpu?.utilization_percent;
  if (Number.isFinite(Number(startCpu))) {
    cpuSum += Number(startCpu);
    cpuCount += 1;
  }
  if (Number.isFinite(Number(startGpu))) {
    gpuSum += Number(startGpu);
    gpuCount += 1;
  }
  const endCpu = liveMetrics?.cpu_percent;
  const endGpu = liveMetrics?.gpu?.utilization_percent;
  if (Number.isFinite(Number(endCpu))) {
    cpuSum += Number(endCpu);
    cpuCount += 1;
  }
  if (Number.isFinite(Number(endGpu))) {
    gpuSum += Number(endGpu);
    gpuCount += 1;
  }
  return {
    ...job,
    duration_ms: durationMs,
    cpu_percent_avg: cpuCount ? cpuSum / cpuCount : null,
    gpu_util_avg: gpuCount ? gpuSum / gpuCount : null,
    completed_at: new Date(endedAt).toISOString(),
  };
}

function recordSample({
  identityId,
  machineId,
  hardwareScore = 0,
  contributionLevel = 'standard',
  contributing = false,
  lmStudioActive = false,
  liveMetrics = null,
  role = null,
} = {}) {
  if (!identityId) return null;
  const key = sampleKey(identityId, machineId || liveMetrics?.machine_id);
  const now = Date.now();
  const cpu = liveMetrics?.cpu_percent ?? null;
  const gpu = liveMetrics?.gpu?.utilization_percent ?? null;
  let row = samplesByKey.get(key);
  if (!row) {
    row = {
      identity_id: String(identityId),
      machine_id: String(machineId || liveMetrics?.machine_id || 'default'),
      role: role || liveMetrics?.role || null,
      hardware_score: Number(hardwareScore) || 0,
      contribution_level: String(contributionLevel || 'standard'),
      contributing: !!contributing,
      lm_studio_active: !!lmStudioActive,
      window_started_at: now,
      last_sample_at: now,
      sample_count: 0,
      cpu_sum: 0,
      cpu_count: 0,
      gpu_sum: 0,
      gpu_count: 0,
      contributing_seconds: 0,
    };
    samplesByKey.set(key, row);
  }
  const elapsedSec = Math.max(0, Math.round((now - (row.last_sample_at || now)) / 1000));
  if (row.contributing && contributing) row.contributing_seconds += elapsedSec;
  row.last_sample_at = now;
  row.sample_count += 1;
  row.contributing = !!contributing;
  row.lm_studio_active = row.lm_studio_active || !!lmStudioActive;
  row.hardware_score = Math.max(row.hardware_score, Number(hardwareScore) || 0);
  row.contribution_level = String(contributionLevel || row.contribution_level || 'standard');
  if (Number.isFinite(Number(cpu))) {
    row.cpu_sum += Number(cpu);
    row.cpu_count += 1;
  }
  if (Number.isFinite(Number(gpu))) {
    row.gpu_sum += Number(gpu);
    row.gpu_count += 1;
  }
  return row;
}

function listReadyWindows(maxAgeMs = 15 * 60 * 1000) {
  const now = Date.now();
  const out = [];
  for (const [key, row] of samplesByKey) {
    const age = now - (row.window_started_at || now);
    if (age < maxAgeMs) continue;
    out.push({
      key,
      ...row,
      window_seconds: Math.max(1, Math.round(age / 1000)),
      cpu_percent_avg: row.cpu_count ? row.cpu_sum / row.cpu_count : 0,
      gpu_util_avg: row.gpu_count ? row.gpu_sum / row.gpu_count : 0,
    });
  }
  return out;
}

function clearWindow(key) {
  const row = samplesByKey.get(key);
  if (!row) return null;
  const now = Date.now();
  const next = {
    ...row,
    window_started_at: now,
    last_sample_at: now,
    sample_count: 0,
    cpu_sum: 0,
    cpu_count: 0,
    gpu_sum: 0,
    gpu_count: 0,
    contributing_seconds: 0,
  };
  samplesByKey.set(key, next);
  return next;
}

function fleetBonusKey(identityId, date = todayKey()) {
  return `${date}::${identityId}`;
}

function hasFleetBonusToday(identityId) {
  return fleetBonusAwarded.has(fleetBonusKey(identityId));
}

function markFleetBonusToday(identityId) {
  fleetBonusAwarded.add(fleetBonusKey(identityId));
}

function getEconomySummary(identityId) {
  const daily = getDailyState(identityId);
  return {
    formula_version: computeCredits.FORMULA_VERSION,
    daily_caps: computeCredits.DAILY_CAPS,
    daily_totals: daily?.totals || null,
    spend_catalog: computeCredits.SPEND_CATALOG,
    active_jobs: [...activeJobs.values()].filter((j) => j.identity_id === identityId).length,
  };
}

module.exports = {
  startJob,
  touchJob,
  finishJob,
  recordSample,
  listReadyWindows,
  clearWindow,
  grantWithCap,
  getDailyState,
  hasFleetBonusToday,
  markFleetBonusToday,
  getEconomySummary,
};
