'use strict';

const { normalizeBaseUrl, probeLmStudioEndpoint } = require('./lm-studio-probe');
const { resolveRouterLmUrl, enrichLmStudioBlock, isLoopbackUrl } = require('./lm-studio-advertise');

/** nodeId -> node record */
const nodes = new Map();
/** nodeId -> cooldown until ms */
const failureCooldown = new Map();

const STALE_PROBE_MS = 90 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const SATURATED_QUEUE_DEPTH = Number(process.env.LM_STUDIO_SATURATED_QUEUE) || 4;

let probeTimer = null;

function envTriBool(name) {
  const v = process.env[name];
  if (v == null || v === '') return null;
  if (/^(0|false|no|off)$/i.test(String(v))) return false;
  if (/^(1|true|yes|on)$/i.test(String(v))) return true;
  return null;
}

function isEnabled() {
  const explicit = envTriBool('LM_STUDIO_ROUTER');
  if (explicit !== null) return explicit;
  if (String(process.env.LM_STUDIO_REMOTE_URLS || '').trim()) return true;
  if (process.env.DENIZEN_FLEET_IDENTITY_ID || process.env.DENIZEN_FLEET_AGENT_TOKEN) return true;
  return true;
}

function parseRemoteUrls() {
  const raw = String(process.env.LM_STUDIO_REMOTE_URLS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => normalizeBaseUrl(s)).filter(Boolean);
}

/** NAS / headless primaries often have no local LM Studio — only remotes. */
function isRemoteOnlyMode() {
  const local = String(
    process.env.LM_STUDIO_URL
    || process.env.LM_STUDIO_BASE_URL
    || '',
  ).trim();
  return !local && parseRemoteUrls().length > 0;
}

function defaultHostUrl() {
  const local = String(
    process.env.LM_STUDIO_URL
    || process.env.LM_STUDIO_BASE_URL
    || '',
  ).trim();
  if (local) return normalizeBaseUrl(local);
  const remotes = parseRemoteUrls();
  if (remotes.length) return remotes[0];
  return normalizeBaseUrl('http://127.0.0.1:1234');
}

function upsertNode(partial = {}) {
  const url = partial.url ? normalizeBaseUrl(partial.url) : null;
  if (!url && !partial.rpc_capable) return null;

  const nodeId = String(partial.node_id || partial.nodeId || partial.machine_id || url || 'node');
  const prev = nodes.get(nodeId) || {};
  const next = {
    ...prev,
    ...partial,
    node_id: nodeId,
    url: url || prev.url || null,
    updated_at: new Date().toISOString(),
  };
  nodes.set(nodeId, next);
  return next;
}

