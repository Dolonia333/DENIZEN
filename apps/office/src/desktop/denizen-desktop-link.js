'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const denizenDb = require('../intelligence/denizen-db');
const nodeProfiler = require('../integrations/denizen-node-profiler');

const PROFILE_TABLE = 'denizen_node_profiles';
const NODE_TABLE = 'denizen_compute_nodes';
/** Fallback when node profile tables are not migrated yet. */
const memoryProfilesByIdentity = new Map();

function getMemoryProfile(identityId) {
  return memoryProfilesByIdentity.get(String(identityId)) || null;
}

function saveMemoryProfile(identityId, profile) {
  const id = String(identityId);
  const next = { ...profile, identity_id: id, id: profile.id || crypto.randomUUID() };
  memoryProfilesByIdentity.set(id, next);
  return next;
}


const VALID_CLIENT_TYPES = new Set(['browser', 'desktop', 'host']);
const VALID_PERMISSIONS = new Set(['off', 'ask', 'trusted']);

function isEnabled() {
  return Boolean(denizenDb?.enabled);
}

function readHeader(req, name) {
  const headers = req?.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) return value;
  }
  return '';
}

function detectClientType(req) {
  const raw = String(
    readHeader(req, 'x-denizen-client')
    || readHeader(req, 'x-denizen-client-type')
    || '',
  ).trim().toLowerCase();
  if (raw === 'desktop' || raw === 'electron') return 'desktop';
  if (raw === 'host') return 'host';
  return 'browser';
}

function normalizePermission(level) {
  const value = String(level || 'off').trim().toLowerCase();
  return VALID_PERMISSIONS.has(value) ? value : 'off';
}

function collectServerMachineSnapshot(extra = {}) {
  const cpus = os.cpus() || [];
  const ramMb = Math.round((os.totalmem() || 0) / (1024 * 1024));
  const scored = nodeProfiler.scoreHardware({
    cpuCores: cpus.length || null,
    ramMb,
    gpu: extra.gpu_model || extra.gpu || null,
    vramMb: extra.vram_mb || extra.vramMb || null,
  });
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    cpu_cores: cpus.length || null,
    ram_mb: ramMb,
    hardware_score: scored.score,
    tier: scored.tier,
    capabilities: {
      read_files: false,
      write_files: false,
      run_code: false,
      contribute_compute: false,
      lm_studio: false,
      ...(extra.capabilities && typeof extra.capabilities === 'object' ? extra.capabilities : {}),
    },
  };
}

function mergeDesktopCapabilities(base = {}, incoming = {}) {
  const caps = { ...base, ...incoming };
  return {
    read_files: !!caps.read_files,
    write_files: !!caps.write_files,
    run_code: !!caps.run_code,
    screen_access: !!caps.screen_access,
    contribute_compute: !!caps.contribute_compute,
    lm_studio: !!caps.lm_studio,
    shell_access: !!caps.shell_access,
    network_jobs: !!caps.network_jobs,
  };
}

function resolveContributorState({
  identity = null,
  profile = null,
  req = null,
  hostContribution = null,
} = {}) {
  const clientType = detectClientType(req);
  const hostActive = !!hostContribution?.host_lmstudio_active;
  const isHostOperator = !!hostContribution?.is_host_operator;
  const isHostClient = clientType === 'host' || !!hostContribution?.is_host_node || isHostOperator;

  const desktopLinked = !!(
    profile?.desktop_linked_at
    && profile?.client_type === 'desktop'
    && profile?.setup_wizard_completed
  );
  const desktopPending = !!(
    profile?.client_type === 'desktop'
    && !profile?.setup_wizard_completed
  );
  const desktopCapabilities = profile?.desktop_capabilities || {};
  const networkOptIn = !!profile?.opt_in;

  let contributorState = 'browser_only';
  let canContribute = false;
  let needsDesktopDownload = true;
  let statusLabel = 'browser only — install Denizen to contribute';

  if (isHostClient && hostActive) {
    contributorState = 'host';
    canContribute = true;
    needsDesktopDownload = false;
    statusLabel = hostContribution?.status_label || 'host · LM Studio';
  } else if (isHostOperator) {
    contributorState = 'host';
    canContribute = true;
    needsDesktopDownload = false;
    statusLabel = hostContribution?.status_label
      || (hostActive ? 'host · LM Studio' : 'host · start LM Studio to contribute');
  } else if (desktopLinked) {
    contributorState = 'desktop_linked';
    canContribute = !!profile?.opt_in || !!desktopCapabilities.contribute_compute;
    needsDesktopDownload = false;
    const score = profile?.hardware_score || 0;
    statusLabel = canContribute
      ? `desktop node · score ${score}`
      : 'desktop linked — enable compute in settings';
  } else if (desktopPending) {
    contributorState = 'desktop_setup_pending';
    canContribute = false;
    needsDesktopDownload = false;
    statusLabel = 'finish Denizen setup wizard';
  } else if (clientType === 'desktop') {
    contributorState = 'needs_desktop_setup';
    canContribute = false;
    needsDesktopDownload = false;
    statusLabel = 'complete Denizen setup';
  } else {
    contributorState = 'browser_only';
    canContribute = false;
    needsDesktopDownload = true;
    statusLabel = 'download Denizen app to contribute';
  }

  return {
    contributor_state: contributorState,
    client_type: profile?.client_type || clientType,
    can_contribute: canContribute,
    needs_desktop_download: needsDesktopDownload,
    desktop_linked: desktopLinked,
    desktop_setup_pending: desktopPending,
    setup_wizard_completed: !!profile?.setup_wizard_completed,
    agent_permission_level: profile?.agent_permission_level || 'off',
    desktop_capabilities: desktopCapabilities,
    machine_score: profile?.hardware_score || 0,
    status_label: statusLabel,
    download_url: '/desktop/download.html',
    contributing: hostActive
      || (desktopLinked && (!!profile?.opt_in || !!desktopCapabilities.contribute_compute))
      || (networkOptIn && !!hostContribution?.active_node?.id),
  };
}

