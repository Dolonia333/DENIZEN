'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';
const internalToken = process.env.DENIZEN_INTERNAL_API_TOKEN || '';
const pollMs = Number(process.env.SMOKE_MESH_POLL_MS || 2000);
const maxWaitMs = Number(process.env.SMOKE_MESH_WAIT_MS || 30000);
const tag = `smoke-mesh-${Date.now()}`;

async function j(method, pathSuffix, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: ctrl.signal,
    };
    if (body && method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(body);
    const r = await fetch(`${base}${pathSuffix}`, opts);
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ...data };
  } finally {
    clearTimeout(t);
  }
}

function internalHeaders(extra = {}) {
  const headers = { ...extra };
  if (internalToken) headers['X-Internal-Token'] = internalToken;
  return headers;
}

function countRecentCompletions(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function report(results) {
  let pass = 0;
  let fail = 0;
  for (const [name, ok, detail] of results) {
    if (ok) {
      pass += 1;
      console.log(`PASS ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL ${name}`, detail ? JSON.stringify(detail) : '');
    }
  }
  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  console.log(fail === 0 ? 'MESH_JOBS_FLOW_READY true' : 'MESH_JOBS_FLOW_READY false');
  process.exit(fail ? 1 : 0);
}

async function fetchMeshStatus() {
  return j('GET', '/api/compute/node/status', null, internalHeaders());
}

async function main() {
  const results = [];

  const before = await fetchMeshStatus();
  results.push(['status_reachable', before.status === 200 && before.ok, before]);
  if (before.status !== 200 || !before.ok) {
    report(results);
    return;
  }

  if (before.db_enabled === false) {
    results.push(['db_enabled', false, { note: 'DENIZEN_DB_ENABLED or SUPABASE_URL missing on server' }]);
    report(results);
    return;
  }
  results.push(['db_enabled', true, { db_enabled: before.db_enabled }]);

  const pendingBefore = Number(before.pending_count) || 0;
  const completionsBefore = countRecentCompletions(before.recent_completions);

  const enqueue = await j(
    'POST',
    '/api/compute/jobs/enqueue',
    {
      jobType: 'sim_tick',
      payload: { smoke: tag, source: 'smoke-mesh-jobs-flow' },
      priority: 55,
    },
    internalHeaders(),
  );
  results.push([
    'enqueue_sim_tick',
    enqueue.status === 200 && enqueue.ok && enqueue.job?.id,
    enqueue,
  ]);

  if (!enqueue.job?.id) {
    report(results);
    return;
  }

  const afterEnqueue = await fetchMeshStatus();
  const pendingAfterEnqueue = Number(afterEnqueue.pending_count) || 0;
  results.push([
    'pending_increased_or_queued',
    pendingAfterEnqueue >= pendingBefore,
    {
      pending_before: pendingBefore,
      pending_after_enqueue: pendingAfterEnqueue,
      job_id: enqueue.job.id,
    },
  ]);

  const deadline = Date.now() + maxWaitMs;
  let settled = false;
  let last = afterEnqueue;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    last = await fetchMeshStatus();
    const pendingNow = Number(last.pending_count) || 0;
    const completionsNow = countRecentCompletions(last.recent_completions);
    const pendingDown = pendingNow < pendingAfterEnqueue;
    const completionsUp = completionsNow > completionsBefore;
    const sawOurJob = (last.recent_completions || []).some(
      (row) => row?.id === enqueue.job.id || row?.job_type === 'sim_tick',
    );

    if (pendingDown || completionsUp || sawOurJob) {
      settled = true;
      results.push([
        'job_progressed',
        true,
        {
          pending_before: pendingBefore,
          pending_after_enqueue: pendingAfterEnqueue,
          pending_now: pendingNow,
          completions_before: completionsBefore,
          completions_now: completionsNow,
          saw_our_job: sawOurJob,
        },
      ]);
      break;
    }
  }

  if (!settled) {
    const pendingNow = Number(last.pending_count) || 0;
    const completionsNow = countRecentCompletions(last.recent_completions);
    results.push([
      'job_progressed',
      false,
      {
        note: 'no worker consumed job within wait window',
        pending_now: pendingNow,
        completions_now: completionsNow,
        wait_ms: maxWaitMs,
      },
    ]);
  }

  report(results);
}

main().catch((err) => {
  console.error(err);
  console.log('MESH_JOBS_FLOW_READY false');
  process.exit(1);
});
