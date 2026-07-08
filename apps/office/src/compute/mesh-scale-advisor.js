'use strict';

const lmStudioRemediator = require('../integrations/lm-studio-remediator');

function adviseScale(signals = {}) {
  const actions = [];
  const pressures = signals.pressures || [];

  if (pressures.includes('lm_studio_down')) {
    actions.push({
      type: 'restart_lm_studio',
      priority: 'critical',
      auto_eligible: true,
      message: 'Restart LM Studio and verify /v1/models responds',
    });
  }
  if (pressures.includes('mesh_queue_saturated') || pressures.includes('stuck_assignments')) {
    actions.push({
      type: 'reclaim_stale_jobs',
      priority: 'high',
      auto_eligible: true,
      message: 'Reclaim stale mesh assignments and expire old smoke jobs',
    });
    actions.push({
      type: 'request_mesh_contributors',
      priority: 'high',
      auto_eligible: false,
      message: 'Notify desktop super-users to opt into mesh contribution',
    });
    actions.push({
      type: 'route_byok',
      priority: 'medium',
      auto_eligible: true,
      message: 'Prefer visitor BYOK keys for chat while mesh is saturated',
    });
  }
  if (pressures.includes('no_gpu_nodes') || pressures.includes('no_contributors')) {
    actions.push({
      type: 'provision_isolated_vm',
      priority: 'medium',
      auto_eligible: false,
      message: 'DevOps may provision docker-sandbox or cloud-vm for isolated workloads',
    });
  }
  if (pressures.includes('disk_low')) {
    actions.push({
      type: 'disk_cleanup',
      priority: 'high',
      auto_eligible: false,
      message: 'Free disk space — prune old sandboxes and artifact dirs',
    });
  }

  return {
    severity: signals.severity || 'low',
    pressures,
    actions,
    auto_scale_enabled: process.env.DENIZEN_AUTO_HEAL === '1',
  };
}

async function executeAutoScale({ signals, deps = {}, broadcast } = {}) {
  if (process.env.DENIZEN_AUTO_HEAL !== '1') {
    return { ok: false, skipped: true, reason: 'DENIZEN_AUTO_HEAL not enabled', executed: [] };
  }

  const plan = adviseScale(signals);
  const executed = [];

  for (const action of plan.actions.filter((a) => a.auto_eligible)) {
    if (action.type === 'restart_lm_studio' && (signals.pressures || []).includes('lm_studio_down')) {
      const r = await lmStudioRemediator.restartAndVerify({ probeFn: deps.probeLmStudio });
      executed.push({ type: action.type, ok: r.ok, detail: r.summary });
      broadcast?.({
        type: 'mesh_scale_action',
        action: action.type,
        ok: r.ok,
        summary: r.summary,
        ts: Date.now(),
      });
    }
    if (action.type === 'reclaim_stale_jobs') {
      const computeQueue = deps.computeQueue;
      const reclaim = computeQueue?.reclaimStaleJobs
        ? await computeQueue.reclaimStaleJobs().catch(() => ({ reclaimed: 0 }))
        : { reclaimed: 0 };
      const expire = computeQueue?.expireOldQueuedJobs
        ? await computeQueue.expireOldQueuedJobs().catch(() => ({ expired: 0 }))
        : { expired: 0 };
      executed.push({ type: action.type, ok: true, reclaim, expire });
      broadcast?.({
        type: 'mesh_scale_action',
        action: action.type,
        ok: true,
        reclaimed: reclaim.reclaimed,
        expired: expire.expired,
        ts: Date.now(),
      });
    }
  }

  return {
    ok: executed.every((e) => e.ok !== false),
    executed,
    plan,
  };
}

module.exports = {
  adviseScale,
  executeAutoScale,
};
