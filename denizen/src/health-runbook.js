'use strict';

const http = require('node:http');
const lmStudioRemediator = require('./lm-studio-remediator');

const DEVOPS_NPCS = new Set(['Oscar', 'Abby', 'Edward', 'Dan', 'Lucy']);

function canRemediate(npcName) {
  return DEVOPS_NPCS.has(String(npcName || ''));
}

function resolveLmStudioUrl() {
  const direct = String(process.env.LM_STUDIO_URL || '').replace(/\/v1\/?$/, '').trim();
  if (direct) return direct;
  const remote = String(process.env.LM_STUDIO_REMOTE_URLS || '').split(',')[0].trim().replace(/\/v1\/?$/, '');
  if (remote) return remote;
  return 'http://127.0.0.1:1234';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeLmStudio(url = 'http://127.0.0.1:1234') {
  return new Promise((resolve) => {
    const req = http.get(`${url}/v1/models`, { timeout: 3000 }, (res) => {
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ reachable: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'timeout' }); });
  });
}

async function check({ scope = 'full', deps = {} } = {}) {
  const computeQueue = deps.computeQueue;
  const fleetRegistry = deps.fleetRegistry;
  const issues = [];
  const sections = {};

  if (scope === 'server' || scope === 'full') {
    sections.server = {
      uptime_s: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node: process.version,
    };
  }

  if (scope === 'lm-studio' || scope === 'lm' || scope === 'full') {
    const lmUrl = resolveLmStudioUrl();
    const lm = await probeLmStudio(lmUrl);
    sections.lm_studio = { ...lm, url: lmUrl };
    if (!lm.reachable) issues.push('lm_studio_unreachable');
  }

  if (scope === 'mesh' || scope === 'full') {
    const pending = computeQueue ? await computeQueue.listPendingJobs(50).catch(() => []) : [];
    const assigned = computeQueue ? await computeQueue.listAssignedJobs(50).catch(() => []) : [];
    const fleet = fleetRegistry?.listAllFleetMachines?.()
      || fleetRegistry?.buildFleetSummary?.(null)?.fleet
      || [];
    const staleNodes = fleet.filter((m) => {
      if (m.stale) return true;
      if (m.reachable !== false) return false;
      const inf = m.inference && typeof m.inference === 'object' ? m.inference : {};
      const lm = m.lm_studio && typeof m.lm_studio === 'object' ? m.lm_studio : {};
      const rpcOk = (inf.rpc_capable || lm.rpc_capable) && (inf.reachable_local ?? lm.reachable_local);
      return !rpcOk;
    });
    sections.mesh = {
      queue_pending: pending.length,
      queue_assigned: assigned.length,
      fleet_nodes: fleet.length,
      stale_nodes: staleNodes.length,
      stale_node_ids: staleNodes.map((n) => n.machine_id || n.label).slice(0, 5),
    };
    if (pending.length >= 10) issues.push('mesh_queue_deep');
    if (staleNodes.length > 0) issues.push('stale_fleet_nodes');
    if (assigned.length > 0 && !sections.lm_studio?.reachable) issues.push('jobs_assigned_lm_down');
  }

  if (scope === 'ux' || scope === 'full') {
    try {
      const selfAdjust = require('./denizen-self-adjust');
      const status = selfAdjust.getStatus();
      const aborts = Number(status.stats?.recent_aborts || 0);
      sections.ux = {
        assist_timeout_ms: status.timeouts?.assist_timeout_ms,
        recent_aborts: aborts,
        last_tick: status.last_tick,
        last_bump: status.stats?.last_assist_bump || null,
      };
      if (aborts >= 3) issues.push('client_assist_aborts');
    } catch (_) {
      sections.ux = { unavailable: true };
    }
  }

  return {
    ok: issues.length === 0,
    scope,
    issues,
    sections,
    checked_at: new Date().toISOString(),
  };
}

async function verifyPoll({
  scope = 'full',
  deps = {},
  maxAttempts = 12,
  intervalMs = 5000,
} = {}) {
  const attempts = [];
  for (let i = 0; i < maxAttempts; i += 1) {
    const report = await check({ scope, deps });
    attempts.push({ attempt: i + 1, ok: report.ok, issues: report.issues });
    if (report.ok) {
      return { ok: true, attempts, report };
    }
    if (i < maxAttempts - 1) await sleep(intervalMs);
  }
  const final = await check({ scope, deps });
  return { ok: final.ok, attempts, report: final };
}

