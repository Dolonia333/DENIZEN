'use strict';

const denizenDb = require('./denizen-db.js');

const JOB_TABLE = 'denizen_compute_jobs';

const JOB_MIN_HARDWARE_SCORE = {
  embedding_index: 24,
  npc_think_batch: 16,
  inference_rpc: 12,
  sim_tick: 8,
  web_search: 0,
  grok_telemetry_check: 0,  // Python analysis + MCP, no heavy GPU needed
};

const LIGHT_NODE_BLOCKED_TYPES = new Set(['embedding_index']);

function buildEffectiveNodeProfile(profile, live = null) {
  if (!live || typeof live !== 'object') return profile || null;
  const nodeProfiler = require('./denizen-node-profiler.js');
  const gpu = live.gpu && typeof live.gpu === 'object' ? live.gpu : {};
  const scored = nodeProfiler.scoreHardware({
    gpu: gpu.model || profile?.gpu_model,
    vramMb: gpu.vram_total_mb ?? profile?.vram_mb,
    ramMb: live.ram?.total_mb ?? profile?.ram_mb,
    cpuCores: live.cpu_cores ?? profile?.cpu_cores,
  });
  const hardwareScore = Math.max(Number(profile?.hardware_score) || 0, scored.score);
  let contributionLevel = String(profile?.contribution_level || 'standard').toLowerCase();
  if (contributionLevel === 'light' && hardwareScore >= 40 && live.contributing !== false) {
    contributionLevel = 'standard';
  }
  if (contributionLevel === 'off' && live.contributing && hardwareScore >= 16) {
    contributionLevel = 'standard';
  }
  if (!profile) {
    return { hardware_score: hardwareScore, contribution_level: contributionLevel };
  }
  return { ...profile, hardware_score: hardwareScore, contribution_level: contributionLevel };
}

function nodeCanRunJob(nodeProfile, job) {
  if (!job) return false;
  if (!nodeProfile) return true;
  const level = String(nodeProfile.contribution_level || 'standard').toLowerCase();
  if (level === 'off') return false;
  const jobType = String(job.job_type || '').trim();
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const minScore = Number(
    payload.required_hardware_score ?? JOB_MIN_HARDWARE_SCORE[jobType] ?? 0,
  );
  const nodeScore = Number(nodeProfile.hardware_score) || 0;
  if (nodeScore < minScore) return false;
  if (level === 'light' && LIGHT_NODE_BLOCKED_TYPES.has(jobType)) return false;
  return true;
}

function isEnabled() {
  return Boolean(denizenDb?.enabled);
}

