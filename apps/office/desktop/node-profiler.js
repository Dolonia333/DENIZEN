'use strict';

const os = require('node:os');
const { requireDenizenSrc } = require('./denizen-src');
const hardwareMonitor = requireDenizenSrc('denizen-hardware-monitor');

function collectMachineProfile(extra = {}) {
  const cpus = os.cpus() || [];
  const ramMb = Math.round((os.totalmem() || 0) / (1024 * 1024));
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    cpu_cores: cpus.length || null,
    ram_mb: ramMb,
    gpu_model: extra.gpu_model || null,
    vram_mb: extra.vram_mb || null,
    capabilities: extra.capabilities || {},
  };
}

async function collectLiveMetrics(extra = {}) {
  return hardwareMonitor.collectLiveMetrics({
    role: 'desktop',
    machine_id: extra.machine_id || `desktop-${os.hostname()}`,
    label: extra.label || os.hostname(),
    contributing: extra.contributing,
    jobs_completed: extra.jobs_completed,
  });
}

module.exports = { collectMachineProfile, collectLiveMetrics };