function ingestFromMachine(machine = {}) {
  if (!machine || typeof machine !== 'object') return null;

  const inference = machine.inference && typeof machine.inference === 'object'
    ? machine.inference
    : {};
  const lm = machine.lm_studio && typeof machine.lm_studio === 'object'
    ? machine.lm_studio
    : {};
  const url = resolveRouterLmUrl(machine, lm)
    || normalizeBaseUrl(
      inference.advertise_url
      || inference.url
      || lm.url
      || machine.lm_studio_url
      || (machine.role === 'host' ? defaultHostUrl() : null),
    );
  if (!url && !inference.rpc_capable) return null;

  const gpu = machine.gpu || {};
  const nodeId = machine.machine_id || url;
  const prev = nodes.get(nodeId) || {};
  const reachableLocal = inference.reachable_local != null
    ? !!inference.reachable_local
    : (lm.reachable_local != null ? !!lm.reachable_local : !!inference.reachable || !!lm.reachable);
  const rpcCapable = inference.rpc_capable != null
    ? !!inference.rpc_capable
    : (reachableLocal && machine.contributing !== false);

  return upsertNode({
    node_id: nodeId,
    machine_id: machine.machine_id || null,
    label: machine.label || machine.hostname || machine.machine_id || url,
    role: machine.role || 'node',
    url: url || prev.url || null,
    reachable: lm.reachable != null ? !!lm.reachable : (prev.reachable ?? false),
    reachable_local: reachableLocal,
    rpc_capable: rpcCapable,
    network_reachable: inference.network_reachable != null
      ? !!inference.network_reachable
      : (lm.network_reachable != null ? !!lm.network_reachable : prev.network_reachable ?? null),
    inference_backend: inference.backend || lm.backend || prev.inference_backend || 'lmstudio',
    models: Array.isArray(inference.models) && inference.models.length
      ? inference.models
      : (Array.isArray(lm.models) ? lm.models : prev.models),
    main_model: inference.main_model || lm.main_model || lm.mainModel || null,
    fast_model: inference.fast_model || lm.fast_model || lm.fastModel || null,
    vram_mb: Number(gpu.vram_total_mb ?? machine.vram_mb) || null,
    gpu_util: Number(gpu.utilization_percent) || null,
    cpu_percent: Number(machine.cpu_percent) || null,
    contributing: machine.contributing != null ? !!machine.contributing : true,
    source: 'fleet',
    last_probe_at: inference.probed_at || lm.probed_at || lm.last_probe_at || machine.sampled_at || null,
    heartbeat_at: machine.sampled_at || new Date().toISOString(),
  });
}

function registerBootstrap() {
  if (!isRemoteOnlyMode()) {
    const hostUrl = normalizeBaseUrl(
      process.env.LM_STUDIO_URL
      || process.env.LM_STUDIO_BASE_URL
      || 'http://127.0.0.1:1234',
    );
    upsertNode({
      node_id: `host-${hostUrl}`,
      machine_id: `host-${hostUrl}`,
      label: 'Denizen host',
      role: 'host',
      url: hostUrl,
      source: 'bootstrap',
    });
  }

  for (const url of parseRemoteUrls()) {
    upsertNode({
      node_id: url,
      machine_id: url,
      label: `LM Studio · ${url}`,
      role: 'remote',
      url,
      source: 'env',
    });
  }
}

function listNodes() {
  return [...nodes.values()].map((n) => ({ ...n }));
}

function isOnCooldown(nodeId) {
  const until = failureCooldown.get(nodeId) || 0;
  return Date.now() < until;
}

function markFailure(nodeId, _err = null) {
  const id = String(nodeId || '');
  if (!id) return;
  failureCooldown.set(id, Date.now() + FAILURE_COOLDOWN_MS);
  const node = nodes.get(id);
  if (node) {
    nodes.set(id, {
      ...node,
      reachable: false,
      last_error: _err?.message || 'request failed',
      updated_at: new Date().toISOString(),
    });
  }
}

function acquire(nodeId) {
  const id = String(nodeId || '');
  const node = nodes.get(id);
  if (!node) return;
  nodes.set(id, {
    ...node,
    inflight: (Number(node.inflight) || 0) + 1,
    updated_at: new Date().toISOString(),
  });
}

function release(nodeId) {
  const id = String(nodeId || '');
  const node = nodes.get(id);
  if (!node) return;
  nodes.set(id, {
    ...node,
    inflight: Math.max(0, (Number(node.inflight) || 0) - 1),
    updated_at: new Date().toISOString(),
  });
}