async function remediate({ action = 'verify', deps = {} } = {}) {
  const computeQueue = deps.computeQueue;
  const steps = [];

  if (action === 'clear-stale-jobs' || action === 'reclaim-stale' || action === 'drain-mesh-queue') {
    if (computeQueue?.reclaimStaleJobs) {
      const r = await computeQueue.reclaimStaleJobs();
      steps.push(`reclaimed ${r.reclaimed} stale assigned job(s)`);
    }
    if (computeQueue?.expireOldQueuedJobs) {
      const e = await computeQueue.expireOldQueuedJobs();
      steps.push(`expired ${e.expired} stale queued job(s)`);
    }
    if (computeQueue?.trimExcessQueuedJobs) {
      const t = await computeQueue.trimExcessQueuedJobs();
      steps.push(`trimmed ${t.trimmed} excess queued job(s)`);
    }
  }

  if (action === 'restart-lm-studio' || action === 'lm-studio-restart') {
    const r = await lmStudioRemediator.restartAndVerify({ probeFn: probeLmStudio });
    steps.push(r.summary || (r.ok ? 'LM Studio restarted' : 'LM Studio restart failed'));
    if (!r.ok) {
      const after = await check({ scope: 'full', deps });
      return {
        ok: false,
        action,
        summary: steps.join('; '),
        report: after,
        restart: r,
      };
    }
  }

  if (action === 'verify-poll' || action === 'verify') {
    const poll = await verifyPoll({
      scope: 'full',
      deps,
      maxAttempts: Number(process.env.DENIZEN_VERIFY_POLL_ATTEMPTS) || 12,
      intervalMs: Number(process.env.DENIZEN_VERIFY_POLL_MS) || 5000,
    });
    steps.push(poll.ok
      ? `verify poll passed in ${poll.attempts.length} attempt(s)`
      : `verify poll failed after ${poll.attempts.length} attempt(s)`);
    return {
      ok: poll.ok,
      action,
      summary: steps.join('; '),
      report: poll.report,
      verify_poll: poll,
    };
  }

  if (action === 'lm-studio-hint') {
    steps.push('LM Studio: verify it is running on port 1234, model loaded, and LM_STUDIO_URL matches');
  }

  if (action === 'bump-assist-timeout' || action === 'self-adjust-ux') {
    try {
      const selfAdjust = require('./denizen-self-adjust');
      const tick = selfAdjust.tick();
      const bump = selfAdjust.maybeBumpAssistTimeout({ reason: 'health_runbook' });
      steps.push(
        bump?.bumped
          ? `assist timeout ${bump.from} → ${bump.to}ms`
          : `assist timeout unchanged (${tick?.timeouts?.assist_timeout_ms || 'n/a'}ms)`,
      );
    } catch (err) {
      steps.push(`self-adjust failed: ${err?.message || err}`);
    }
  }

  const after = await check({ scope: 'full', deps });
  const summary = steps.length ? steps.join('; ') : 'verify only';
  return {
    ok: after.ok,
    action,
    summary: `${summary}. Issues remaining: ${after.issues.join(', ') || 'none'}`,
    report: after,
  };
}

async function runHealthRunbook({ scope = 'full', remediateActions = [], broadcast, deps = {}, verifyAfter = true } = {}) {
  const emit = (phase, detail = {}) => {
    broadcast?.({
      type: 'health_runbook_progress',
      phase,
      ...detail,
      ts: Date.now(),
    });
  };

  emit('check', { scope });
  const before = await check({ scope, deps });
  emit('check_complete', { issues: before.issues });

  const remediateResults = [];
  for (const action of remediateActions) {
    emit('remediate', { action });
    const r = await remediate({ action, deps });
    remediateResults.push(r);
  }

  let after = remediateActions.length
    ? await check({ scope, deps })
    : before;

  let verifyPollResult = null;
  if (verifyAfter && remediateActions.length) {
    emit('verify_poll', { scope });
    verifyPollResult = await verifyPoll({ scope, deps });
    after = verifyPollResult.report || after;
    emit('verify_complete', { ok: verifyPollResult.ok, attempts: verifyPollResult.attempts?.length });
  }

  const result = {
    ok: after.ok,
    before,
    after,
    remediateResults,
    verify_poll: verifyPollResult,
  };

  broadcast?.({
    type: 'health_runbook_complete',
    ok: result.ok,
    issues: after.issues,
    ts: Date.now(),
  });

  return result;
}

module.exports = {
  check,
  remediate,
  verifyPoll,
  runHealthRunbook,
  canRemediate,
  probeLmStudio,
  resolveLmStudioUrl,
};
