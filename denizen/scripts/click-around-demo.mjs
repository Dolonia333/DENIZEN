// Click through Denizen phone apps + CRM back-link — saves screenshots after each step.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const OUT = 'reports/phone-ui/click-around';
fs.mkdirSync(OUT, { recursive: true });
const SNAP = { timeout: 8000, animations: 'disabled' };

const browser = await chromium.launch({ headless: false, slowMo: 400 });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const steps = [];

async function shot(label) {
  const path = `${OUT}/${label}.png`;
  await page.screenshot({ path, ...SNAP });
  steps.push({ label, screenshot: path });
  console.log(`  ✓ ${label}`);
}

await loginOwner(page, { baseUrl: BASE });
await shot('01-office');

await page.evaluate(() => window.DenizenPhoneUi?.open?.());
await page.waitForTimeout(800);
await shot('02-phone-home');

const apps = ['profile', 'chat', 'mesh', 'settings'];
for (const app of apps) {
  await page.evaluate(() => {
    window.DenizenPhoneUi?.open?.();
    if (window.DenizenPhoneUi?.currentApp?.()) {
      document.querySelector('#denizen-phone-frame .dzp-home')?.click();
    }
  });
  await page.waitForTimeout(600);
  await page.locator(`.dzp-app[data-app="${app}"]`).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await shot(`03-app-${app}`);
  if (app === 'profile') {
    await page.locator('[data-prof-tab="identity"]').click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(600);
    await shot('04-profile-identity');
  }
}

await page.goto(`${BASE}/crm/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2000);
await shot('05-crm');

console.log(JSON.stringify({ ok: true, steps }, null, 2));
await page.waitForTimeout(2000);
await browser.close();
