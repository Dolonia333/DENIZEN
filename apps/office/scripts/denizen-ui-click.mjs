// Log in, open Denizen phone (optional app), click a selector, capture screenshot.
// Usage: node scripts/denizen-ui-click.mjs [baseUrl] [selector] [appId]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { loginOwner } from './lib/probe-login.mjs';

const BASE_URL = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const SELECTOR = process.argv[3] || '';
const APP_ID = process.argv[4] || '';
const OUT = 'reports/phone-ui/inspect';
fs.mkdirSync(OUT, { recursive: true });
const SNAP = { timeout: 10_000, animations: 'disabled' };

if (!SELECTOR) {
  console.error(JSON.stringify({ ok: false, error: 'selector required' }));
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(page, { baseUrl: BASE_URL });
await page.waitForTimeout(2000);

if (APP_ID) {
  await page.evaluate(() => window.DenizenPhoneUi?.open?.());
  await page.waitForTimeout(800);
  if (APP_ID !== 'home') {
    await page.locator(`.dzp-app[data-app="${APP_ID}"]`).click({ timeout: 10_000 });
    await page.waitForTimeout(1000);
  }
}

await page.locator(SELECTOR).first().click({ timeout: 10_000 });
await page.waitForTimeout(800);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const shotPath = `${OUT}/click-${stamp}.png`;
await page.screenshot({ path: shotPath, fullPage: false, ...SNAP });

await browser.close();
console.log(JSON.stringify({
  ok: true,
  screenshot: shotPath.replace(/\\/g, '/'),
  selector: SELECTOR,
  appId: APP_ID || null,
  pageErrors,
}, null, 2));
