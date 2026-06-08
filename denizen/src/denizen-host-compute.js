'use strict';

const denizenDb = require('./denizen-db.js');

const NODE_TABLE = 'denizen_compute_nodes';
const IDENTITY_TABLE = 'denizen_user_identities';

function isEnabled() {
  return Boolean(denizenDb?.enabled);
}

function normalizeRemoteAddress(addr) {
  return String(addr || '').replace(/^::ffff:/, '').trim();
}

function isLoopbackAddress(addr) {
  const normalized = normalizeRemoteAddress(addr);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function readHeader(req, name) {
  const headers = req?.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) return value;
  }
  return '';
}

function isLocalOperatorRequest(req) {
  if (!req) return false;
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true;
  const clientFlag = String(
    readHeader(req, 'x-denizen-local-client')
    || '',
  ).trim().toLowerCase();
  return clientFlag === '1' || clientFlag === 'true' || clientFlag === 'yes';
}

function isCeoPrincipalRequest(req) {
  if (!req) return false;
  return /^(1|true|yes)$/i.test(String(readHeader(req, 'x-ceo-principal') || ''));
}

function isCeoPrincipalIdentity(identity) {
  const meta = parseMetadata(identity?.metadata);
  return !!(meta.is_ceo_principal || meta.ceo_principal);
}

