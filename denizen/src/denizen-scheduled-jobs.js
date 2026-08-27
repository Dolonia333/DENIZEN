'use strict';

/**
 * In-process scheduled job registry for Denizen (MCP schedule_job / list_jobs).
 * Nightly CRM hygiene is the first-class runner; other jobs can register later.
 */

const outcomeLedger = require('./denizen-outcome-ledger');

const JOBS = new Map();

function registerBuiltinJobs() {
  if (!JOBS.has('crm-hygiene')) {
    JOBS.set('crm-hygiene', {
      id: 'crm-hygiene',
      description: 'Park scrape deals lacking human+next-verb; expire stale directives; write outcome receipt',
      schedule: 'daily@01:00',
      enabled: true,
      last_run_at: null,
      last_result: null,
      next_run_hint: 'hour === 1 local (CRM scheduler tick)',
    });
  }
}

registerBuiltinJobs();

function listJobs() {
  registerBuiltinJobs();
  return [...JOBS.values()].map((j) => ({ ...j }));
}

function getJob(id) {
  registerBuiltinJobs();
  return JOBS.get(String(id || '').trim()) || null;
}

function markJobResult(id, result) {
  const job = getJob(id);
  if (!job) return null;
  const next = {
    ...job,
    last_run_at: new Date().toISOString(),
    last_result: {
      ok: result?.ok !== false,
      parked_count: result?.parked_count,
      expired_count: result?.expired_count,
      outcome_id: result?.outcome?.id || null,
      error: result?.error || null,
    },
  };
  JOBS.set(job.id, next);
  return next;
}

/**
 * Run a named job now (or schedule hint). Currently supports crm-hygiene.
 * @param {string} jobId
 * @param {{ orgId?: string, npcBrains?: object, log?: Console, force?: boolean }} opts
 */
async function runJob(jobId, opts = {}) {
  const id = String(jobId || '').trim();
  if (id !== 'crm-hygiene' && id !== 'nightly-hygiene') {
    return { ok: false, error: `unknown_job:${id}`, known: listJobs().map((j) => j.id) };
  }
  const orgId = opts.orgId;
  if (!orgId) return { ok: false, error: 'orgId required' };

  const hygiene = require('./denizen-nightly-hygiene');
  const result = await hygiene.runNightlyHygiene({
    orgId,
    npcBrains: opts.npcBrains,
    log: opts.log,
  });
  markJobResult('crm-hygiene', result);

  try {
    outcomeLedger.appendOutcome({
      org_id: orgId,
      actor: opts.actor || 'schedule_job',
      outcome_type: 'job.run',
      entity_type: 'scheduled_job',
      entity_key: 'crm-hygiene',
      value_text: result.ok
        ? `crm-hygiene: parked=${result.parked_count} expired=${result.expired_count}`
        : `crm-hygiene failed: ${result.error}`,
      value_json: { result_ok: result.ok, parked_count: result.parked_count, expired_count: result.expired_count },
      source: 'denizen-scheduled-jobs',
      pass: result.ok !== false,
    });
  } catch (_) {}

  return { ok: result.ok !== false, job: getJob('crm-hygiene'), result };
}

function scheduleJob(jobId, opts = {}) {
  const id = String(jobId || opts.job || '').trim() || 'crm-hygiene';
  const job = getJob(id) || getJob('crm-hygiene');
  if (!job) return { ok: false, error: `unknown_job:${id}` };
  if (opts.run_now === true || opts.runNow === true) {
    return runJob(job.id, opts);
  }
  // Mark enabled; CRM scheduler picks up at hour 1
  const next = { ...job, enabled: opts.enabled !== false };
  JOBS.set(job.id, next);
  return {
    ok: true,
    scheduled: true,
    job: next,
    hint: 'crm-hygiene runs at local hour 1 via CRM scheduler, or pass run_now:true',
  };
}

module.exports = {
  listJobs,
  getJob,
  markJobResult,
  runJob,
  scheduleJob,
};