async function getProfileByIdentity(identityId) {
  if (!identityId) return null;
  const cached = getMemoryProfile(identityId);
  if (cached) return cached;
  if (!isEnabled()) return null;
  const rows = await denizenDb._getSoft(
    `${PROFILE_TABLE}?select=*&identity_id=eq.${encodeURIComponent(identityId)}&limit=1`,
  );
  const row = rows?.[0] || null;
  if (row?.id) saveMemoryProfile(identityId, row);
  return row;
}
async function ensureProfile(identityId) {
  const existing = await getProfileByIdentity(identityId);
  if (existing?.id) return existing;
  const now = new Date().toISOString();
  const seed = {
    identity_id: identityId,
    client_type: 'browser',
    hardware_score: 0,
    tier: 'player',
    opt_in: false,
    contribution_level: 'off',
    setup_wizard_completed: false,
    agent_permission_level: 'off',
    desktop_capabilities: {},
    created_at: now,
    updated_at: now,
  };
  if (!isEnabled()) return saveMemoryProfile(identityId, seed);
  let rows = null;
  try {
    rows = await denizenDb._postSoft(PROFILE_TABLE, seed, { prefer: 'return=representation' });
  } catch (_) {
    rows = null;
  }
  if (rows?.[0]?.id) return saveMemoryProfile(identityId, rows[0]);
  return saveMemoryProfile(identityId, seed);
}
async function registerDesktopInstall(identityId, payload = {}) {
  if (!isEnabled() || !identityId) return null;

  const profile = await ensureProfile(identityId);
  if (!profile?.id) return null;

  const machine = payload.machine && typeof payload.machine === 'object'
    ? payload.machine
    : collectServerMachineSnapshot(payload);
  const scored = nodeProfiler.scoreHardware({
    cpuCores: machine.cpu_cores,
    ramMb: machine.ram_mb,
    gpu: machine.gpu_model,
    vramMb: machine.vram_mb,
  });
  const installId = String(payload.desktop_install_id || payload.installId || '').trim()
    || crypto.randomUUID();
  const now = new Date().toISOString();
  const permission = normalizePermission(payload.agent_permission_level || payload.permission);

  const explicitCaps = payload.desktop_capabilities
    || payload.capabilities
    || (machine.capabilities && typeof machine.capabilities === 'object' ? machine.capabilities : null);
  const capabilities = mergeDesktopCapabilities(profile.desktop_capabilities, {
    contribute_compute: !!payload.opt_in,
    lm_studio: !!payload.lm_studio_detected,
    network_jobs: !!payload.opt_in,
    ...(explicitCaps || {}),
  });

  const patch = {
    client_type: 'desktop',
    desktop_install_id: installId,
    desktop_linked_at: now,
    setup_wizard_completed: !!payload.setup_wizard_completed,
    agent_permission_level: permission,
    desktop_capabilities: capabilities,
    home_server_url: payload.home_server_url || payload.server_url || null,
    last_capability_sync_at: now,
    hardware_score: scored.score,
    tier: scored.tier,
    cpu_cores: machine.cpu_cores || null,
    ram_mb: machine.ram_mb || null,
    gpu_model: machine.gpu_model || null,
    vram_mb: machine.vram_mb || null,
    opt_in: !!payload.opt_in,
    contribution_level: nodeProfiler.suggestContributionLevel({
      score: scored.score,
      tier: scored.tier,
      optIn: !!payload.opt_in,
    }),
    metadata: {
      ...(profile.metadata && typeof profile.metadata === 'object' ? profile.metadata : {}),
      desktop_hostname: machine.hostname || null,
      desktop_platform: machine.platform || null,
      last_register_source: 'desktop_app',
    },
    updated_at: now,
  };

  const merged = { ...profile, ...patch };
  saveMemoryProfile(identityId, merged);
  if (!isEnabled()) return merged;
  try {
    const rows = await denizenDb._patchSoft(
      `${PROFILE_TABLE}?id=eq.${encodeURIComponent(profile.id)}`,
      patch,
      { prefer: 'return=representation' },
    );
    if (rows?.[0]) return saveMemoryProfile(identityId, rows[0]);
  } catch (_) {}
  return merged;
}

