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

async function j(method, pathSuffix, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
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
  console.log(fail === 0 ? 'SELF_HEAL_READY true' : 'SELF_HEAL_READY false');
  process.exit(fail ? 1 : 0);
}

async function main() {
  const results = [];

  const health = await j('GET', '/api/health');
  results.push(['health_endpoint', health.status === 200, health.status]);

  const pressure = await j('GET', '/api/compute/resource-pressure');
  results.push(['resource_pressure', pressure.ok === true && pressure.signals, !pressure.signals && 'missing signals']);

  const scale = await j('GET', '/api/compute/scale-advice');
  results.push(['scale_advice', scale.ok === true && scale.plan?.actions, !scale.plan && 'missing plan']);

  const runbook = await j('POST', '/api/health/runbook', {
    scope: 'server',
    remediate: [],
    verify_after: false,
  });
  results.push(['health_runbook', runbook.ok === true && runbook.before, !runbook.before && 'missing before report']);

  const autoOff = await j('POST', '/api/compute/scale-advice', { execute: true });
  const skipped = autoOff.auto_scale?.skipped === true || autoOff.auto_scale == null;
  results.push(['auto_scale_guarded', skipped, !skipped && 'auto_scale ran without DENIZEN_AUTO_HEAL']);

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
