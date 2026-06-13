'use strict';

const denizenDb = require('./denizen-db.js');
const nodeProfiler = require('./denizen-node-profiler.js');
const hostCompute = require('./denizen-host-compute.js');
const desktopLink = require('./denizen-desktop-link.js');
const fleetRegistry = require('./denizen-fleet-registry.js');
const hardwareMonitor = require('./denizen-hardware-monitor.js');
const computeCredits = require('./denizen-compute-credits.js');
const contributionTracker = require('./denizen-contribution-tracker.js');

function safeRequire(modulePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (_) {
    return null;
  }
}

const PROFILE_TABLE = 'denizen_node_profiles';

function isEnabled() {
  return Boolean(denizenDb?.enabled);
}

function hardwareFromBody(hw = {}) {
  const deviceMemoryGb = Number(hw.device_memory_gb ?? hw.deviceMemoryGb);
  return {
    cpuCores: hw.hardware_concurrency ?? hw.cpu_cores ?? hw.cpuCores ?? null,
    ramMb: Number.isFinite(deviceMemoryGb) ? Math.round(deviceMemoryGb * 1024) : (hw.ram_mb ?? hw.ramMb ?? null),
    vramMb: hw.vram_mb ?? hw.vramMb ?? null,
    gpu: hw.gpu_model ?? hw.gpu ?? null,
  };
}

async function getProfileByIdentity(identityId) {
  if (!isEnabled() || !identityId) return null;
  const rows = await denizenDb._getSoft(
    `${PROFILE_TABLE}?select=*&identity_id=eq.${encodeURIComponent(identityId)}&limit=1`,
  );
  return rows?.[0] || null;
}

function normalizeContributionLevel(level) {
  const value = String(level || '').trim().toLowerCase();
  if (value === 'off' || value === 'light' || value === 'standard' || value === 'max') {
    return value;
  }
  return null;
}

