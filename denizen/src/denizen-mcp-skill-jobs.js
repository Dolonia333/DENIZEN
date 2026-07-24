'use strict';

/**
 * In-memory MCP skill job store — ChatGPT Custom GPT Actions time out ~45s,
 * so long skills must return a job_id and be polled via get_skill_job.
 */

const crypto = require('node:crypto');

const MAX_JOBS = Number(process.env.DENIZEN_MCP_SKILL_JOB_MAX || 500);
const TTL_MS = Number(process.env.DENIZEN_MCP_SKILL_JOB_TTL_MS || 30 * 60 * 1000);

/** @type {Map<string, object>} */
const _jobs = new Map();

function prune() {
  const now = Date.now();
  for (const [id, job] of _jobs) {
    const ts = Date.parse(job.updated_at || job.created_at || '') || 0;
    if (ts && now - ts > TTL_MS) _jobs.delete(id);
  }
  while (_jobs.size > MAX_JOBS) {
    const oldest = _jobs.keys().next().value;
    if (!oldest) break;
    _jobs.delete(oldest);
  }
}

function createJob({
  orgId,
  npcKey,
  skill,
  params = {},
  tokenId = null,
  sessionId = null,
} = {}) {
  prune();
  const id = `skj_${crypto.randomBytes(12).toString('base64url')}`;
  const now = new Date().toISOString();
  const job = {
    id,
    org_id: orgId || null,
    npc_key: npcKey || null,
    token_id: tokenId || null,
    session_id: sessionId || null,
    skill: String(skill || '').trim(),
    params: params && typeof params === 'object' ? params : {},
    status: 'running',
    ok: null,
    output: null,
    error: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
  _jobs.set(id, job);
  return { ...job };
}

function _touch(job, patch) {
  const next = {
    ...job,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  _jobs.set(job.id, next);
  return { ...next };
}

function completeJob(id, result = {}) {
  const job = _jobs.get(id);
  if (!job) return null;
  const ok = result?.ok !== false;
  return _touch(job, {
    status: ok ? 'done' : 'failed',
    ok,
    output: result?.output || result?.summary || null,
    error: ok ? null : (result?.error || result?.output || 'skill failed'),
    routed: result?.routed,
    finished_at: new Date().toISOString(),
  });
}

function failJob(id, err) {
  const job = _jobs.get(id);
  if (!job) return null;
  return _touch(job, {
    status: 'failed',
    ok: false,
    output: null,
    error: err?.message || String(err || 'skill failed'),
    finished_at: new Date().toISOString(),
  });
}

function getJob(id) {
  prune();
  const job = _jobs.get(String(id || '').trim());
  return job ? { ...job } : null;
}

function getJobForScope(id, scope) {
  const job = getJob(id);
  if (!job) return null;
  if (scope?.org_id && job.org_id && scope.org_id !== job.org_id) return null;
  if (scope?.npc_key && job.npc_key && scope.npc_key !== job.npc_key && scope.npc_key !== '_team') {
    return null;
  }
  return job;
}

function publicJobView(job) {
  if (!job) return null;
  return {
    ok: job.status !== 'failed',
    job_id: job.id,
    status: job.status,
    skill: job.skill,
    npc_key: job.npc_key,
    output: job.output,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
  };
}

/** @private testing */
function _resetForTests() {
  _jobs.clear();
}

module.exports = {
  createJob,
  completeJob,
  failJob,
  getJob,
  getJobForScope,
  publicJobView,
  _resetForTests,
};