function toSafePriority(priority) {
  const n = Number(priority);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function enqueueJob({ jobType, payload = {}, priority = 50 } = {}) {
  if (!isEnabled()) return null;
  const normalizedJobType = String(jobType || '').trim();
  if (!normalizedJobType) {
    throw new Error('jobType is required');
  }

  const rows = await denizenDb._post(
    JOB_TABLE,
    {
      job_type: normalizedJobType,
      payload: payload && typeof payload === 'object' ? payload : {},
      priority: toSafePriority(priority),
      status: 'queued',
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

function jobMatchesNode(job, nodeId, nodeProfile = null, opts = {}) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const target = payload.target_machine_id
    || payload.target_node_id
    || payload.targetMachineId
    || null;
  if (!target) return true;

  const machineId = String(
    opts.machineId
    || nodeProfile?.machine_id
    || nodeProfile?.machineId
    || '',
  ).trim();
  const node = String(nodeId || '').trim();
  const want = String(target).trim();
  if (!want) return true;
  if (machineId && want === machineId) return true;
  if (node && want === node) return true;
  return false;
}

async function claimJob(nodeId, nodeProfile = null, opts = {}) {
  return claimJobByTypes(nodeId, null, nodeProfile, opts);
}

/**
 * Claim the next queued job, optionally filtered by job_type list.
 * Server telemetry worker passes jobTypes=['grok_telemetry_check'].
 */
async function claimJobByTypes(nodeId, jobTypes = null, nodeProfile = null, opts = {}) {
  if (!isEnabled() || !nodeId) return null;
  const node = String(nodeId).trim();
  if (!node) return null;

  const typeSet = jobTypes == null
    ? null
    : new Set((Array.isArray(jobTypes) ? jobTypes : [jobTypes]).map((t) => String(t).trim()));

  let candidates = [];
  try {
    candidates = await denizenDb._get(
      `${JOB_TABLE}?select=id,job_type,payload,priority,created_at&status=eq.queued&order=priority.desc,created_at.asc&limit=25`,
    ) || [];
  } catch (_) {
    return null;
  }

  for (const job of candidates) {
    if (typeSet && !typeSet.has(String(job.job_type || '').trim())) continue;
    if (!opts.serverWorker && !jobMatchesNode(job, node, nodeProfile, opts)) continue;
    if (!opts.serverWorker && nodeProfile && !nodeCanRunJob(nodeProfile, job)) continue;
    const now = new Date().toISOString();
    let rows = null;
    try {
      rows = await denizenDb._patchSoft(
        `${JOB_TABLE}?id=eq.${encodeURIComponent(job.id)}&status=eq.queued`,
        {
          status: 'assigned',
          assigned_node_id: node,
          started_at: now,
        },
        { prefer: 'return=representation', timeoutMs: 8000 },
      );
    } catch (_) {
      continue;
    }
    if (rows?.[0]) return rows[0];
  }

  return null;
}

async function completeJob(jobId, nodeId, result) {
  if (!isEnabled()) return null;
  if (!jobId || !nodeId) throw new Error('jobId and nodeId are required');
  const now = new Date().toISOString();
  const rows = await denizenDb._patch(
    `${JOB_TABLE}?id=eq.${encodeURIComponent(jobId)}&assigned_node_id=eq.${encodeURIComponent(nodeId)}&status=eq.assigned`,
    {
      status: 'done',
      completed_at: now,
      result: result && typeof result === 'object' ? result : { value: result ?? null },
      error: null,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function failJob(jobId, nodeId, error) {
  if (!isEnabled()) return null;
  if (!jobId || !nodeId) throw new Error('jobId and nodeId are required');
  const now = new Date().toISOString();
  const errorText =
    error && typeof error === 'object'
      ? String(error.message || JSON.stringify(error))
      : String(error || 'Job failed');
  const rows = await denizenDb._patch(
    `${JOB_TABLE}?id=eq.${encodeURIComponent(jobId)}&assigned_node_id=eq.${encodeURIComponent(nodeId)}&status=eq.assigned`,
    {
      status: 'failed',
      completed_at: now,
      error: errorText,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function listPendingJobs(limit = 50) {
  if (!isEnabled()) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return denizenDb._get(
    `${JOB_TABLE}?select=id,job_type,payload,priority,status,created_at,assigned_node_id&status=eq.queued&order=priority.desc,created_at.asc&limit=${safeLimit}`,
  ).catch(() => []);
}

async function listAssignedJobs(limit = 20) {
  if (!isEnabled()) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return denizenDb._get(
    `${JOB_TABLE}?select=id,job_type,payload,priority,status,created_at,started_at,assigned_node_id&status=eq.assigned&order=started_at.desc&limit=${safeLimit}`,
  ).catch(() => []);
}

async function listRecentCompletedJobs(limit = 10) {
  if (!isEnabled()) return [];
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  return denizenDb._get(
    `${JOB_TABLE}?select=id,job_type,priority,status,assigned_node_id,completed_at&status=eq.done&order=completed_at.desc&limit=${safeLimit}`,
  ).catch(() => []);
}

async function getJobById(jobId) {
  if (!isEnabled() || !jobId) return null;
  const rows = await denizenDb._getSoft(
    `${JOB_TABLE}?select=*&id=eq.${encodeURIComponent(String(jobId))}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

function _sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

/**
 * Poll until a job reaches done/failed or timeout.
 */
async function waitForJob(jobId, opts = {}) {
  if (!isEnabled() || !jobId) return null;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 60_000);
  const pollMs = Math.max(100, Number(opts.pollMs) || 400);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await getJobById(jobId);
    if (!job) return null;
    if (job.status === 'done' || job.status === 'failed') return job;
    await _sleep(pollMs);
  }

  const finalJob = await getJobById(jobId);
  if (finalJob && (finalJob.status === 'done' || finalJob.status === 'failed')) {
    return finalJob;
  }
  return null;
}

/**
 * Reclaim jobs stuck in assigned state (worker died mid-job).
 */
async function reclaimStaleJobs(maxAgeMs = 30 * 60 * 1000) {
  if (!isEnabled()) return { reclaimed: 0, failed: 0 };
  const assigned = await listAssignedJobs(100);
  const cutoff = Date.now() - Math.max(60_000, Number(maxAgeMs) || 30 * 60 * 1000);
  let reclaimed = 0;
  let failed = 0;

  for (const job of assigned) {
    const started = job.started_at ? new Date(job.started_at).getTime() : 0;
    if (!started || started > cutoff) continue;
    try {
      const rows = await denizenDb._patch(
        `${JOB_TABLE}?id=eq.${encodeURIComponent(job.id)}&status=eq.assigned`,
        {
          status: 'queued',
          assigned_node_id: null,
          started_at: null,
          error: 'reclaimed: stale assignment',
        },
        { prefer: 'return=representation' },
      );
      if (rows?.[0]) reclaimed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  return { reclaimed, failed, checked: assigned.length };
}

function isProducerThinkBatch(job) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  return job?.job_type === 'npc_think_batch'
    && (payload.source === 'mesh_producer' || payload.economy_mode != null);
}

async function failQueuedJob(job, error) {
  try {
    const rows = await denizenDb._patch(
      `${JOB_TABLE}?id=eq.${encodeURIComponent(job.id)}&status=eq.queued`,
      {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error,
      },
      { prefer: 'return=representation' },
    );
    return !!rows?.[0];
  } catch (_) {
    return false;
  }
}

/**
 * Fail ancient queued smoke/sim/producer jobs so the queue can drain real work.
 */
async function expireOldQueuedJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!isEnabled()) return { expired: 0 };
  const pending = await listPendingJobs(200);
  const defaultCutoff = Date.now() - Math.max(3600_000, Number(maxAgeMs) || 24 * 60 * 60 * 1000);
  const producerCutoff = Date.now() - Math.max(
    30 * 60 * 1000,
    Number(process.env.DENIZEN_PRODUCER_JOB_MAX_AGE_MS) || 2 * 60 * 60 * 1000,
  );
  const simCutoff = Date.now() - Math.max(
    30 * 60 * 1000,
    Number(process.env.DENIZEN_SIM_TICK_MAX_AGE_MS) || 60 * 60 * 1000,
  );
  let expired = 0;

  for (const job of pending) {
    const created = job.created_at ? new Date(job.created_at).getTime() : 0;
    if (!created) continue;
    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
    const isSmoke = payload.smoke || payload.source === 'smoke-mesh-jobs-flow' || String(payload.source || '').startsWith('smoke-');
    const isProducer = isProducerThinkBatch(job);
    const cutoff = isProducer ? producerCutoff : (job.job_type === 'sim_tick' ? simCutoff : defaultCutoff);
    if (created > cutoff) continue;
    if (!isSmoke && job.job_type !== 'sim_tick' && !isProducer) continue;
    if (await failQueuedJob(job, 'expired: stale queued mesh job')) expired += 1;
  }
  return { expired, checked: pending.length };
}

/**
 * Trim deep queues by failing duplicate producer batches and excess sim ticks.
 */
async function trimExcessQueuedJobs({
  maxPending = Number(process.env.DENIZEN_MESH_MAX_PENDING) || 8,
  keepProducerBatches = Number(process.env.DENIZEN_MESH_KEEP_PRODUCER_BATCHES) || 2,
} = {}) {
  if (!isEnabled()) return { trimmed: 0, checked: 0 };
  const pending = await listPendingJobs(200);
  let trimmed = 0;

  const producerBatches = pending
    .filter(isProducerThinkBatch)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  for (const job of producerBatches.slice(keepProducerBatches)) {
    if (await failQueuedJob(job, 'trimmed: excess mesh_producer batch')) trimmed += 1;
  }

  const telemetryChecks = pending
    .filter((j) => j.job_type === 'grok_telemetry_check')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  for (const job of telemetryChecks.slice(1)) {
    if (await failQueuedJob(job, 'trimmed: duplicate grok_telemetry_check')) trimmed += 1;
  }

  const simTicks = pending
    .filter((j) => j.job_type === 'sim_tick')
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const keepSim = Math.max(0, maxPending - keepProducerBatches);
  for (const job of simTicks.slice(0, Math.max(0, simTicks.length - keepSim))) {
    if (await failQueuedJob(job, 'trimmed: excess sim_tick backlog')) trimmed += 1;
  }

  const remaining = await listPendingJobs(200);
  if (remaining.length > maxPending) {
    const overflow = remaining
      .filter((j) => j.job_type === 'sim_tick' || isProducerThinkBatch(j))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    for (const job of overflow.slice(0, remaining.length - maxPending)) {
      if (await failQueuedJob(job, 'trimmed: mesh queue over capacity')) trimmed += 1;
    }
  }

  return { trimmed, checked: pending.length, max_pending: maxPending };
}

module.exports = {
  buildEffectiveNodeProfile,
  enqueueJob,
  claimJob,
  claimJobByTypes,
  completeJob,
  failJob,
  getJobById,
  waitForJob,
  jobMatchesNode,
  listPendingJobs,
  listAssignedJobs,
  listRecentCompletedJobs,
  reclaimStaleJobs,
  expireOldQueuedJobs,
  trimExcessQueuedJobs,
  isProducerThinkBatch,
  nodeCanRunJob,
  JOB_MIN_HARDWARE_SCORE,
  JOB_TABLE,
};
