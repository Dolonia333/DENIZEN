'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hardwareMonitor = require('../src/compute/denizen-hardware-monitor');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';
const fleetToken = process.env.DENIZEN_FLEET_AGENT_TOKEN || '';
const identityId = process.env.DENIZEN_FLEET_IDENTITY_ID || 'fleet-smoke-identity';

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
  console.log(fail === 0 ? 'NAS_FLEET_READY true' : 'NAS_FLEET_READY false');
  process.exit(fail ? 1 : 0);
}

async function main() {
  const results = [];
  const machineId = `nas-smoke-${crypto.randomBytes(4).toString('hex')}`;

  if (!fleetToken) {
    results.push(['fleet_token_configured', false, { note: 'set DENIZEN_FLEET_AGENT_TOKEN' }]);
    report(results);
    return;
  }

  await hardwareMonitor.refreshSnapshot({ role: 'nas', machine_id: machineId, label: 'NAS Smoke' });
  await new Promise((r) => setTimeout(r, 1100));
  const live = await hardwareMonitor.collectLiveMetrics({
    role: 'nas',
    machine_id: machineId,
    label: 'NAS Smoke',
    contributing: true,
  });

  const denied = await j('POST', '/api/compute/fleet/report', {
    identity_id: identityId,
    live_metrics: live,
  });
  results.push(['fleet_report_requires_token', denied.status === 401, denied]);

  const reportRes = await j(
    'POST',
    '/api/compute/fleet/report',
    {
      identity_id: identityId,
      machine_id: machineId,
      role: 'nas',
      label: 'NAS Smoke',
      smoke: true,
      live_metrics: live,
    },
    { 'X-Fleet-Agent-Token': fleetToken, 'X-Fleet-Smoke': '1' },
  );
  results.push(['fleet_report_api', reportRes.status === 200 && reportRes.ok, reportRes]);

  let liveApi = { ok: false, fleet: [] };
  const sessionId = process.env.DENIZEN_FLEET_SESSION_ID
    || (identityId.startsWith('session:') ? identityId.slice('session:'.length) : '');
  const sessionToken = process.env.DENIZEN_FLEET_SESSION_TOKEN || '';
  if (sessionId) {
    liveApi = await j(
      'GET',
      `/api/compute/hardware/live?session_id=${encodeURIComponent(sessionId)}`,
      null,
      {
        'X-Ceo-Principal': '1',
        'X-Denizen-Local-Client': '1',
        'X-Session-Token': sessionToken,
      },
    );
  }
  const fleetFromApi = liveApi.fleet || [];
  const smokeExcluded = !fleetFromApi.some((m) => m.machine_id === machineId);
  const realNas = fleetFromApi.find((m) => m.role === 'nas' && !String(m.machine_id || '').startsWith('nas-smoke-'));
  results.push([
    'fleet_live_api_nas_metrics',
    liveApi.ok && smokeExcluded && !!realNas && realNas.ram?.total_mb > 0,
    { smoke_excluded: smokeExcluded, real_nas: realNas || null },
  ]);

  const health = await j('GET', '/api/health');
  const fleet = health.hardware?.fleet || [];
  const healthSmokeExcluded = !fleet.some((m) => m.machine_id === machineId);
  const healthNas = fleet.find((m) => m.role === 'nas' && !String(m.machine_id || '').startsWith('nas-smoke-'));
  results.push([
    'health_fleet_includes_nas',
    healthSmokeExcluded && !!healthNas && (healthNas.cpu_percent != null || healthNas.ram?.total_mb > 0),
    { smoke_excluded: healthSmokeExcluded, real_nas: healthNas || null },
  ]);

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