async function upsertProfileForIdentity(identityId, {
  optIn = false,
  hardware = {},
  contributionLevel = null,
  idleOnly = null,
} = {}) {
  if (!isEnabled() || !identityId) return null;

  const hw = hardwareFromBody(hardware);
  const scored = nodeProfiler.scoreHardware(hw);
  const explicitLevel = normalizeContributionLevel(contributionLevel);
  const contribution = explicitLevel || nodeProfiler.suggestContributionLevel({
    ...hw,
    score: scored.score,
    tier: scored.tier,
    optIn: !!optIn,
    idleOnly: idleOnly !== false,
  });
  const now = new Date().toISOString();
  const existing = await getProfileByIdentity(identityId);

  const patch = {
    hardware_score: scored.score,
    tier: scored.tier,
    cpu_cores: hw.cpuCores || null,
    ram_mb: hw.ramMb || null,
    gpu_model: hw.gpu || null,
    vram_mb: hw.vramMb || null,
    opt_in: !!optIn,
    contribution_level: contribution,
    updated_at: now,
    metadata: {
      source: 'visitor_ui',
      hardware_report: hardware && typeof hardware === 'object' ? hardware : {},
    },
  };
  if (idleOnly !== null && idleOnly !== undefined) {
    patch.idle_only = !!idleOnly;
  }

  if (existing?.id) {
    const rows = await denizenDb._patch(
      `${PROFILE_TABLE}?id=eq.${encodeURIComponent(existing.id)}`,
      patch,
      { prefer: 'return=representation' },
    );
    return rows?.[0] || { ...existing, ...patch };
  }

  const rows = await denizenDb._post(
    PROFILE_TABLE,
    {
      identity_id: identityId,
      ...patch,
      created_at: now,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function buildContributionSummary(identity, profile, activeNode, ctx = {}) {
  const lmStudio = ctx.lmStudio || null;
  const req = ctx.req || null;
  const contribution = hostCompute.resolveContributionState({
    identity,
    profile,
    req,
    lmStudio,
    activeNode,
  });

  const desktopCaps = profile?.desktop_capabilities || {};
  const isHostOperator = hostCompute.isHostOperatorSession(req, identity);
  const lmStudioActive = !!lmStudio?.reachable;
  const networkOptIn = !!profile?.opt_in;
  const networkJobs = !!desktopCaps.network_jobs || networkOptIn || isHostOperator;
  let liveUsage = null;
  if (isHostOperator) {
    liveUsage = fleetRegistry.getGlobalHostSnapshot()
      || hardwareMonitor.getLatestSnapshot()
      || profile?.metadata?.live_usage
      || null;
  } else if (profile?.metadata?.live_usage) {
    liveUsage = profile.metadata.live_usage;
  } else if (identity?.id) {
    const ownFleet = fleetRegistry.listForIdentity(identity.id, {
      includeHost: false,
      includeAuxiliary: false,
    });
    liveUsage = ownFleet[0] || null;
  }

  const serverMachine = isHostOperator ? desktopLink.collectServerMachineSnapshot({
    gpu_model: liveUsage?.gpu?.model || lmStudio?.model || profile?.gpu_model || null,
    vram_mb: liveUsage?.gpu?.vram_total_mb ?? profile?.vram_mb ?? null,
  }) : null;
  const liveHardwareScore = liveUsage
    ? nodeProfiler.scoreHardware({
      cpuCores: liveUsage.cpu_cores ?? null,
      ramMb: liveUsage.ram?.total_mb ?? null,
      vramMb: liveUsage.gpu?.vram_total_mb ?? null,
      gpu: liveUsage.gpu?.model ?? null,
    }).score
    : 0;
  const hardwareScore = Math.max(
    Number(profile?.hardware_score) || 0,
    Number(serverMachine?.hardware_score) || 0,
    liveHardwareScore,
  );
  const profileLevel = profile?.contribution_level;
  const contributionLevel = profileLevel && profileLevel !== 'off'
    ? profileLevel
    : (isHostOperator && contribution.host_lmstudio_active ? 'max' : 'off');
  const desktopLinked = !!(
    profile?.client_type === 'desktop'
    && profile?.setup_wizard_completed
  );
  const nodeActive = !!activeNode?.id;

  const contributionModes = [
    {
      mode: 'host_lmstudio',
      label: 'Host LM Studio',
      available: isHostOperator,
      active: !!contribution.host_lmstudio_active,
      model: isHostOperator ? (lmStudio?.model || null) : null,
    },
    {
      mode: 'desktop_compute',
      label: 'Desktop compute node',
      available: desktopLinked || isHostOperator,
      enabled: networkJobs,
      active: (networkOptIn && nodeActive) || (isHostOperator && nodeActive),
    },
    {
      mode: 'embeddings',
      label: 'Embedding index jobs',
      job_type: 'embedding_index',
      available: networkJobs && hardwareScore >= 24,
      active: networkOptIn && nodeActive,
    },
    {
      mode: 'sim_tick',
      label: 'Simulation tick jobs',
      job_type: 'sim_tick',
      available: networkJobs,
      active: networkOptIn && nodeActive,
    },
    {
      mode: 'agent_tasks',
      label: 'Agent think batches',
      job_type: 'npc_think_batch',
      available: networkJobs && hardwareScore >= 24,
      active: networkOptIn && nodeActive,
    },
  ];

  let creditsLedger = [];
  const creditsApi = ctx.creditsApi
    || safeRequire('./denizen-credits.js')
    || safeRequire('./denizen-credits');
  if (creditsApi?.listLedger && identity?.id) {
    try {
      creditsLedger = await creditsApi.listLedger(identity.id, 10);
    } catch (_) {
      creditsLedger = [];
    }
  }

  const jobsCompleted = Number(activeNode?.jobs_completed) || 0;

  const fleetSummary = identity?.id
    ? fleetRegistry.buildFleetSummary(identity.id, liveUsage, { isOperator: isHostOperator })
    : { fleet: [], live_usage: null, totals: { machines: 0 } };

  const live = fleetSummary.live_usage || liveUsage;
  const cpuCores = profile?.cpu_cores ?? serverMachine?.cpu_cores ?? live?.cpu_cores ?? null;
  const ramTotalMb = profile?.ram_mb ?? serverMachine?.ram_mb ?? live?.ram?.total_mb ?? null;
  const gpuModel = profile?.gpu_model
    ?? serverMachine?.gpu_model
    ?? live?.gpu?.model
    ?? lmStudio?.model
    ?? null;

  return {
    jobs_completed: jobsCompleted,
    hardware_score: hardwareScore,
    contribution_level: contributionLevel,
    cpu_cores: cpuCores,
    ram_mb: ramTotalMb,
    gpu_model: gpuModel,
    vram_mb: profile?.vram_mb ?? live?.gpu?.vram_total_mb ?? null,
    host_operator: isHostOperator,
    contribution_source: contribution.contribution_source || null,
    host_lmstudio_active: !!contribution.host_lmstudio_active,
    server_hostname: isHostOperator ? (serverMachine?.hostname || live?.hostname || null) : null,
    server_platform: isHostOperator ? (serverMachine?.platform || live?.platform || null) : null,
    live_usage: live,
    fleet: fleetSummary.fleet,
    fleet_totals: fleetSummary.totals,
    cpu_percent: live?.cpu_percent ?? null,
    ram_used_mb: live?.ram?.used_mb ?? null,
    ram_used_percent: live?.ram?.used_percent ?? null,
    gpu_utilization_percent: live?.gpu?.utilization_percent ?? null,
    gpu_vram_used_mb: live?.gpu?.vram_used_mb ?? null,
    gpu_vram_used_percent: live?.gpu?.vram_used_percent ?? null,
    contribution_modes: contributionModes,
    active_node: activeNode
      ? {
        id: activeNode.id,
        status: activeNode.status,
        jobs_completed: activeNode.jobs_completed || 0,
        last_heartbeat: activeNode.last_heartbeat || null,
      }
      : null,
    credits_ledger: creditsLedger,
    credits_economy: identity?.id ? contributionTracker.getEconomySummary(identity.id) : null,
    estimated_job_credits: computeCredits.computeJobCredits({
      jobType: 'npc_think_batch',
      hardwareScore,
      contributionLevel,
    }),
    estimated_uptime_credits: computeCredits.computeUptimeCredits({
      hardwareScore,
      contributionLevel,
      windowSeconds: 900,
      cpuPercentAvg: live?.cpu_percent ?? 0,
      gpuUtilAvg: live?.gpu?.utilization_percent ?? 0,
      contributing: !!contribution.contributing,
    }),
  };
}

function buildStatusPayload(identity, profile) {
  const tier = profile?.tier || identity?.tier || 'player';
  const credits = Number(identity?.credits_balance) || 0;
  return {
    ok: true,
    credits_balance: credits,
    credits,
    node_tier: tier,
    tier,
    is_super_node: tier === 'super_node',
    super_node: tier === 'super_node',
    opted_in: !!profile?.opt_in,
    opt_in: !!profile?.opt_in,
    hardware_score: profile?.hardware_score ?? 0,
    contribution_level: profile?.contribution_level || 'off',
    profile: profile || null,
  };
}

async function getStatusForIdentity(identity, ctx = {}) {
  if (!identity?.id) return null;

  let profile = null;
  try {
    profile = await getProfileByIdentity(identity.id);
  } catch (_) {
    profile = null;
  }

  const lmStudio = ctx.lmStudio || null;
  let activeNode = ctx.activeNode;
  if (activeNode === undefined) {
    try {
      activeNode = await hostCompute.getOnlineNodeForIdentity(identity.id);
    } catch (_) {
      activeNode = null;
    }
  }

  const contribution = hostCompute.resolveContributionState({
    identity,
    profile,
    req: ctx.req || null,
    lmStudio,
    activeNode,
  });

  const allowHostAutoSync = ctx.allowHostAutoSync !== false;
  if (allowHostAutoSync && contribution.host_lmstudio_active && !profile?.opt_in) {
    try {
      profile = await upsertProfileForIdentity(identity.id, {
        optIn: true,
        hardware: {
          gpu_model: lmStudio?.model || 'LM Studio',
          source: 'host_lmstudio',
          host_auto: true,
        },
      });
      contribution.network_opt_in = true;
      contribution.contributing = true;
      if (contribution.contribution_source === 'host_lmstudio') {
        contribution.status_label = hostCompute.buildStatusLabel({
          hostContributing: true,
          networkOptIn: true,
          networkNodeActive: !!activeNode?.id,
          modelLabel: hostCompute.shortModelName(lmStudio?.model),
          lmStudioActive: true,
        });
      }
    } catch (_) {}
  }

  const sessionTier = ctx.sessionTier || null;
  const clientState = desktopLink.resolveContributorState({
    identity,
    profile,
    req: ctx.req || null,
    hostContribution: contribution,
  });

  const base = buildStatusPayload(identity, profile);
  if (sessionTier && (!base.tier || base.tier === 'player' || base.tier === 'visitor')) {
    base.tier = sessionTier;
    base.node_tier = profile?.tier || sessionTier;
  }
  const merged = hostCompute.mergeContributionIntoStatus(base, contribution);
  let contributionSummary = null;
  try {
    contributionSummary = await buildContributionSummary(identity, profile, activeNode, ctx);
  } catch (_) {
    contributionSummary = null;
  }
  return {
    ...merged,
    ...clientState,
    opted_in: clientState.can_contribute ? merged.opted_in : false,
    opt_in: clientState.can_contribute ? merged.opt_in : false,
    contributing: clientState.contributing,
    status_label: clientState.status_label || merged.status_label,
    contribution_summary: contributionSummary,
  };
}

function buildSessionHostStatus({ sessionTier = 'team', lmStudio = null, req = null } = {}) {
  const hostMeta = hostCompute.isHostOperatorSession(req, null)
    ? { is_host_operator: true, is_ceo_principal: hostCompute.isCeoPrincipalRequest(req) }
    : {};
  const contribution = hostCompute.resolveContributionState({
    identity: { metadata: hostMeta },
    profile: null,
    req,
    lmStudio,
    activeNode: null,
  });
  const clientState = desktopLink.resolveContributorState({
    identity: null,
    profile: null,
    req,
    hostContribution: contribution,
  });
  const base = {
    ok: true,
    credits_balance: 0,
    credits: 0,
    tier: sessionTier,
    node_tier: contribution.host_lmstudio_active ? 'contributor' : sessionTier,
    opted_in: clientState.can_contribute,
    opt_in: clientState.can_contribute,
    hardware_score: 0,
    contribution_level: clientState.can_contribute ? 'standard' : 'off',
    profile: null,
    identity_pending: true,
  };
  return {
    ...hostCompute.mergeContributionIntoStatus(base, contribution),
    ...clientState,
    contributing: clientState.contributing,
    status_label: clientState.status_label,
  };
}

module.exports = {
  hardwareFromBody,
  getProfileByIdentity,
  upsertProfileForIdentity,
  buildStatusPayload,
  buildContributionSummary,
  getStatusForIdentity,
  buildSessionHostStatus,
};
