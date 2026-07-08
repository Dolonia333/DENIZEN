#!/usr/bin/env node
/**
 * CRM API smoke — health, assist, workspace (requires running Denizen + CEO or team session).
 * Usage: node scripts/smoke-crm-api.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { loginOwner } from './lib/probe-login.mjs';

const base = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const failures = [];

function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(`${base}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500);

  await loginOwner(page);

  const health = await page.evaluate(async () => {
    const res = await fetch('/api/crm/health');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  });
  check('GET /api/crm/health', health.status === 200 && health.data.ok, JSON.stringify(health.data).slice(0, 120));
  const hasAssist = (health.data.routes || []).some((r) => String(r).includes('/api/crm/assist'));
  check('health lists assist route', hasAssist);

  const assist = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}');
    const headers = { 'Content-Type': 'application/json' };
    if (s.session_id) headers['X-Session-Id'] = s.session_id;
    if (s.session_token) headers['X-Session-Token'] = s.session_token;
    const grant = localStorage.getItem('denizen-ceo-grant');
    if (grant) headers['X-Denizen-Ceo-Grant'] = grant;
    if (s.access_method === 'ceo' || s.tier === 'ceo') headers['X-Access-Method'] = 'ceo';
    const res = await fetch('/api/crm/assist', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session_id: s.session_id,
        message: 'hi',
        state: { contacts: [], deals: [], tasks: [] },
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  });
  check(
    'POST /api/crm/assist',
    assist.status === 200 && assist.data.ok && assist.data.reply,
    assist.data.error || `HTTP ${assist.status}`,
  );

  const workspace = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}');
    const headers = {};
    if (s.session_id) headers['X-Session-Id'] = s.session_id;
    if (s.session_token) headers['X-Session-Token'] = s.session_token;
    const grant = localStorage.getItem('denizen-ceo-grant');
    if (grant) headers['X-Denizen-Ceo-Grant'] = grant;
    const qs = s.session_id ? `?session_id=${encodeURIComponent(s.session_id)}` : '';
    const res = await fetch(`/api/crm/workspace${qs}`, { headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: data.ok, error: data.error };
  });
  check('GET /api/crm/workspace', workspace.status === 200 && workspace.ok !== false, workspace.error || `HTTP ${workspace.status}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('\nFailures:', failures.join('\n  '));
  console.error('\nTip: restart Denizen after updating denizen-crm-*.js — npm start');
  process.exit(1);
}
console.log('\nCRM API smoke passed.');