function isHostOperatorSession(req, identity = null) {
  return isHostOperatorIdentity(identity)
    || isLocalOperatorRequest(req)
    || isCeoPrincipalRequest(req)
    || isCeoPrincipalIdentity(identity);
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function isHostOperatorIdentity(identity) {
  const meta = parseMetadata(identity?.metadata);
  return !!(meta.is_host_operator || meta.host_operator);
}

function shortModelName(model) {
  const value = String(model || '').trim();
  if (!value) return null;
  const parts = value.split('/');
  return parts[parts.length - 1] || value;
}

async function probeLmStudio(npcBrains) {
  const lmCfg = npcBrains?.providers?.lmstudio || {};
  const lmStudioUrl = lmCfg.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234';
  const lmHeaders = {};
  if (lmCfg.apiKey) lmHeaders.Authorization = `Bearer ${lmCfg.apiKey}`;

  const stats = global._npcStats || {};
  const lastBrainOk = Math.max(
    stats.lastProviderOkAt || 0,
    stats.lastNpcConvAt || 0,
    stats.lastPlayerChatAt && stats.playerChatSucceeded > 0 ? stats.lastPlayerChatAt : 0,
  );
  const builtAt = Date.now();
  const recentBrainOk = lastBrainOk && (builtAt - lastBrainOk) < 30000;

  const status = {
    reachable: false,
    url: lmStudioUrl,
    model: lmCfg.model || process.env.LM_STUDIO_MODEL || null,
    fastModel: npcBrains?.providers?.['lmstudio-fast']?.model || process.env.LM_STUDIO_FAST_MODEL || null,
    livenessSource: null,
    error: null,
  };

  if (recentBrainOk) {
    const ago = Math.round((builtAt - lastBrainOk) / 1000);
    status.reachable = true;
    status.livenessSource = `brain call succeeded ${ago}s ago`;
    return status;
  }

  const probes = ['/v1/models', '/api/v0/models', '/'];
  const errors = [];
  for (const path of probes) {
    try {
      const probe = await fetch(`${lmStudioUrl}${path}`, {
        method: 'GET',
        headers: lmHeaders,
        signal: AbortSignal.timeout(4000),
      });
      if (probe.ok || probe.status === 401 || probe.status === 403) {
        status.reachable = true;
        status.livenessSource = `probe ${path} ok`;
        status.probedPath = path;
        return status;
      }
      errors.push(`${path}: HTTP ${probe.status}`);
    } catch (err) {
      errors.push(`${path}: ${err?.message || String(err)}`);
    }
  }

  status.error = errors.join('; ');
  return status;
}

function quickLmStudioSnapshot(npcBrains) {
  const lmCfg = npcBrains?.providers?.lmstudio || {};
  return {
    reachable: false,
    probe_skipped: true,
    url: lmCfg.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234',
    model: lmCfg.model || process.env.LM_STUDIO_MODEL || null,
    fastModel: npcBrains?.providers?.['lmstudio-fast']?.model || null,
    livenessSource: null,
    error: null,
  };
}

async function getLmStudioSnapshot(npcBrains, opts = {}) {
  if (opts.allowProbe === false) {
    return quickLmStudioSnapshot(npcBrains);
  }
  const cache = global._healthCache;
  if (cache?.body?.lmStudio && (Date.now() - cache.at) < 15000) {
    return { ...cache.body.lmStudio };
  }
  return probeLmStudio(npcBrains);
}

async function getOnlineNodeForIdentity(identityId) {
  if (!identityId) return null;
  let nodeWorker = null;
  try {
    // eslint-disable-next-line global-require
    nodeWorker = require('./denizen-node-worker.js');
  } catch (_) {
    nodeWorker = null;
  }
  if (nodeWorker?.getNodeForIdentity) {
    const node = await nodeWorker.getNodeForIdentity(identityId);
    if (node) {
      const heartbeatMs = node.last_heartbeat ? new Date(node.last_heartbeat).getTime() : 0;
      const stale = heartbeatMs && (Date.now() - heartbeatMs) > 10 * 60 * 1000;
      if (node.status === 'online' && !stale) return node;
    }
  }
  if (!isEnabled()) return null;
  const rows = await denizenDb._get(
    `${NODE_TABLE}?select=id,status,last_heartbeat,jobs_completed,reputation_score&identity_id=eq.${encodeURIComponent(identityId)}&order=last_heartbeat.desc&limit=5`,
  ).catch(() => []);

  for (const row of rows || []) {
    if (row.status !== 'online') continue;
    const heartbeatMs = row.last_heartbeat ? new Date(row.last_heartbeat).getTime() : 0;
    if (!heartbeatMs || (Date.now() - heartbeatMs) > 10 * 60 * 1000) continue;
    return row;
  }
  return null;
}

async function markHostOperatorIfLocal(identityId, req, identity = null) {
  if (!identityId || !isHostOperatorSession(req, identity)) return null;
  if (!isEnabled()) return identity || null;
  const rows = await denizenDb._get(
    `${IDENTITY_TABLE}?select=id,metadata&limit=1&id=eq.${encodeURIComponent(identityId)}`,
  );
  const existing = rows?.[0];
  if (!existing?.id) return identity || null;

  const meta = parseMetadata(existing.metadata);
  if (meta.is_host_operator) return existing;

  meta.is_host_operator = true;
  meta.host_operator_marked_at = new Date().toISOString();
  const patched = await denizenDb._patch(
    `${IDENTITY_TABLE}?id=eq.${encodeURIComponent(identityId)}`,
    { metadata: meta },
    { prefer: 'return=representation' },
  );
  return patched?.[0] || { ...existing, metadata: meta };
}

function resolveContributionState({
  identity = null,
  profile = null,
  req = null,
  lmStudio = null,
  activeNode = null,
} = {}) {
  const hostOperator = isHostOperatorSession(req, identity);
  const lmStudioActive = !!lmStudio?.reachable;
  const hostContributing = hostOperator && lmStudioActive;
  const networkOptIn = !!profile?.opt_in;
  const networkNodeActive = !!activeNode?.id;
  const contributing = hostContributing || networkOptIn || networkNodeActive;

  let contributionSource = null;
  if (hostContributing && (networkOptIn || networkNodeActive)) {
    contributionSource = 'host_and_network';
  } else if (hostContributing) {
    contributionSource = 'host_lmstudio';
  } else if (networkNodeActive) {
    contributionSource = 'compute_node';
  } else if (networkOptIn) {
    contributionSource = 'profile';
  }

  const modelLabel = shortModelName(lmStudio?.model);

  return {
    contributing,
    contribution_source: contributionSource,
    is_host_node: hostContributing,
    is_host_operator: hostOperator,
    host_lmstudio_active: hostContributing,
    network_opt_in: networkOptIn,
    lm_studio: lmStudio
      ? {
        reachable: !!lmStudio.reachable,
        model: lmStudio.model || null,
        model_short: modelLabel,
        url: lmStudio.url || null,
        liveness_source: lmStudio.livenessSource || null,
      }
      : null,
    active_node: activeNode
      ? {
        id: activeNode.id,
        status: activeNode.status,
        jobs_completed: activeNode.jobs_completed || 0,
        last_heartbeat: activeNode.last_heartbeat || null,
      }
      : null,
    status_label: buildStatusLabel({
      hostContributing,
      networkOptIn,
      networkNodeActive,
      modelLabel,
      lmStudioActive,
    }),
  };
}

function buildStatusLabel({
  hostContributing,
  networkOptIn,
  networkNodeActive,
  modelLabel,
  lmStudioActive,
} = {}) {
  if (hostContributing) {
    const modelPart = modelLabel ? ` · ${modelLabel}` : '';
    if (networkOptIn || networkNodeActive) {
      return `host · LM Studio${modelPart} + network`;
    }
    return `host · LM Studio${modelPart}`;
  }
  if (networkNodeActive) return 'network node active';
  if (networkOptIn) return 'network opt-in';
  if (lmStudioActive) return 'LM Studio up (remote session)';
  return 'idle';
}

function mergeContributionIntoStatus(baseStatus, contribution) {
  if (!contribution) return baseStatus;
  return {
    ...baseStatus,
    contributing: contribution.contributing,
    contribution_source: contribution.contribution_source,
    is_host_node: contribution.is_host_node,
    is_host_operator: contribution.is_host_operator,
    host_lmstudio_active: contribution.host_lmstudio_active,
    network_opt_in: contribution.network_opt_in,
    opted_in: contribution.contributing,
    opt_in: contribution.contributing,
    lm_studio: contribution.lm_studio,
    active_node: contribution.active_node,
    status_label: contribution.status_label,
  };
}

module.exports = {
  isLocalOperatorRequest,
  isCeoPrincipalRequest,
  isCeoPrincipalIdentity,
  isHostOperatorSession,
  isHostOperatorIdentity,
  probeLmStudio,
  quickLmStudioSnapshot,
  getLmStudioSnapshot,
  getOnlineNodeForIdentity,
  markHostOperatorIfLocal,
  resolveContributionState,
  mergeContributionIntoStatus,
  buildStatusLabel,
  shortModelName,
};
