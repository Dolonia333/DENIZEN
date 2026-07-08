'use strict';

const FORMULA_VERSION = 1;

const BASE_JOB_CREDITS = {
  npc_think_batch: 5,
  embedding_index: 8,
  sim_tick: 2,
  grok_telemetry_check: 1,
};

const EXPECTED_JOB_DURATION_MS = {
  npc_think_batch: 12000,
  embedding_index: 8000,
  sim_tick: 3000,
};

const LEVEL_MULTIPLIER = {
  max: 1.25,
  standard: 1.0,
  light: 0.6,
  off: 0,
};

const DAILY_CAPS = {
  job_credits: 300,
  uptime_credits: 80,
  host_stipend_credits: 50,
  fleet_bonus_credits: 10,
  total_credits: 200,
};

const SPEND_CATALOG = {
  priority_boost: { cost: 10, priority_delta: 20, label: 'Job priority boost' },
  queue_skip: { cost: 25, priority_delta: 40, label: 'Queue skip' },
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function capacityMultiplier(hardwareScore) {
  const score = toInt(hardwareScore, 0);
  if (score >= 75) return 1.5;
  if (score >= 40) return 1.2;
  if (score >= 24) return 1.0;
  return 0.85;
}

function levelMultiplier(contributionLevel) {
  return LEVEL_MULTIPLIER[String(contributionLevel || 'off').toLowerCase()] ?? 1.0;
}

function effortMultiplier(durationMs, jobType) {
  const expected = EXPECTED_JOB_DURATION_MS[jobType] || 5000;
  const duration = Math.max(0, toInt(durationMs, expected));
  return clamp(duration / expected, 0.5, 3);
}

function gpuMultiplier(gpuUtilPercent) {
  const util = Number(gpuUtilPercent);
  if (!Number.isFinite(util)) return 1.0;
  if (util >= 50) return 1.3;
  if (util >= 20) return 1.1;
  return 1.0;
}

function computeJobCredits({
  jobType,
  hardwareScore = 0,
  contributionLevel = 'standard',
  durationMs = null,
  gpuUtilAvg = null,
  cpuPercentAvg = null,
} = {}) {
  const type = String(jobType || '').trim();
  const base = BASE_JOB_CREDITS[type] || 3;
  const levelMult = levelMultiplier(contributionLevel);
  if (levelMult <= 0) {
    return {
      amount: 0,
      formula_version: FORMULA_VERSION,
      breakdown: { base, reason: 'contribution_off' },
    };
  }

  const capMult = capacityMultiplier(hardwareScore);
  const effortMult = effortMultiplier(durationMs, type);
  const gpuMult = gpuMultiplier(gpuUtilAvg ?? cpuPercentAvg);
  const raw = base * capMult * levelMult * effortMult * gpuMult;
  const amount = Math.max(1, Math.round(raw));

  return {
    amount,
    formula_version: FORMULA_VERSION,
    breakdown: {
      base,
      capacity_multiplier: capMult,
      level_multiplier: levelMult,
      effort_multiplier: effortMult,
      gpu_multiplier: gpuMult,
      hardware_score: toInt(hardwareScore, 0),
      duration_ms: durationMs,
      gpu_util_avg: gpuUtilAvg,
      cpu_percent_avg: cpuPercentAvg,
      job_type: type,
    },
  };
}

function computeUptimeCredits({
  hardwareScore = 0,
  contributionLevel = 'standard',
  windowSeconds = 900,
  cpuPercentAvg = 0,
  gpuUtilAvg = 0,
  contributing = true,
} = {}) {
  if (!contributing) {
    return { amount: 0, formula_version: FORMULA_VERSION, breakdown: { reason: 'not_contributing' } };
  }
  const levelMult = levelMultiplier(contributionLevel);
  if (levelMult <= 0) {
    return { amount: 0, formula_version: FORMULA_VERSION, breakdown: { reason: 'contribution_off' } };
  }

  const util = Math.max(
    0.1,
    ((Number(cpuPercentAvg) || 0) + (Number(gpuUtilAvg) || 0)) / 200,
  );
  const scoreFactor = clamp(toInt(hardwareScore, 0) / 100, 0.1, 1.5);
  const windowFactor = clamp(windowSeconds / 900, 0.1, 4);
  const raw = scoreFactor * util * windowFactor * levelMult * 3;
  const amount = Math.max(0, Math.min(8, Math.round(raw)));

  return {
    amount,
    formula_version: FORMULA_VERSION,
    breakdown: {
      hardware_score: toInt(hardwareScore, 0),
      level_multiplier: levelMult,
      window_seconds: windowSeconds,
      cpu_percent_avg: cpuPercentAvg,
      gpu_util_avg: gpuUtilAvg,
      util_factor: util,
      score_factor: scoreFactor,
    },
  };
}

function computeHostStipendCredits({
  hardwareScore = 0,
  lmStudioActive = false,
  gpuUtilAvg = 0,
  windowHours = 0.25,
} = {}) {
  if (!lmStudioActive) {
    return { amount: 0, formula_version: FORMULA_VERSION, breakdown: { reason: 'lm_studio_inactive' } };
  }
  const hourly = Math.max(1, Math.floor(toInt(hardwareScore, 0) / 20));
  const gpuFactor = Math.max(0.25, (Number(gpuUtilAvg) || 0) / 100);
  const raw = hourly * gpuFactor * windowHours;
  const amount = Math.max(0, Math.min(6, Math.round(raw)));

  return {
    amount,
    formula_version: FORMULA_VERSION,
    breakdown: {
      hourly_rate: hourly,
      gpu_factor: gpuFactor,
      window_hours: windowHours,
      hardware_score: toInt(hardwareScore, 0),
      lm_studio_active: true,
    },
  };
}

function computeFleetBonusCredits(contributingMachines = 1) {
  const machines = Math.max(0, toInt(contributingMachines, 0));
  const amount = machines > 1 ? Math.min(DAILY_CAPS.fleet_bonus_credits, machines - 1) : 0;
  return {
    amount,
    formula_version: FORMULA_VERSION,
    breakdown: {
      contributing_machines: machines,
      bonus_per_extra_machine: 1,
    },
  };
}

function applyDailyCap({ identityId, category, requested, dailyState = {} }) {
  const dateKey = dailyState.date || new Date().toISOString().slice(0, 10);
  const totals = dailyState.totals || {};
  const categoryCap = DAILY_CAPS[`${category}_credits`] ?? DAILY_CAPS.total_credits;
  const categoryUsed = toInt(totals[category], 0);
  const totalUsed = toInt(totals.total, 0);
  const categoryRoom = Math.max(0, categoryCap - categoryUsed);
  const totalRoom = Math.max(0, DAILY_CAPS.total_credits - totalUsed);
  const granted = Math.max(0, Math.min(requested, categoryRoom, totalRoom));
  return {
    granted,
    capped: granted < requested,
    date: dateKey,
    category,
    requested,
    category_cap: categoryCap,
    total_cap: DAILY_CAPS.total_credits,
  };
}

function getSpendOption(reason) {
  return SPEND_CATALOG[String(reason || '').trim()] || null;
}

module.exports = {
  FORMULA_VERSION,
  BASE_JOB_CREDITS,
  DAILY_CAPS,
  SPEND_CATALOG,
  capacityMultiplier,
  levelMultiplier,
  computeJobCredits,
  computeUptimeCredits,
  computeHostStipendCredits,
  computeFleetBonusCredits,
  applyDailyCap,
  getSpendOption,
};