async function completeSetupWizard(identityId, payload = {}) {
  return registerDesktopInstall(identityId, {
    ...payload,
    setup_wizard_completed: true,
  });
}

async function getAnyNodeForIdentity(identityId) {
  if (!identityId) return null;
  let nodeWorker = null;
  try {
    // eslint-disable-next-line global-require
    nodeWorker = require('../integrations/denizen-node-worker');
  } catch (_) {
    nodeWorker = null;
  }
  if (nodeWorker?.getNodeForIdentity) {
    return nodeWorker.getNodeForIdentity(identityId);
  }
  if (!isEnabled()) return null;
  const rows = await denizenDb._getSoft(
    `${NODE_TABLE}?select=id,status,last_heartbeat,jobs_completed&identity_id=eq.${encodeURIComponent(identityId)}&order=last_heartbeat.desc&limit=1`,
  );
  return rows?.[0] || null;
}

async function syncDesktopCapabilities(identityId, payload = {}) {
  if (!identityId) return null;
  const profile = await getProfileByIdentity(identityId);
  if (!profile?.id || profile.client_type !== 'desktop') return null;

  const machine = payload.machine && typeof payload.machine === 'object'
    ? payload.machine
    : collectServerMachineSnapshot(payload);
  const scored = nodeProfiler.scoreHardware({
    cpuCores: machine.cpu_cores,
    ramMb: machine.ram_mb,
    gpu: machine.gpu_model,
    vramMb: machine.vram_mb,
  });
  const permission = normalizePermission(
    payload.agent_permission_level || payload.permission || profile.agent_permission_level,
  );
  const optIn = payload.opt_in ?? payload.optIn ?? profile.opt_in;
  const now = new Date().toISOString();
  const incomingCaps = payload.desktop_capabilities
    || payload.capabilities
    || (machine.capabilities && typeof machine.capabilities === 'object' ? machine.capabilities : {});
  const capabilities = mergeDesktopCapabilities(profile.desktop_capabilities, {
    contribute_compute: !!optIn,
    lm_studio: !!payload.lm_studio_detected,
    network_jobs: !!optIn,
    ...incomingCaps,
  });

  const liveMetrics = payload.live_metrics || payload.liveMetrics || machine.live_metrics || null;
  const metadataPatch = {
    ...(profile.metadata && typeof profile.metadata === 'object' ? profile.metadata : {}),
    last_live_metrics_at: liveMetrics?.sampled_at || now,
  };
  if (liveMetrics) metadataPatch.live_usage = liveMetrics;

  const syncPatch = {
    hardware_score: scored.score,
    tier: scored.tier,
    cpu_cores: machine.cpu_cores || null,
    ram_mb: machine.ram_mb || null,
    gpu_model: machine.gpu_model || liveMetrics?.gpu?.model || null,
    vram_mb: machine.vram_mb || liveMetrics?.gpu?.vram_total_mb || null,
    desktop_capabilities: capabilities,
    agent_permission_level: permission,
    opt_in: !!optIn,
    contribution_level: nodeProfiler.suggestContributionLevel({
      score: scored.score,
      tier: scored.tier,
      optIn: !!optIn,
    }),
    metadata: metadataPatch,
    last_capability_sync_at: now,
    updated_at: now,
  };
  const merged = saveMemoryProfile(identityId, { ...profile, ...syncPatch });
  if (isEnabled()) {
    try {
      const rows = await denizenDb._patchSoft(
        `${PROFILE_TABLE}?id=eq.${encodeURIComponent(profile.id)}`,
        syncPatch,
        { prefer: 'return=representation' },
      );
      if (rows?.[0]) saveMemoryProfile(identityId, rows[0]);
    } catch (_) {}
  }

  let node = null;
  if (!!optIn && capabilities.network_jobs) {
    let nodeWorker = null;
    try {
      // eslint-disable-next-line global-require
      nodeWorker = require('../integrations/denizen-node-worker');
    } catch (_) {
      nodeWorker = null;
    }
    if (nodeWorker?.registerNode) {
      try {
        const existingNode = await getAnyNodeForIdentity(identityId);
        if (!existingNode?.id) {
          const registered = await nodeWorker.registerNode({
            identityId,
            nodeProfileId: merged.id || profile.id,
          });
          if (registered?.id && registered?.endpoint_token) {
            node = {
              id: registered.id,
              endpoint_token: registered.endpoint_token,
            };
          }
        }
      } catch (_) {}
    }
  }

  return { profile: merged, node };
}

module.exports = {
  detectClientType,
  collectServerMachineSnapshot,
  resolveContributorState,
  registerDesktopInstall,
  completeSetupWizard,
  syncDesktopCapabilities,
  getProfileByIdentity,
  ensureProfile,
};
