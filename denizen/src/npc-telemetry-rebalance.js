'use strict';

/**
 * Standing telemetry rebalance — per-NPC thresholds from fleet analysis.
 * Source: Claude Team MCP read of telemetry://fleet/latest/{bouncer,bob}.
 */

const REBALANCE = Object.freeze({
  Bouncer: {
    memoryFlushTokenThreshold: 2000,
    latencyMsThreshold: 4000,
    thinkMinMsOverride: 150000,
    pruneKeepRatio: 0.4,
    consultCooldownMs: 30 * 60 * 1000,
    strategy: 'debounce_thinks',
    standing: [
      'Flush at 2000t (not 2500) — already averaging 2100t/call.',
      'Bottleneck is call volume (109 ev), not per-call size — debounce think cycles.',
      'Keep current model tier; batch context re-reads across back-to-back thinks.',
    ],
  },
  Bob: {
    compressTokenThreshold: 1500,
    latencyMsThreshold: 4500,
    memoryCharsOverride: 280,
    pruneKeepRatio: 0.5,
    consultCooldownMs: 30 * 60 * 1000,
    strategy: 'context_compression',
    standing: [
      'Compress recentMemory when avg tokens cross ~1500 (growth-rate bloat).',
      '4718ms latency with fewer events than Bouncer = per-call inefficiency — shrink payload.',
      'Reassess model tier after one compression cycle if latency unchanged.',
    ],
  },
});

function rebalanceFor(npcName) {
  return REBALANCE[npcName] || null;
}

function effectiveThinkMinMs(npcName, defaultMs) {
  const cfg = rebalanceFor(npcName);
  return cfg?.thinkMinMsOverride ?? defaultMs;
}

function effectiveMemoryChars(npcName, defaultChars) {
  const cfg = rebalanceFor(npcName);
  return cfg?.memoryCharsOverride ?? defaultChars;
}

function effectivePruneKeepRatio(npcName, defaultRatio) {
  const cfg = rebalanceFor(npcName);
  return cfg?.pruneKeepRatio ?? defaultRatio;
}

function metricsThresholds(npcName) {
  const cfg = rebalanceFor(npcName);
  if (!cfg) return null;
  return {
    latencyMs: cfg.latencyMsThreshold,
    avgTokens: cfg.compressTokenThreshold ?? cfg.memoryFlushTokenThreshold,
    consultCooldownMs: cfg.consultCooldownMs,
  };
}

module.exports = {
  REBALANCE,
  rebalanceFor,
  effectiveThinkMinMs,
  effectiveMemoryChars,
  effectivePruneKeepRatio,
  metricsThresholds,
};
