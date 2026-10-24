/**
 * Headed Playwright on laptop + review capture (screenshots + layout audit).
 * Usage: node laptop-playwright-visible.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { loginOwner, assertOwnerProfile } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || (console.error('Pass the Denizen base URL as argv[2] or set DENIZEN_URL'), process.exit(1))).replace(/\/$/, '');
const OUT = 'reports/laptop-ui';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now();

const launchOpts = {
  headless: false,
  slowMo: 300,
  args: ['--start-maximized', '--window-size=1366,768'],
};
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;

async function snap(page, name) {
  const path = `${OUT}/${stamp}-${name}.png`;
  await page.screenshot({ path, fullPage: false, animations: 'disabled' }).catch(() => {});
  return path;
}

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

console.log(JSON.stringify({ step: 'launch', base: BASE }));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await loginOwner(page, { baseUrl: BASE, timeoutMs: 60_000 });
await page.waitForTimeout(1000);

const shots = { office: await snap(page, '01-office') };
const owner = await assertOwnerProfile(page);

const phoneShell = page.locator('#denizen-phone-shell');
const phoneOpen = await phoneShell.evaluate((el) => el?.classList?.contains('open')).catch(() => false);
if (!phoneOpen) {
  await page.evaluate(() => globalThis.DenizenPhoneUi?.open?.());
}
await page.waitForSelector('#denizen-phone-frame .dzp-boot.done', { timeout: 15_000 }).catch(() => {});
await page.waitForSelector('#denizen-phone-frame .dzp-grid .dzp-app', { timeout: 15_000 });
await page.waitForTimeout(400);
shots.phone = await snap(page, '02-phone-home');

const homeAudit = await page.evaluate(() => {
  const frame = document.getElementById('denizen-phone-frame');
  const screen = document.getElementById('denizen-phone-screen');
  const dock = document.querySelector('#denizen-phone-frame .dzp-dock');
  const nav = document.querySelector('#denizen-phone-frame .dzp-nav');
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const dockR = r(dock);
  const screenR = r(screen);
  const navR = r(nav);
  const gap = dockR && screenR ? Math.round(screenR.y + screenR.h - (dockR.y + dockR.h)) : null;
  return { dock: dockR, screen: screenR, nav: navR, dockToScreenBottomGap: gap };
});

await page.locator('.dzp-app[data-app="profile"]').first().click({ timeout: 12_000 });
await page.waitForSelector('#denizen-phone-frame .dzp-me-shell.open', { timeout: 12_000 });
await page.waitForTimeout(800);
shots.profile = await snap(page, '03-citizen-id');

await page.locator('#denizen-phone-frame .dzp-me-tab[data-tab="compute"]').click({ timeout: 8_000 });
await page.waitForTimeout(800);
shots.compute = await snap(page, '04-city-power');

const audit = await page.evaluate(() => {
  const prof = document.querySelector('#prof-shell, .dzp-profile, [data-app-panel="profile"]');
  const frame = document.getElementById('denizen-phone-frame');
  const fab = document.getElementById('denizen-phone-fab');
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const overflow = (el) => {
    if (!el) return null;
    return { sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight };
  };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    phoneFrame: r(frame),
    fab: r(fab),
    dock: r(document.querySelector('#denizen-phone-frame .dzp-dock')),
    nav: r(document.querySelector('#denizen-phone-frame .dzp-nav')),
    screen: r(document.getElementById('denizen-phone-screen')),
    profileShell: r(prof),
    profileOverflow: overflow(prof),
    profileTabs: [...document.querySelectorAll('.prof-tab, .dzp-prof-tab, [data-prof-tab]')].map((t) => ({
      text: (t.textContent || '').trim().slice(0, 40),
      rect: r(t),
    })),
    visibleErrors: [...document.querySelectorAll('#denizen-vis-error:not([hidden]), .dzp-error:not([hidden])')]
      .map((e) => (e.textContent || '').trim()).filter(Boolean),
    sessionTier: globalThis.DenizenVisitorSession?.getProfile?.()?.tier ?? null,
  };
});

const review = {
  ok: true,
  stamp,
  base: BASE,
  owner,
  shots,
  homeAudit,
  audit,
  pageErrors,
};
fs.writeFileSync(`${OUT}/review-${stamp}.json`, JSON.stringify(review, null, 2));
console.log(JSON.stringify(review, null, 2));

await page.waitForTimeout(5000);
await browser.close();
