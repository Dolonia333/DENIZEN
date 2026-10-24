import { chromium, devices } from 'playwright';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || (console.error('Pass the Denizen base URL as argv[2] or set DENIZEN_URL'), process.exit(1))).replace(/\/$/, '');
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();

await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await loginOwner(page);
await page.waitForTimeout(10_000);
await page.evaluate(() => window.DenizenPhoneUi?.open?.());
await page.waitForTimeout(500);
await page.locator('.dzp-app[data-app="approvals"]').click();
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const panel = document.querySelector('#denizen-proposals-panel');
  const doc = panel?.querySelector('.prop-doc');
  const checks = [...panel?.querySelectorAll('[data-citation-check]') || []];
  return {
    kind: doc?.getAttribute('data-kind'),
    id: doc?.getAttribute('data-id'),
    stamp: panel?.querySelector('.prop-doc-stamp')?.textContent?.trim(),
    citationCount: checks.length,
    gate: panel?.querySelector('.prop-dossier-gate')?.textContent?.trim() || null,
    approveAria: panel?.querySelector('[data-action="approve"]')?.getAttribute('aria-disabled'),
  };
});
console.log('before', JSON.stringify(info, null, 2));

const n = await page.locator('[data-action="cite-toggle"]').count();
for (let i = 0; i < n; i++) {
  const btn = page.locator('[data-action="cite-toggle"]').nth(i);
  const cls = await btn.getAttribute('class');
  if (!cls?.includes('checked')) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(250);
}
await page.waitForTimeout(800);

const afterChecks = await page.evaluate(() => ({
  approveAria: document.querySelector('#denizen-proposals-panel [data-action="approve"]')?.getAttribute('aria-disabled'),
  gate: document.querySelector('.prop-dossier-gate')?.textContent?.trim() || null,
}));
console.log('after checks', JSON.stringify(afterChecks, null, 2));

await page.locator('#denizen-proposals-panel [data-action="approve"]').first().click({ timeout: 5000 });
await page.waitForTimeout(3000);

const final = await page.evaluate(() => ({
  toast: document.querySelector('#denizen-proposals-panel .prop-toast:not([hidden])')?.textContent?.trim(),
  stamp: document.querySelector('.prop-doc-stamp')?.textContent?.trim(),
}));
console.log('final', JSON.stringify(final, null, 2));
await browser.close();
