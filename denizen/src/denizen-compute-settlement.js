'use strict';

const computeCredits = require('./denizen-compute-credits.js');
const contributionTracker = require('./denizen-contribution-tracker.js');

const SETTLEMENT_INTERVAL_MS = 15 * 60 * 1000;

let settlementTimer = null;
let lastSettlementAt = null;

async function awardIfGranted(creditsApi, identityId, amount, reason, metadata = {}) {
  if (!creditsApi?.awardCredits || !identityId || amount <= 0) return null;
  return creditsApi.awardCredits(identityId, amount, reason, { metadata });
}

async function settleIdentityWindows(identityId, windows, creditsApi) {
  const grants = [];
  for (const window of windows) {
    if (window.identity_id !== identityId) continue;

    const uptime = computeCredits.computeUptimeCredits({
      hardwareScore: window.hardware_score,
      contributionLevel: window.contribution_level,
      windowSeconds: window.window_seconds,
      cpuPercentAvg: window.cpu_percent_avg,
      gpuUtilAvg: window.gpu_util_avg,
      contributing: window.contributing,
    });
    if (uptime.amount > 0) {
      const cap = contributionTracker.grantWithCap(identityId, 'uptime', uptime.amount);
      if (cap.granted > 0) {
        const ledger = await awardIfGranted(creditsApi, identityId, cap.granted, 'compute_uptime_settlement', {
          ...uptime.breakdown,
          formula_version: uptime.formula_version,
          machine_id: window.machine_id,
          capped: cap.capped,
        }).catch(() => null);
        grants.push({ type: 'uptime', amount: cap.granted, ledger, cap });
      }
    }

    if (window.lm_studio_active || window.role === 'host') {
      const stipend = computeCredits.computeHostStipendCredits({
        hardwareScore: window.hardware_score,
        lmStudioActive: window.lm_studio_active,
        gpuUtilAvg: window.gpu_util_avg,
        windowHours: window.window_seconds / 3600,
      });
      if (stipend.amount > 0) {
        const cap = contributionTracker.grantWithCap(identityId, 'host_stipend', stipend.amount);
        if (cap.granted > 0) {
          const ledger = await awardIfGranted(creditsApi, identityId, cap.granted, 'compute_host_stipend', {
            ...stipend.breakdown,
            formula_version: stipend.formula_version,
            machine_id: window.machine_id,
            capped: cap.capped,
          }).catch(() => null);
          grants.push({ type: 'host_stipend', amount: cap.granted, ledger, cap });
        }
      }
    }

    contributionTracker.clearWindow(window.key);
  }
  return grants;
}

async function maybeAwardFleetBonus(identityId, contributingMachines, creditsApi) {
  if (contributionTracker.hasFleetBonusToday(identityId)) return null;
  const bonus = computeCredits.computeFleetBonusCredits(contributingMachines);
  if (bonus.amount <= 0) return null;
  const cap = contributionTracker.grantWithCap(identityId, 'fleet_bonus', bonus.amount);
  if (cap.granted <= 0) return null;
  const ledger = await awardIfGranted(creditsApi, identityId, cap.granted, 'compute_fleet_bonus', {
    ...bonus.breakdown,
    formula_version: bonus.formula_version,
    capped: cap.capped,
  }).catch(() => null);
  contributionTracker.markFleetBonusToday(identityId);
  return { amount: cap.granted, ledger, cap };
}

async function runSettlement(ctx = {}) {
  const creditsApi = ctx.creditsApi;
  if (!creditsApi?.awardCredits) {
    return { ok: false, error: 'credits_api_unavailable' };
  }

  const windows = contributionTracker.listReadyWindows();
  const byIdentity = new Map();
  for (const window of windows) {
    if (!window.identity_id) continue;
    if (!byIdentity.has(window.identity_id)) byIdentity.set(window.identity_id, []);
    byIdentity.get(window.identity_id).push(window);
  }

  const results = [];
  for (const [identityId, identityWindows] of byIdentity) {
    const grants = await settleIdentityWindows(identityId, identityWindows, creditsApi);
    results.push({ identity_id: identityId, grants });
  }

  if (typeof ctx.countContributingMachines === 'function') {
    for (const [identityId] of byIdentity) {
      const machines = await ctx.countContributingMachines(identityId).catch(() => 1);
      const fleet = await maybeAwardFleetBonus(identityId, machines, creditsApi);
      if (fleet) {
        const row = results.find((r) => r.identity_id === identityId);
        if (row) row.grants.push({ type: 'fleet_bonus', ...fleet });
        else results.push({ identity_id: identityId, grants: [{ type: 'fleet_bonus', ...fleet }] });
      }
    }
  }

  lastSettlementAt = new Date().toISOString();
  return { ok: true, at: lastSettlementAt, identities: results.length, results };
}

function startSettlementLoop(ctx = {}) {
  if (settlementTimer) return { ok: true, alreadyRunning: true };
  const intervalMs = Math.max(60_000, Number(ctx.intervalMs) || SETTLEMENT_INTERVAL_MS);
  const tick = () => {
    runSettlement(ctx).catch((err) => {
      console.warn('[compute-settlement] failed:', err?.message || err);
    });
  };
  tick();
  settlementTimer = setInterval(tick, intervalMs);
  return { ok: true, running: true, intervalMs };
}

function stopSettlementLoop() {
  if (settlementTimer) {
    clearInterval(settlementTimer);
    settlementTimer = null;
  }
  return { ok: true, running: false };
}

function getStatus() {
  return {
    running: !!settlementTimer,
    last_settlement_at: lastSettlementAt,
    interval_ms: SETTLEMENT_INTERVAL_MS,
    formula_version: computeCredits.FORMULA_VERSION,
  };
}

module.exports = {
  runSettlement,
  startSettlementLoop,
  stopSettlementLoop,
  getStatus,
  settleIdentityWindows,
  maybeAwardFleetBonus,
};
