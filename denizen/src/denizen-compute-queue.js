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

module.exports = {
  enqueueJob,
  claimJob,
  completeJob,
  failJob,
  listPendingJobs,
  listAssignedJobs,
  listRecentCompletedJobs,
  JOB_TABLE,
};
