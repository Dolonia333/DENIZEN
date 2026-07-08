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
    let value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '.env.production'));

const base = (process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');

async function j(method, pathSuffix, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
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
  for (const [name, ok, detail] of results) {
    if (ok) {
      pass += 1;
      console.log(`PASS ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  const results = [];

  const before = await j('GET', '/api/compute/node/status?limit=50');
  const pendingBefore = Number(before.pending_count) || 0;
  results.push(['status_before', before.status === 200, `pending=${pendingBefore}`]);

  const drain = await j('POST', '/api/health/runbook', {
    scope: 'mesh',
    remediate: ['drain-mesh-queue'],
    verify_after: false,
  });
  const remediateRan = Array.isArray(drain.remediateResults) && drain.remediateResults.length > 0;
  const remediateOk = drain.remediateResults?.every((r) => r?.ok !== false) ?? false;
  results.push([
    'drain_runbook',
    drain.status === 200 && remediateRan && remediateOk,
    drain.status === 200 ? null : drain.error || drain.status,
  ]);

  const after = await j('GET', '/api/compute/node/status?limit=50');
  const pendingAfter = Number(after.pending_count) || 0;
  results.push([
    'queue_reduced',
    pendingAfter < pendingBefore || pendingAfter <= 8,
    `pending ${pendingBefore} -> ${pendingAfter}`,
  ]);

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
