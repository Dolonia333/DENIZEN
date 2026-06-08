'use strict';

const computeCredits = require('../src/denizen-compute-credits');
const contributionTracker = require('../src/denizen-contribution-tracker');

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';

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

function report(results) {
  let pass = 0;
  let fail = 0;
  for (const [name, ok] of results) {
    if (ok) {
      pass += 1;
      console.log(`PASS ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL ${name}`);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  console.log(fail === 0 ? 'CREDIT_ECONOMY_READY true' : 'CREDIT_ECONOMY_READY false');
  process.exit(fail ? 1 : 0);
}

async function main() {
  const results = [];

  const job = computeCredits.computeJobCredits({
    jobType: 'npc_think_batch',
    hardwareScore: 88,
    contributionLevel: 'max',
    durationMs: 12000,
    gpuUtilAvg: 40,
  });
  results.push(['formula_job_credits', job.amount >= 5 && job.formula_version === 1, job]);

  const uptime = computeCredits.computeUptimeCredits({
    hardwareScore: 88,
    contributionLevel: 'max',
    windowSeconds: 900,
    cpuPercentAvg: 25,
    gpuUtilAvg: 35,
    contributing: true,
  });
  results.push(['formula_uptime_credits', uptime.amount >= 1, uptime]);

  const stipend = computeCredits.computeHostStipendCredits({
    hardwareScore: 88,
    lmStudioActive: true,
    gpuUtilAvg: 30,
    windowHours: 1,
  });
  results.push(['formula_host_stipend', stipend.amount >= 1, stipend]);

  contributionTracker.recordSample({
    identityId: 'smoke-economy',
    machineId: 'smoke-host',
    hardwareScore: 88,
    contributionLevel: 'max',
    contributing: true,
    lmStudioActive: true,
    liveMetrics: { cpu_percent: 20, gpu: { utilization_percent: 30 } },
    role: 'host',
  });
  const windows = contributionTracker.listReadyWindows(0);
  results.push(['tracker_samples', windows.length >= 1, { count: windows.length }]);

  const demo = await j('POST', '/api/visitor/session', { demo: true, display_name: 'Credit Economy Smoke' });
  const sessionId = demo.session?.id;
  results.push(['demo_session', demo.status === 200 && sessionId, demo]);

  if (sessionId) {
    const economy = await j(
      'GET',
      `/api/compute/credits/economy?session_id=${encodeURIComponent(sessionId)}`,
      null,
      { 'X-Session-Id': sessionId },
    );
    results.push([
      'economy_route',
      economy.status === 200
        && economy.ok
        && economy.estimates?.npc_think_batch?.formula_version === 1
        && economy.spend_catalog?.priority_boost?.cost === 10,
      economy,
    ]);

    const summary = await j(
      'GET',
      `/api/compute/contribution/summary?session_id=${encodeURIComponent(sessionId)}`,
      null,
      { 'X-Session-Id': sessionId },
    );
    const summaryPayload = summary.contribution_summary || summary;
    results.push([
      'summary_has_economy_fields',
      summary.status === 200
        && (summaryPayload.credits_economy || summaryPayload.estimated_job_credits),
      summaryPayload,
    ]);
  }

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