function scoreNode(node, opts = {}) {
  if (!node?.node_id) return -1;
  if (isOnCooldown(node.node_id)) return -1;
  if (isRemoteOnlyMode() && isLoopbackUrl(node.url)) return -1;

  const exclude = new Set((opts.excludeNodeIds || []).map(String));
  if (exclude.has(String(node.node_id))) return -1;

  const probedAt = node.last_probe_at ? new Date(node.last_probe_at).getTime() : 0;
  const heartbeatAt = node.heartbeat_at ? new Date(node.heartbeat_at).getTime() : 0;
  const freshnessAt = Math.max(probedAt, heartbeatAt);
  if (!freshnessAt) return -1;

  const probeAge = Date.now() - freshnessAt;
  const directReachable = node.reachable === true && probeAge < STALE_PROBE_MS * 3;
  const rpcCapable = node.rpc_capable === true && node.reachable_local !== false;
  if (!directReachable && !rpcCapable) return -1;

  let score = directReachable ? 80 : 52;
  if (rpcCapable && !directReachable) score += 8;

  score -= (Number(node.inflight) || 0) * 18;
  if (node.gpu_util != null) score -= Number(node.gpu_util) * 0.35;
  if (node.cpu_percent != null) score -= Number(node.cpu_percent) * 0.08;

  const vram = Number(node.vram_mb) || 0;
  if (opts.tier === 'fast') {
    score += 10;
  } else {
    score += Math.min(45, vram / 256);
  }

  if (opts.priority === 'high' && node.role === 'host' && !isRemoteOnlyMode()) score += 22;

  const queueDepth = Number(opts.queueDepth) || 0;
  if (queueDepth >= SATURATED_QUEUE_DEPTH && node.role !== 'host') {
    score += Math.min(35, queueDepth * 4);
  }

  if (probeAge > STALE_PROBE_MS) score -= directReachable ? 12 : 6;
  if (node.contributing === false) score -= 25;

  return Math.round(score * 10) / 10;
}

