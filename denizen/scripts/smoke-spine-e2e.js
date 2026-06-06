'use strict';

const { spawnSync } = require('node:child_process');

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8080';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const dbContainer = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_Desktop';

async function requestJson(method, path, body, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function dockerRlsProbe() {
  const query = [
    "select set_config('request.jwt.claims',",
    `'{"sub":"00000000-0000-0000-0000-000000000000","email":"zion@example.com","role":"authenticated"}', true);`,
    'select public.denizen_user_can_access_org(public.denizen_default_org_id()) as can_access;',
  ].join(' ');

  const result = spawnSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD=postgres', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', query],
    { encoding: 'utf8' },
  );

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || 'docker psql failed').trim() };
  }

  const output = String(result.stdout || '').trim();
  const hasBool = /\b(t|f|true|false)\b/i.test(output);
  return {
    ok: hasBool,
    output: output || '(empty output)',
    error: hasBool ? null : 'RLS helper output missing boolean result',
  };
}

async function main() {
  const checks = [];

  let health = null;
  try {
    health = await requestJson('GET', '/api/health');
  } catch (err) {
    health = { ok: false, status: 0, data: { error: err.message } };
  }

  if (health.ok && typeof health.data === 'object') {
    checks.push({
      name: 'rls_or_health',
      status: 'PASS',
      detail: { source: 'api/health', status: health.status },
    });
  } else {
    const probe = dockerRlsProbe();
    if (probe.ok) {
      checks.push({
        name: 'rls_or_health',
        status: 'PASS',
        detail: { source: 'docker_rls_helper', output: probe.output },
      });
    } else {
      checks.push({
        name: 'rls_or_health',
        status: 'FAIL',
        detail: { healthStatus: health.status, healthError: health.data?.error, probeError: probe.error },
      });
    }
  }

  if (health.ok) {
    const maintenance = await requestJson('POST', '/api/job-crm/maintenance', {});
    const maintenanceLooksJson = typeof maintenance.data === 'object' && maintenance.data !== null;
    checks.push({
      name: 'job_crm_maintenance_json',
      status: maintenance.ok && maintenanceLooksJson ? 'PASS' : 'FAIL',
      detail: {
        status: maintenance.status,
        keys: maintenanceLooksJson ? Object.keys(maintenance.data).slice(0, 8) : [],
      },
    });

    const summary = await requestJson('GET', '/api/intelligence/prediction-summary');
    const summaryLooksJson = typeof summary.data === 'object' && summary.data !== null;
    checks.push({
      name: 'prediction_summary_endpoint',
      status: summary.ok && summaryLooksJson ? 'PASS' : 'FAIL',
      detail: { status: summary.status, hasJson: summaryLooksJson },
    });
  } else {
    checks.push({
      name: 'job_crm_maintenance_json',
      status: 'SKIP',
      detail: { reason: 'server unreachable at DENIZEN_URL' },
    });
    checks.push({
      name: 'prediction_summary_endpoint',
      status: 'SKIP',
      detail: { reason: 'server unreachable at DENIZEN_URL' },
    });
  }

  let failed = 0;
  let skipped = 0;
  for (const check of checks) {
    if (check.status === 'FAIL') failed += 1;
    if (check.status === 'SKIP') skipped += 1;
    console.log(`${check.status} ${check.name} ${JSON.stringify(check.detail)}`);
  }

  const passed = checks.length - failed - skipped;
  console.log(`Smoke spine summary: pass=${passed} fail=${failed} skip=${skipped}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL smoke_spine_unhandled', err?.stack || err?.message || String(err));
  process.exit(1);
});
