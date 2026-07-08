'use strict';

const counters = {
  direct_ok: 0,
  direct_fail: 0,
  rpc_ok: 0,
  rpc_fail: 0,
  rpc_latency_ms_total: 0,
  rpc_latency_ms_count: 0,
};

function recordInferenceResult(mode, ok, latencyMs = null) {
  const m = String(mode || 'direct').toLowerCase();
  if (m === 'mesh_rpc' || m === 'rpc') {
    if (ok) counters.rpc_ok += 1;
    else counters.rpc_fail += 1;
    if (ok && Number.isFinite(Number(latencyMs))) {
      counters.rpc_latency_ms_total += Number(latencyMs);
      counters.rpc_latency_ms_count += 1;
    }
  } else if (ok) {
    counters.direct_ok += 1;
  } else {
    counters.direct_fail += 1;
  }
}

function buildMetrics() {
  const avgRpc = counters.rpc_latency_ms_count > 0
    ? Math.round(counters.rpc_latency_ms_total / counters.rpc_latency_ms_count)
    : null;
  return {
    ...counters,
    rpc_latency_ms_avg: avgRpc,
    updated_at: new Date().toISOString(),
  };
}

function resetForTests() {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}

module.exports = {
  recordInferenceResult,
  buildMetrics,
  resetForTests,
};
