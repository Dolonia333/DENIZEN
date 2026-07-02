import { chromium } from 'playwright';
import { loginOwner } from './lib/probe-login.mjs';

const base = process.argv[2] || 'http://localhost:8081';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2000);

await loginOwner(page);

const office = await page.evaluate(() => ({
  store: JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}'),
  hasGrant: !!localStorage.getItem('denizen-ceo-grant'),
  mem: {
    sid: globalThis.DenizenVisitorSession?.getSessionId?.() || null,
    hasTok: !!globalThis.DenizenVisitorSession?.getSessionToken?.(),
    ceo: globalThis.DenizenVisitorSession?.isCeoPrincipal?.() || false,
  },
}));
console.log('OFFICE', JSON.stringify(office, null, 2));

const sid = office.store.session_id || office.mem.sid;
const tok = office.store.session_token;
let crmUrl = `${base}/crm/`;
if (sid) crmUrl += `?dz_sid=${encodeURIComponent(sid)}${tok ? `&dz_stok=${encodeURIComponent(tok)}` : ''}`;
await page.goto(crmUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(5000);

const crm = await page.evaluate(() => ({
  store: JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}'),
  hasGrant: !!localStorage.getItem('denizen-ceo-grant'),
  pill: (document.body.innerText.match(/Local only[^\n]*|Synced[^\n]*|Team ·[^\n]*|Syncing[^\n]*/) || [])[0] || 'none',
}));
console.log('CRM', JSON.stringify(crm, null, 2));

const api = await page.evaluate(async () => {
  const s = JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}');
  const headers = { 'Content-Type': 'application/json' };
  if (s.session_id) headers['X-Session-Id'] = s.session_id;
  if (s.session_token) headers['X-Session-Token'] = s.session_token;
  const grant = localStorage.getItem('denizen-ceo-grant');
  if (grant) headers['X-Denizen-Ceo-Grant'] = grant;
  const qs = s.session_id ? `?session_id=${encodeURIComponent(s.session_id)}` : '';
  const res = await fetch(`/api/crm/workspace${qs}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
});
console.log('API', JSON.stringify(api, null, 2));

const health = await page.evaluate(async () => {
  const res = await fetch('/api/crm/health');
  return { status: res.status, data: await res.json().catch(() => ({})) };
});
console.log('HEALTH', JSON.stringify(health, null, 2));

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
    body: JSON.stringify({ session_id: s.session_id, message: 'hi', state: { contacts: [], deals: [], tasks: [] } }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
});
console.log('ASSIST', JSON.stringify(assist, null, 2));

await browser.close();
