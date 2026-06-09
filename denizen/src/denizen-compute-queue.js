'use strict';

const denizenDb = require('./denizen-db.js');

const JOB_TABLE = 'denizen_compute_jobs';

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

async function claimJob(nodeId) {
  if (!isEnabled() || !nodeId) return null;
  const node = String(nodeId).trim();
  if (!node) return null;

  let candidates = [];
  try {
    candidates = await denizenDb._getSoft(
      `${JOB_TABLE}?select=id,job_type,payload,priority,created_at&status=eq.queued&order=priority.desc,created_at.asc&limit=25`,
    ) || [];
  } catch (_) {
    return null;
  }

  for (const job of candidates) {
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
        { prefer: 'return=representation' },
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

/**
 * Fail ancient queued smoke/sim jobs so the queue can drain real work.
 */
async function expireOldQueuedJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!isEnabled()) return { expired: 0 };
  const pending = await listPendingJobs(200);
  const cutoff = Date.now() - Math.max(3600_000, Number(maxAgeMs) || 24 * 60 * 60 * 1000);
  let expired = 0;

  for (const job of pending) {
    const created = job.created_at ? new Date(job.created_at).getTime() : 0;
    if (!created || created > cutoff) continue;
    const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
    const isSmoke = payload.smoke || payload.source === 'smoke-mesh-jobs-flow' || String(payload.source || '').startsWith('smoke-');
    if (!isSmoke && job.job_type !== 'sim_tick') continue;
    try {
      const rows = await denizenDb._patch(
        `${JOB_TABLE}?id=eq.${encodeURIComponent(job.id)}&status=eq.queued`,
        {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: 'expired: stale queued smoke job',
        },
        { prefer: 'return=representation' },
      );
      if (rows?.[0]) expired += 1;
    } catch (_) { /* skip */ }
  }
  return { expired, checked: pending.length };
}

module.exports = {
  enqueueJob,
  claimJob,
  completeJob,
  failJob,
  listPendingJobs,
  listAssignedJobs,
  listRecentCompletedJobs,
  reclaimStaleJobs,
  expireOldQueuedJobs,
  JOB_TABLE,
};
