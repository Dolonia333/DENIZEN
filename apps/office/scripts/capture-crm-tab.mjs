// Capture one CRM sidebar tab — screenshot + layout metrics for agents.
// Usage: node scripts/capture-crm-tab.mjs [baseUrl] [tabId]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const TAB_ID = process.argv[3] || 'dashboard';
const OUT = 'reports/crm-ui/inspect';
fs.mkdirSync(OUT, { recursive: true });

const SNAP = { timeout: 10_000, animations: 'disabled' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(page);
const sid = await page.evaluate(() => JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}').session_id);
let crmUrl = `${BASE}/crm/`;
if (sid) crmUrl += `?dz_sid=${encodeURIComponent(sid)}`;
await page.goto(crmUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForTimeout(3000);

await page.evaluate((tabId) => {
  window.dispatchEvent(new CustomEvent('crm-navigate', { detail: tabId }));
}, TAB_ID);
await page.waitForTimeout(800);

const metrics = await page.evaluate((tabId) => {
  const main = document.querySelector('main');
  const mainRect = main?.getBoundingClientRect();
  const textLen = main?.innerText?.trim().length || 0;
  const h1 = document.querySelector('main h1, main h2')?.innerText?.trim() || null;
  return {
    tab: tabId,
    heading: h1,
    mainTextLength: textLen,
    blank: textLen < 20,
    main: mainRect ? {
      top: Math.round(mainRect.top),
      left: Math.round(mainRect.left),
      width: Math.round(mainRect.width),
      height: Math.round(mainRect.height),
    } : null,
    is404: !!document.querySelector('h1')?.innerText?.includes('404'),
  };
}, TAB_ID);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const shotPath = path.join(OUT, `tab-${TAB_ID}-${stamp}.png`);
await page.screenshot({ path: shotPath, fullPage: false, ...SNAP });

await browser.close();

const result = {
  ok: !metrics.blank && !metrics.is404,
  screenshot: shotPath.replace(/\\/g, '/'),
  metrics,
  pageErrors,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
