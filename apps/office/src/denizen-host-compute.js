'use strict';

const denizenDb = require('./denizen-db.js');
const sessionAuth = require('./visitor-session-auth.js');

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

function hasForwardingHeaders(req) {
  return !!(readHeader(req, 'x-forwarded-for')
    || readHeader(req, 'cf-connecting-ip')
    || readHeader(req, 'x-real-ip')
    || readHeader(req, 'forwarded'));
}

function isLocalOperatorRequest(req) {
  if (!req) return false;
  // Loopback only counts when the request did NOT arrive through a tunnel or
  // reverse proxy: cloudflared/ngrok connect from 127.0.0.1 but stamp
  // forwarding headers, so remote visitors must never qualify as "local".
  // Client-supplied flags (X-Denizen-Local-Client) are deliberately ignored.
  return isLoopbackAddress(req.socket?.remoteAddress) && !hasForwardingHeaders(req);
}

function isCeoPrincipalRequest(req) {
  if (!req) return false;
  // Requires the signed CEO grant issued at CEO-code login — a bare
  // "X-Ceo-Principal: 1" assertion no longer grants anything.
  const grant = String(readHeader(req, 'x-denizen-ceo-grant') || '').trim();
  return !!(grant && sessionAuth.verifyCeoGrant(grant));
}

function isCeoPrincipalIdentity(identity) {
  const meta = parseMetadata(identity?.metadata);
  return !!(meta.is_ceo_principal || meta.ceo_principal);
}

function isHostOperatorSession(req, identity = null) {
  // Loopback alone must NOT grant host scope — guests testing from the same
  // machine (e.g. dog@gmail.com on localhost:8081) would otherwise inherit the
  // owner's LM Studio stats, fleet, and private NAS/Supabase endpoints.
  return isHostOperatorIdentity(identity)
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
  let lmStudioRouter = null;
  try { lmStudioRouter = require('./lm-studio-router'); } catch (_) {}
  const queueDepth = npcBrains?.getQueueDepth?.() || 0;
  if (lmStudioRouter?.isEnabled?.()) {
    await lmStudioRouter.refreshAll().catch(() => null);
    const pick = lmStudioRouter.selectEndpoint({ tier: 'main', queueDepth });
    const lmCfg = npcBrains?.providers?.lmstudio || {};
    const poolReachable = lmStudioRouter.anyReachable();
    if (poolReachable && pick?.url) {
      const node = lmStudioRouter.listNodes().find((n) => n.node_id === pick.node_id) || {};
      return {
        reachable: true,
        url: pick.url,
        model: node.main_model || lmCfg.model || process.env.LM_STUDIO_MODEL || null,
        fastModel: node.fast_model
          || npcBrains?.providers?.['lmstudio-fast']?.model
          || process.env.LM_STUDIO_FAST_MODEL
          || null,
        livenessSource: pick.routed ? `router → ${pick.label || pick.node_id}` : 'router pool',
        router: pick,
        remote_only: lmStudioRouter.isRemoteOnlyMode?.() || false,
        error: null,
      };
    }
    if (pick?.url && pick.routed) {
      const { probeLmStudioEndpoint } = require('./lm-studio-probe');
      const direct = await probeLmStudioEndpoint(pick.url, {
        apiKey: process.env.LM_STUDIO_API_KEY,
      }).catch(() => null);
      if (direct?.reachable) {
        return {
          reachable: true,
          url: pick.url,
          model: direct.main_model || lmCfg.model || process.env.LM_STUDIO_MODEL || null,
          fastModel: npcBrains?.providers?.['lmstudio-fast']?.model
            || process.env.LM_STUDIO_FAST_MODEL
            || null,
          livenessSource: `probe ${pick.label || pick.node_id}`,
          router: pick,
          remote_only: lmStudioRouter.isRemoteOnlyMode?.() || false,
          error: null,
        };
      }
    }
  }

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
  let lmStudioRouter = null;
  try { lmStudioRouter = require('./lm-studio-router'); } catch (_) {}
  const routerStatus = lmStudioRouter?.isEnabled?.()
    ? lmStudioRouter.buildStatus(npcBrains?.getQueueDepth?.() || 0)
    : null;
  const pick = routerStatus?.selected;
  const poolUp = !!routerStatus?.any_reachable;
  return {
    reachable: poolUp,
    probe_skipped: !poolUp,
    url: pick?.url || lmCfg.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234',
    model: lmCfg.model || process.env.LM_STUDIO_MODEL || null,
    fastModel: npcBrains?.providers?.['lmstudio-fast']?.model || null,
    livenessSource: poolUp ? (pick?.routed ? `router → ${pick.label || pick.node_id}` : 'router pool') : null,
    error: poolUp ? null : 'LM Studio pool unreachable',
    router: pick || null,
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

function isCeoIdentityEmail(identity) {
  const email = String(identity?.email_normalized || identity?.email || '').trim().toLowerCase();
  if (!email) return false;
  const envEmail = String(process.env.DENIZEN_CEO_IDENTITY_EMAIL || '').trim().toLowerCase();
  if (envEmail && email === envEmail) return true;
  return /^ceo@[^@]+\.denizen\.local$/.test(email);
}

async function markHostOperatorIfLocal(identityId, req, identity = null) {
  // Persisting the host flag is reserved for the CEO's OWN identity row.
  // Locality and even a valid CEO grant on the request are request-scoped —
  // they must never brand a teammate/guest identity as the host (e.g. the
  // CEO testing a second account from the host machine or with a leftover
  // grant in the same browser).
  if (!identityId || !isHostOperatorSession(req, identity)) return null;
  if (!isEnabled()) return identity || null;
  const rows = await denizenDb._get(
    `${IDENTITY_TABLE}?select=id,email,email_normalized,metadata&limit=1&id=eq.${encodeURIComponent(identityId)}`,
  );
  const existing = rows?.[0];
  if (!existing?.id) return identity || null;

  const meta = parseMetadata(existing.metadata);
  if (meta.is_host_operator) return existing;
  if (!meta.is_ceo_principal && !isCeoIdentityEmail(existing)) return existing;

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

  const inference = lmStudio
    ? {
      backend: lmStudio.backend || 'lmstudio',
      main_model: lmStudio.model || null,
      reachable_local: lmStudioActive,
      rpc_capable: lmStudioActive,
      inference_mode: lmStudioActive ? 'direct' : (lmStudio.reachable ? 'direct' : null),
    }
    : null;

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
        rpc_capable: lmStudioActive,
      }
      : null,
    inference,
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
    inference: contribution.inference || null,
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
