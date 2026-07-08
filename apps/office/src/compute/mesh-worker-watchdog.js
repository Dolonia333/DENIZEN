'use strict';

let meshScaleAdvisor = null;
try { meshScaleAdvisor = require('./mesh-scale-advisor'); } catch (_) {}

const STALE_NODE_MS = Number(process.env.DENIZEN_MESH_NODE_STALE_MS) || 3 * 60 * 1000;
const STALE_JOB_MS = Number(process.env.DENIZEN_MESH_STALE_JOB_MS) || 30 * 60 * 1000;

let lastAlerts = [];
let lastRunAt = 0;

function classifyFleet(fleet = []) {
  const stale = [];
  const offline = [];
  const healthy = [];
  const now = Date.now();

  for (const m of fleet) {
    const sampled = m.sampled_at || m.updated_at;
    const age = sampled ? now - new Date(sampled).getTime() : Infinity;
    const inf = m.inference && typeof m.inference === 'object' ? m.inference : {};
    const lm = m.lm_studio && typeof m.lm_studio === 'object' ? m.lm_studio : {};
    const rpcLocal = (inf.rpc_capable || lm.rpc_capable) && (inf.reachable_local ?? lm.reachable_local);
    if (m.reachable === false && !rpcLocal) offline.push(m);
    else if (m.stale || age > STALE_NODE_MS) stale.push(m);
    else healthy.push(m);
  }
  return { stale, offline, healthy };
}

async function runWatchdogTick({ computeQueue, fleetRegistry, broadcast, log, resourcePressure, probeLmStudio } = {}) {
  const [pending, assigned] = await Promise.all([
    computeQueue?.listPendingJobs?.(50).catch(() => []) || [],
    computeQueue?.listAssignedJobs?.(50).catch(() => []) || [],
  ]);

  let reclaim = { reclaimed: 0, failed: 0 };
  let expire = { expired: 0 };
  if (computeQueue?.reclaimStaleJobs) {
    reclaim = await computeQueue.reclaimStaleJobs(STALE_JOB_MS).catch(() => reclaim);
  }
  if (computeQueue?.expireOldQueuedJobs) {
    expire = await computeQueue.expireOldQueuedJobs().catch(() => expire);
  }
  let trim = { trimmed: 0 };
  const alerts = [];

  if (pending.length >= 8 && computeQueue?.trimExcessQueuedJobs) {
    trim = await computeQueue.trimExcessQueuedJobs().catch(() => trim);
    if (trim.trimmed > 0) {
      alerts.push({
        severity: 'info',
        code: 'queue_trimmed',
        message: `Trimmed ${trim.trimmed} excess queued job(s)`,
        trimmed: trim.trimmed,
      });
    }
  }

  const fleet = fleetRegistry?.listAllFleetMachines?.()
    || fleetRegistry?.buildFleetSummary?.(null)?.fleet
    || [];
  const { stale, offline } = classifyFleet(fleet);

  if (pending.length >= 8) {
    alerts.push({
      severity: 'warn',
      code: 'queue_deep',
      message: `Mesh queue deep: ${pending.length} pending jobs`,
      queueDepth: pending.length,
    });
  }
  if (reclaim.reclaimed > 0) {
    alerts.push({
      severity: 'info',
      code: 'jobs_reclaimed',
      message: `Reclaimed ${reclaim.reclaimed} stale assigned job(s)`,
      reclaimed: reclaim.reclaimed,
    });
  }
  if (stale.length > 0) {
    alerts.push({
      severity: 'warn',
      code: 'stale_nodes',
      message: `${stale.length} mesh node(s) stopped reporting`,
      nodes: stale.map((n) => n.label || n.machine_id).slice(0, 5),
    });
  }
  if (offline.length > 0) {
    alerts.push({
      severity: 'error',
      code: 'offline_nodes',
      message: `${offline.length} fleet probe(s) unreachable`,
      nodes: offline.map((n) => n.label || n.machine_id).slice(0, 5),
    });
  }

  const snapshot = {
    at: Date.now(),
    pending: pending.length,
    assigned: assigned.length,
    fleet: fleet.length,
    alerts,
    reclaim,
    expire,
    trim,
  };

  lastAlerts = alerts;
  lastRunAt = snapshot.at;

  if (alerts.length && broadcast) {
    broadcast({
      type: 'mesh_watchdog_alert',
      alerts,
      pending: pending.length,
      assigned: assigned.length,
      fleet: fleet.length,
      ts: snapshot.at,
    });
  }

  if (reclaim.reclaimed > 0 || expire.expired > 0) {
    log?.info?.('MeshWatchdog', `reclaimed=${reclaim.reclaimed} expired=${expire.expired} alerts=${alerts.length}`);
  }

  if (meshScaleAdvisor && resourcePressure?.gatherSignals) {
    const fleet = fleetRegistry?.listAllFleetMachines?.()
      || fleetRegistry?.buildFleetSummary?.(null)?.fleet
      || [];
    let lmStudioReachable = true;
    if (typeof probeLmStudio === 'function') {
      const lm = await probeLmStudio().catch(() => ({ reachable: false }));
      lmStudioReachable = !!lm?.reachable;
    }
    const signals = resourcePressure.gatherSignals({
      queuePending: pending.length,
      assignedStuck: assigned.filter((j) => {
        const started = j.started_at ? new Date(j.started_at).getTime() : 0;
        return started && (Date.now() - started) > STALE_JOB_MS;
      }).length,
      fleet,
      lmStudioReachable,
    });
    const scalePlan = meshScaleAdvisor.adviseScale(signals);
    snapshot.scale_plan = scalePlan;
    if (process.env.DENIZEN_AUTO_HEAL === '1' && signals.pressures?.length) {
      const auto = await meshScaleAdvisor.executeAutoScale({
        signals,
        deps: { computeQueue, probeLmStudio },
        broadcast,
      }).catch(() => null);
      snapshot.auto_scale = auto;
    }
  }

  return snapshot;
}

function startMeshWatchdog({ computeQueue, fleetRegistry, broadcast, log, intervalMs, resourcePressure, probeLmStudio } = {}) {
  const ms = Number(intervalMs) || Number(process.env.DENIZEN_MESH_WATCHDOG_MS) || 90_000;
  const tickOpts = { computeQueue, fleetRegistry, broadcast, log, resourcePressure, probeLmStudio };
  runWatchdogTick(tickOpts).catch(() => {});
  const timer = setInterval(() => {
    runWatchdogTick(tickOpts).catch((err) => {
      console.warn('[MeshWatchdog] tick failed:', err?.message || err);
    });
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

function getLastAlerts() {
  return { alerts: lastAlerts, lastRunAt };
}

module.exports = {
  runWatchdogTick,
  startMeshWatchdog,
  getLastAlerts,
  classifyFleet,
  STALE_NODE_MS,
};
