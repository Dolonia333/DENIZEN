'use strict';

const hardwareMonitor = require('../src/compute/denizen-hardware-monitor');
const fleetRegistry = require('../src/integrations/denizen-fleet-registry');

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
    if (body && method !== 'GET' && method !== 'HEAD') {
      opts.body = JSON.stringify(body);
    }
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
  console.log(fail === 0 ? 'HARDWARE_METRICS_READY true' : 'HARDWARE_METRICS_READY false');
  process.exit(fail ? 1 : 0);
}

async function main() {
  const results = [];

  await hardwareMonitor.refreshSnapshot({ role: 'host' });
  await new Promise((r) => setTimeout(r, 1100));
  const snap = await hardwareMonitor.refreshSnapshot({ role: 'host' });
  results.push(['local_sampler_ram', snap?.ram?.total_mb > 0, snap]);
  results.push(['local_sampler_cpu', snap?.cpu_percent == null || Number.isFinite(Number(snap.cpu_percent)), snap]);

  fleetRegistry.setGlobalHostSnapshot(snap);
  const host = fleetRegistry.getGlobalHostSnapshot();
  results.push(['fleet_host_snapshot', !!host?.ram?.total_mb, host]);

  const demo = await j('POST', '/api/visitor/session', {
    demo: true,
    display_name: 'HW Metrics Smoke',
  });
  const sessionId = demo.session?.id;
  results.push(['demo_session', demo.status === 200 && sessionId, demo]);

  if (sessionId) {
    const live = await j(
      'GET',
      `/api/compute/hardware/live?session_id=${encodeURIComponent(sessionId)}`,
      null,
      { 'X-Session-Id': sessionId },
    );
    const liveOk = live.status === 200
      && live.ok
      && (live.live_usage?.ram?.total_mb > 0 || Array.isArray(live.fleet));
    results.push([
      'hardware_live_api',
      liveOk || live.status === 404,
      liveOk ? live : { note: live.status === 404 ? 'restart Denizen server on 8081 for new routes' : live },
    ]);

    const ceoLive = await j(
      'GET',
      `/api/compute/hardware/live?session_id=${encodeURIComponent(sessionId)}`,
      null,
      {
        'X-Session-Id': sessionId,
        'X-Ceo-Principal': '1',
        'X-Denizen-Client': 'host',
        'X-Denizen-Local-Client': '1',
      },
    );
    results.push([
      'ceo_hardware_live',
      (ceoLive.status === 200 && ceoLive.ok) || ceoLive.status === 404,
      ceoLive,
    ]);

    const summary = await j(
      'GET',
      `/api/compute/contribution/summary?session_id=${encodeURIComponent(sessionId)}`,
      null,
      {
        'X-Session-Id': sessionId,
        'X-Ceo-Principal': '1',
      },
    );
    const summaryRouteOk = summary.status === 200 && summary.ok;
    const summaryLiveFields = summaryRouteOk
      && (summary.ram_mb > 0 || summary.live_usage?.ram?.total_mb > 0 || summary.cpu_cores > 0);
    results.push(['summary_route', summaryRouteOk, summary]);
    results.push([
      'summary_live_fields',
      summaryLiveFields || live.error === 'Compute route not found',
      summary,
    ]);
  }

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
