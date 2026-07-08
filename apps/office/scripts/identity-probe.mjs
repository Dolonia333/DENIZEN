// End-to-end identity check:
// 1. A "tunneled" teammate (loopback + X-Forwarded-For) joins via team code,
//    types name + work email → must link to their OWN identity, and must NOT
//    be marked host operator.
// 2. Spoofed CEO/local headers + metadata must grant nothing.
// Usage (from apps/office/): node --env-file=.env scripts/identity-probe.mjs [baseUrl]
import { chromium } from 'playwright';
import { joinTeamProbe } from './lib/probe-login.mjs';

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const TEAM_CODE = process.env.DENIZEN_TEAM_CODE || '1921';
const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const EMAIL = `probe.teammate+${Date.now()}@example.com`;

const failures = [];
const check = (name, cond, extra = '') => {
  if (!cond) failures.push(name);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function dbGet(path) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return res.ok ? res.json() : [];
}

// --- 1. Tunneled teammate joins via team code + email ---
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.7' }, // looks like tunnel traffic
});
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await joinTeamProbe(page, {
  teamCode: TEAM_CODE,
  username: 'Probe Teammate',
  email: EMAIL,
});
await page.waitForFunction(() => !document.getElementById('denizen-visitor-name-modal'), { timeout: 30_000 }).catch(() => null);

// Legacy name-only step after join
const nameInput = page.locator('#denizen-visitor-name-input');
if (await nameInput.count()) {
  const emailFieldExists = await page.locator('#denizen-visitor-name-email-input').count() > 0;
  check('team join asks for work email', emailFieldExists);
  await nameInput.fill('Probe Teammate');
  if (emailFieldExists) {
    await page.locator('[data-action="submit-name"]').click();
    await page.waitForTimeout(400);
    const blocked = await page.evaluate(() => !!document.getElementById('denizen-visitor-name-modal'));
    check('empty email is rejected', blocked);
    await page.locator('#denizen-visitor-name-email-input').fill(EMAIL);
  }
  await page.locator('[data-action="submit-name"]').click({ timeout: 15_000 });
  await page.waitForFunction(() => !document.getElementById('denizen-visitor-name-modal'), { timeout: 30_000 });
}
await page.waitForTimeout(5_000);

const clientProfile = await page.evaluate(() => globalThis.DenizenVisitorSession?.getProfile?.() || {});
check('client profile shows own name', clientProfile.displayName === 'Probe Teammate', JSON.stringify(clientProfile.displayName));
check('client profile shows own email', clientProfile.email === undefined || clientProfile.email === null || String(clientProfile.email).startsWith('probe.teammate'), String(clientProfile.email));
check('client is not CEO', clientProfile.tier !== 'ceo');

const idRows = await dbGet(`denizen_user_identities?select=id,email,display_name,metadata&email_normalized=eq.${encodeURIComponent(EMAIL)}&limit=1`);
const ident = idRows?.[0];
check('DB identity exists with real email', !!ident?.id, EMAIL);
check('DB identity uses own display name', ident?.display_name === 'Probe Teammate', ident?.display_name);
const meta = ident?.metadata && typeof ident.metadata === 'object' ? ident.metadata : {};
check('DB identity NOT marked host operator', !meta.is_host_operator);
check('DB identity NOT marked CEO', !meta.is_ceo_principal);

if (ident?.id) {
  const sessRows = await dbGet(`denizen_visitor_sessions?select=id,identity_id,metadata&identity_id=eq.${encodeURIComponent(ident.id)}&limit=2`);
  check('session linked to own identity', sessRows.length >= 1);
  const smeta = sessRows?.[0]?.metadata || {};
  check('session metadata has no CEO flag', smeta.is_ceo_principal !== true);
}
await ctx.close();
await browser.close();

// --- 2. Spoofed CEO/local headers grant nothing ---
const spoof = await fetch(`${BASE_URL}/api/visitor/session`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Ceo-Principal': '1',
    'X-Denizen-Local-Client': '1',
    'X-Forwarded-For': '203.0.113.8',
  },
  body: JSON.stringify({
    demo: true,
    display_name: 'Spoofer',
    metadata: { is_ceo_principal: true, access_method: 'ceo' },
  }),
});
const spoofData = await spoof.json().catch(() => ({}));
const spoofMeta = spoofData?.session?.metadata || {};
check('spoofed metadata.is_ceo_principal stripped', spoofMeta.is_ceo_principal !== true, JSON.stringify(spoofMeta));
check('spoofed access_method not ceo', !/^ceo/i.test(String(spoofMeta.access_method || '')), String(spoofMeta.access_method));
check('spoofer not linked to CEO identity', !String(spoofData?.identity?.email || '').startsWith('ceo@'), String(spoofData?.identity?.email || 'none'));

const approveSpoof = await fetch(`${BASE_URL}/api/skill-proposals/nonexistent/approve`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Ceo-Principal': '1',
    'X-Forwarded-For': '203.0.113.8',
  },
  body: JSON.stringify({ is_ceo_principal: true }),
});
check('skill approve denied for spoofed remote', approveSpoof.status === 403, `HTTP ${approveSpoof.status}`);

console.log(failures.length ? `\n${failures.length} FAILURES` : '\nIDENTITY OK');
process.exit(failures.length ? 1 : 0);