function selectEndpoint(opts = {}) {
  if (!isEnabled()) {
    return {
      node_id: 'default',
      url: defaultHostUrl(),
      score: 0,
      routed: false,
    };
  }

  const ranked = listNodes()
    .map((node) => ({ node, score: scoreNode(node, opts) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    const remotes = parseRemoteUrls();
    const fallbackUrl = remotes[0] || defaultHostUrl();
    if (isRemoteOnlyMode() && isLoopbackUrl(fallbackUrl) && remotes[0]) {
      return {
        node_id: remotes[0],
        url: remotes[0],
        score: 0,
        routed: false,
        reason: 'remote_only_fallback',
      };
    }
    return {
      node_id: 'fallback',
      url: fallbackUrl,
      score: 0,
      routed: false,
      reason: 'no_nodes',
    };
  }

  const best = ranked[0].node;
  return {
    node_id: best.node_id,
    url: best.url,
    label: best.label,
    role: best.role,
    score: ranked[0].score,
    routed: true,
    candidates: ranked.length,
  };
}

function pickModelForTier(node, tier, configModel) {
  if (tier === 'fast') {
    return node.fast_model
      || process.env.LM_STUDIO_FAST_MODEL
      || configModel;
  }
  return node.main_model
    || process.env.LM_STUDIO_MODEL
    || configModel;
}

function resolveProviderConfig(config, opts = {}) {
  const tier = opts.tier === 'fast' ? 'fast' : 'main';
  const pick = selectEndpoint({
    tier,
    priority: opts.priority,
    queueDepth: opts.queueDepth,
    excludeNodeIds: opts.excludeNodeIds,
  });

  const node = nodes.get(pick.node_id) || {};
  const model = pickModelForTier(node, tier, config?.model);
  const directReachable = node.reachable === true;
  const inferenceMode = directReachable && node.url ? 'direct' : (node.rpc_capable ? 'rpc' : 'direct');

  return {
    ...config,
    baseUrl: pick.url || config.baseUrl,
    model: model || config.model,
    _routerNodeId: pick.node_id,
    _routerScore: pick.score,
    _routerRouted: pick.routed,
    _inferenceMode: inferenceMode,
    _rpcCapable: !!node.rpc_capable,
    _networkReachable: node.network_reachable != null ? !!node.network_reachable : directReachable,
  };
}

async function probeNode(nodeId) {
  const node = nodes.get(String(nodeId || ''));
  if (!node?.url) return null;

  const probe = await probeLmStudioEndpoint(node.url, {
    apiKey: process.env.LM_STUDIO_API_KEY,
  });

  const next = upsertNode({
    ...node,
    url: probe.url || node.url,
    reachable: probe.reachable,
    models: probe.models,
    main_model: probe.main_model || node.main_model,
    last_probe_at: probe.probed_at,
    last_error: probe.error || null,
    source: node.source || 'probe',
  });
  return next;
}

async function refreshAll() {
  const ids = [...nodes.keys()];
  const results = await Promise.all(ids.map((id) => probeNode(id).catch(() => null)));
  return results.filter(Boolean);
}

function anyReachable() {
  const now = Date.now();
  return listNodes().some((n) => {
    if (n.reachable !== true || isOnCooldown(n.node_id)) return false;
    const probedAt = n.last_probe_at ? new Date(n.last_probe_at).getTime() : 0;
    if (!probedAt) return false;
    return now - probedAt < STALE_PROBE_MS * 4;
  });
}

function hasRemoteNodes() {
  return listNodes().some((n) => n.role !== 'host' && n.reachable !== false);
}

function isSaturated(queueDepth = 0) {
  const depth = Number(queueDepth) || 0;
  if (depth < SATURATED_QUEUE_DEPTH) return false;
  const host = listNodes().find((n) => n.role === 'host');
  const hostBusy = (Number(host?.inflight) || 0) >= (Number(process.env.LM_STUDIO_PARALLEL) || 1);
  return hostBusy || depth >= SATURATED_QUEUE_DEPTH + 2;
}

function buildStatus(queueDepth = 0) {
  const nodeList = listNodes().map((n) => ({
    node_id: n.node_id,
    label: n.label,
    role: n.role,
    url: n.url,
    reachable: n.reachable,
    reachable_local: n.reachable_local,
    rpc_capable: n.rpc_capable,
    inference_backend: n.inference_backend || null,
    inference_mode: n.reachable && n.url ? 'direct' : (n.rpc_capable ? 'rpc' : 'none'),
    inflight: n.inflight || 0,
    vram_mb: n.vram_mb,
    gpu_util: n.gpu_util,
    models: (n.models || []).slice(0, 6),
    main_model: n.main_model || null,
    last_probe_at: n.last_probe_at || null,
    heartbeat_at: n.heartbeat_at || null,
    score: scoreNode(n, { tier: 'main', queueDepth }),
  }));

  return {
    enabled: isEnabled(),
    saturated: isSaturated(queueDepth),
    any_reachable: anyReachable(),
    remote_nodes: hasRemoteNodes(),
    host_url: defaultHostUrl(),
    nodes: nodeList.sort((a, b) => (b.score || 0) - (a.score || 0)),
    selected: selectEndpoint({ tier: 'main', queueDepth }),
  };
}

function startProbeLoop(intervalMs = 45000) {
  if (probeTimer) return { ok: true, alreadyRunning: true };
  registerBootstrap();
  const ms = Math.max(15000, Number(intervalMs) || 45000);
  const tick = () => {
    refreshAll().catch(() => null);
  };
  tick();
  probeTimer = setInterval(tick, ms);
  return { ok: true, running: true, intervalMs: ms };
}

function stopProbeLoop() {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
  return { ok: true, running: false };
}

function clearRegistryForTests() {
  nodes.clear();
  failureCooldown.clear();
}

function activeInferenceUrl(opts = {}) {
  const pick = selectEndpoint(opts);
  return pick?.url || defaultHostUrl();
}

module.exports = {
  clearRegistryForTests,
  isEnabled,
  isRemoteOnlyMode,
  registerBootstrap,
  upsertNode,
  ingestFromMachine,
  listNodes,
  selectEndpoint,
  resolveProviderConfig,
  acquire,
  release,
  markFailure,
  probeNode,
  refreshAll,
  anyReachable,
  hasRemoteNodes,
  isSaturated,
  buildStatus,
  startProbeLoop,
  stopProbeLoop,
  defaultHostUrl,
  activeInferenceUrl,
  parseRemoteUrls,
};
