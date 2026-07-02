/**
 * Probe Approvals tap flow on phone UI.
 * Usage: node scripts/approvals-probe.mjs [baseUrl]
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || 'http://192.168.1.237:8888').replace(/\/$/, '');
const OUT = 'reports/approvals-probe.json';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
});
const page = await ctx.newPage();
const log = [];
page.on('console', (m) => {
  if (m.type() === 'warn' || m.type() === 'error') log.push(`[${m.type()}] ${m.text()}`);
});

await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await loginOwner(page);
await page.waitForTimeout(10_000);

await page.evaluate(() => window.DenizenPhoneUi?.open?.());
await page.waitForTimeout(500);
await page.locator('.dzp-app[data-app="approvals"]').click({ timeout: 10_000 });
await page.waitForTimeout(2500);

const before = await page.evaluate(() => {
  const panel = document.querySelector('#denizen-proposals-panel');
  const approve = panel?.querySelector('[data-action="approve"]');
  const doc = panel?.querySelector('.prop-doc');
  return {
    panelOpen: panel?.classList.contains('open'),
    pendingDoc: !!doc,
    approveVisible: !!approve,
    approveDisabled: approve?.disabled || approve?.getAttribute('aria-disabled') === 'true',
    approveText: approve?.textContent || null,
    toast: panel?.querySelector('.prop-toast:not([hidden])')?.textContent || null,
    items: panel?.querySelectorAll('.prop-index-item')?.length || 0,
  };
});

let approveResult = { clicked: false, after: null };
if (before.approveVisible && !before.approveDisabled) {
  await page.locator('#denizen-proposals-panel [data-action="approve"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  approveResult = await page.evaluate(() => {
    const panel = document.querySelector('#denizen-proposals-panel');
    const toast = panel?.querySelector('.prop-toast:not([hidden])')?.textContent || null;
    const stamp = panel?.querySelector('.prop-doc-stamp')?.textContent?.trim() || null;
    return {
      clicked: true,
      toast,
      stamp,
      modal: !!panel?.querySelector('[data-note-modal]'),
    };
  });
}

const report = { base: BASE, before, approveResult, log };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: 'reports/approvals-probe.png', fullPage: true });
await browser.close();
