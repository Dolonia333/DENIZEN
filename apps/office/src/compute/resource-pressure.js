'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DISK_WARN_FREE_GB = Number(process.env.DENIZEN_DISK_WARN_GB) || 5;
const QUEUE_SATURATED = Number(process.env.DENIZEN_QUEUE_SATURATED) || 8;

function diskFreeGb(targetPath) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync(targetPath);
      const free = Number(st.bfree || 0) * Number(st.bsize || 0);
      return free / (1024 ** 3);
    }
  } catch (_) {}
  return null;
}

function countGpuNodes(fleet = []) {
  return fleet.filter((n) => {
    const vram = Number(n?.gpu?.vram_total_mb ?? n?.vram_mb ?? 0);
    return vram >= 6000 || String(n?.role || '').toLowerCase() === 'host';
  }).length;
}

function countContributing(fleet = []) {
  return fleet.filter((n) => n?.contributing || n?.role === 'host').length;
}

function gatherSignals({
  queuePending = 0,
  assignedStuck = 0,
  fleet = [],
  lmStudioReachable = true,
  denizenRoot = null,
} = {}) {
  const root = denizenRoot || path.join(__dirname, '..', '..');
  const freeGb = diskFreeGb(root);
  const gpuNodes = countGpuNodes(fleet);
  const contributing = countContributing(fleet);
  const ramFreePct = os.freemem() / Math.max(1, os.totalmem());

  const pressures = [];
  if (!lmStudioReachable) pressures.push('lm_studio_down');
  if (queuePending >= QUEUE_SATURATED) pressures.push('mesh_queue_saturated');
  if (assignedStuck > 0) pressures.push('stuck_assignments');
  if (contributing < 1) pressures.push('no_contributors');
  if (gpuNodes < 1) pressures.push('no_gpu_nodes');
  if (freeGb != null && freeGb < DISK_WARN_FREE_GB) pressures.push('disk_low');
  if (ramFreePct < 0.08) pressures.push('host_ram_low');

  const severity = pressures.includes('lm_studio_down') || pressures.includes('disk_low')
    ? 'critical'
    : pressures.length >= 2 ? 'high' : pressures.length ? 'medium' : 'low';

  return {
    queue_pending: queuePending,
    assigned_stuck: assignedStuck,
    contributing_nodes: contributing,
    gpu_nodes: gpuNodes,
    disk_free_gb: freeGb != null ? Math.round(freeGb * 10) / 10 : null,
    ram_free_pct: Math.round(ramFreePct * 100),
    lm_studio_reachable: lmStudioReachable,
    pressures,
    severity,
    saturated: pressures.includes('mesh_queue_saturated') || !lmStudioReachable || assignedStuck > 0,
  };
}

function buildResourcePressureBlock(signals) {
  if (!signals || !signals.pressures?.length) {
    return '## Resource pressure\nMesh and host look healthy — proceed with normal routing.';
  }
  const lines = [
    '## Resource pressure (live)',
    `- Severity: ${signals.severity}`,
    `- Pressures: ${signals.pressures.join(', ')}`,
    `- Queue: ${signals.queue_pending} pending, ${signals.assigned_stuck} stuck`,
    `- Contributors: ${signals.contributing_nodes}, GPU nodes: ${signals.gpu_nodes}`,
  ];
  if (signals.disk_free_gb != null) lines.push(`- Disk free: ~${signals.disk_free_gb} GB`);
  lines.push(`- RAM free: ${signals.ram_free_pct}%`);
  if (signals.saturated) {
    lines.push('- Action: suggest BYOK API key, Denizen Desktop pairing, or wait for mesh capacity');
    lines.push('- DevOps: [RUN_SKILL:health-check:{"action":"full"}] then [RUN_SKILL:remediate:{"action":"clear-stale-jobs"}] if authorized');
    if (signals.pressures.includes('lm_studio_down')) {
      lines.push('- LM Studio down: [RUN_SKILL:remediate:{"action":"restart-lm-studio"}] or set DENIZEN_AUTO_HEAL=1 for guarded auto-restart');
    }
  }
  if (signals.pressures.includes('disk_low') || signals.pressures.includes('no_gpu_nodes')) {
    lines.push('- Storage/compute: docker-sandbox or cloud-vm (Proxmox/webhook) for isolated work; ask super-users to opt into mesh');
  }
  if (process.env.DENIZEN_AUTO_HEAL === '1') {
    lines.push('- Auto-heal: mesh watchdog may auto-restart LM Studio and reclaim stale jobs when pressures spike');
  }
  return lines.join('\n');
}

function shouldBroadcastAlert(signals, prevSeverity = 'low') {
  if (!signals) return false;
  if (signals.severity === 'critical') return true;
  if (signals.severity === 'high' && prevSeverity !== 'high' && prevSeverity !== 'critical') return true;
  return false;
}

module.exports = {
  gatherSignals,
  buildResourcePressureBlock,
  shouldBroadcastAlert,
  countGpuNodes,
  countContributing,
  QUEUE_SATURATED,
};
