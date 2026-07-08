'use strict';

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

function isLikelyDiscreteGpu(gpuModel) {
  const value = String(gpuModel || '').trim().toLowerCase();
  if (!value) return false;
  if (value.includes('integrated')) return false;
  if (value.includes('intel uhd')) return false;
  if (value.includes('intel iris')) return false;
  if (value.includes('apple m1')) return false;
  if (value.includes('apple m2')) return false;
  if (value.includes('apple m3')) return false;
  return true;
}

function scoreVram(vramMb) {
  const vram = toInt(vramMb);
  if (vram >= 24576) return 34;
  if (vram >= 16384) return 28;
  if (vram >= 12288) return 22;
  if (vram >= 8192) return 16;
  if (vram >= 6144) return 12;
  if (vram >= 4096) return 8;
  if (vram >= 2048) return 4;
  return 0;
}

function scoreRam(ramMb) {
  const ram = toInt(ramMb);
  if (ram >= 65536) return 28;
  if (ram >= 32768) return 22;
  if (ram >= 16384) return 15;
  if (ram >= 8192) return 9;
  if (ram >= 4096) return 4;
  return 0;
}

function scoreCpu(cpuCores) {
  const cores = toInt(cpuCores);
  if (cores >= 24) return 26;
  if (cores >= 16) return 22;
  if (cores >= 12) return 17;
  if (cores >= 8) return 12;
  if (cores >= 6) return 8;
  if (cores >= 4) return 5;
  if (cores >= 2) return 2;
  return 0;
}

function tierForScore(score) {
  if (score >= 75) return 'super_node';
  if (score >= 40) return 'contributor';
  return 'player';
}

function scoreHardware({ gpu, vramMb, ramMb, cpuCores } = {}) {
  const score =
    scoreVram(vramMb) +
    scoreRam(ramMb) +
    scoreCpu(cpuCores) +
    (isLikelyDiscreteGpu(gpu) ? 12 : 0);
  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    tier: tierForScore(boundedScore),
  };
}

function suggestContributionLevel(input = {}) {
  const details = input && typeof input === 'object' ? input : {};
  const hardware = scoreHardware({
    gpu: details.gpu,
    vramMb: details.vramMb,
    ramMb: details.ramMb,
    cpuCores: details.cpuCores,
  });
  const score = Number.isFinite(Number(details.score)) ? toInt(details.score) : hardware.score;
  const tier = details.tier || tierForScore(score);
  const optIn = details.optIn !== false;
  const idleOnly = details.idleOnly !== false;

  if (!optIn) return 'off';
  if (tier === 'super_node') return idleOnly ? 'standard' : 'max';
  if (tier === 'contributor') return idleOnly ? 'light' : 'standard';
  if (score >= 24) return 'light';
  return 'off';
}

module.exports = {
  scoreHardware,
  suggestContributionLevel,
  tierForScore,
};
