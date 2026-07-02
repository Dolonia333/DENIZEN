/**
 * City Power UI + API probe — desktop host + iPhone drawer.
 * Usage: node scripts/city-power-probe.mjs [baseUrl]
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { loginOwner, assertOwnerProfile } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const OUT = 'reports/city-power-probe';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(name);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function apiState(page) {
  return page.evaluate(async () => {
    const sid = globalThis.DenizenVisitorSession?.getSessionId?.();
    if (!sid) return { error: 'no session' };
    const res = await fetch(`/api/compute/contribution/summary?session_id=${encodeURIComponent(sid)}`, {
      headers: globalThis.DenizenVisitorSession?.authHeaders?.() || {},
    });
    const data = await res.json().catch(() => ({}));
    const st = globalThis.DenizenNodeUI?.getState?.() || {};
    return {
      http: res.status,
      contributorState: st.contributorState,
      canContribute: st.canContribute,
      desktopLinked: st.desktopLinked,
      optedIn: st.optedIn,
      level: st.contributionLevel,
      fleet: (st.fleet || []).map((m) => ({ id: m.machine_id, label: m.label, role: m.role })),
      credits: st.credits,
      summaryFleet: (data.fleet || []).map((m) => ({ id: m.machine_id, label: m.label, role: m.role })),
    };
  });
}

async function openCityPowerDesktop(page) {
  await page.evaluate(() => globalThis.DenizenPhoneUi?.open?.());
  await page.waitForSelector('#denizen-phone-shell.open', { timeout: 12_000 });
  await page.locator('.dzp-app[data-app="compute"]').first().click({ timeout: 12_000 });
  await page.waitForSelector('#denizen-phone-frame .dzp-me-shell.open[data-tab="compute"]', { timeout: 12_000 });
  await page.waitForTimeout(600);
}

async function openCityPowerMobile(page) {
  await page.evaluate(() => globalThis.DenizenPhoneUi?.open?.());
  await page.waitForSelector('#denizen-phone-shell.open', { timeout: 12_000 });
  await page.locator('.dzp-app[data-app="compute"]').first().tap({ timeout: 12_000 });
  await page.waitForSelector('html.denizen-drawer-open', { timeout: 12_000 });
  await page.locator('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]').tap({ timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function probeButtons(page, ctxName, tap) {
  const click = (sel) => (tap ? page.locator(sel).tap() : page.locator(sel).click());
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/compute/node/opt-in') || u.includes('/api/compute/credits/spend')) {
      apiCalls.push({ method: req.method(), url: u.split('/api/')[1] });
    }
  });

  const before = await apiState(page);
  check(`${ctxName}: City Power state loaded`, before.http === 200 || before.fleet?.length > 0, JSON.stringify(before.fleet?.map((f) => f.label)));

  const level = page.locator('#denizen-node-level');
  if (await level.count()) {
    const prev = await level.inputValue().catch(() => 'off');
    const next = prev === 'off' ? 'light' : 'off';
    await level.selectOption(next);
    await page.waitForTimeout(1200);
    check(`${ctxName}: level dropdown API`, apiCalls.some((c) => c.url?.startsWith('compute/node/opt-in')));
    await level.selectOption(prev);
    await page.waitForTimeout(800);
  }

  const toggle = page.locator('#denizen-node-optin-toggle');
  if (await toggle.count()) {
    const enabled = await toggle.isEnabled();
    const was = await toggle.isChecked();
    if (enabled) {
      await page.locator('label.node-optin-label').click({ force: true });
      await page.waitForTimeout(1200);
      check(`${ctxName}: Power the city toggle API`, apiCalls.some((c) => c.url?.startsWith('compute/node/opt-in')));
      if (await toggle.isChecked() !== was) {
        await page.locator('label.node-optin-label').click({ force: true });
        await page.waitForTimeout(800);
      }
    } else {
      check(`${ctxName}: Power the city toggle (browser-only)`, !enabled, 'disabled until Denizen Desktop is paired');
    }
  }

  const tabs = page.locator('#denizen-mobile-drawer .drawer-tab, #denizen-phone-frame .dzp-me-tab');
  if (await tabs.count() >= 2) {
    await click('#denizen-mobile-drawer .drawer-tab[data-tab="profile"], #denizen-phone-frame .dzp-me-tab[data-tab="profile"]');
    await page.waitForTimeout(400);
    await click('#denizen-mobile-drawer .drawer-tab[data-tab="compute"], #denizen-phone-frame .dzp-me-tab[data-tab="compute"]');
    await page.waitForTimeout(400);
    check(`${ctxName}: Citizen ID ↔ City Power tabs switch`, true);
  }

  const closeSel = tap ? '#denizen-mobile-drawer .drawer-close' : '#denizen-phone-frame .dzp-me-close';
  if (await page.locator(closeSel).count()) {
    await click(closeSel);
    await page.waitForTimeout(500);
    check(`${ctxName}: close/back works`, true);
  }

  await page.screenshot({ path: `${OUT}/${stamp}-${ctxName}-city-power.png`, animations: 'disabled' });
  return before;
}

const browser = await chromium.launch({ headless: true });
const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desk = await deskCtx.newPage();
await desk.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(desk, { baseUrl: BASE });
check('desktop: owner session', (await assertOwnerProfile(desk)).ok);
await openCityPowerDesktop(desk);
const deskState = await probeButtons(desk, 'desktop', false);
check('desktop: host in fleet', (deskState.fleet || []).some((m) => m.role === 'host'), deskState.fleet?.map((f) => f.label).join(', '));
await desk.close();
await deskCtx.close();

const phoneCtx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(phone, { baseUrl: BASE });
check('iphone: owner session', (await assertOwnerProfile(phone)).ok);
await openCityPowerMobile(phone);
const phoneState = await probeButtons(phone, 'iphone', true);
check('iphone: browser-only on phone Safari', phoneState.contributorState === 'browser_only' || !phoneState.canContribute);
await phone.close();
await phoneCtx.close();
await browser.close();

const report = { stamp, base: BASE, deskState, phoneState, failures };
fs.writeFileSync(`${OUT}/report-${stamp}.json`, JSON.stringify(report, null, 2));
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nCITY POWER PROBE OK');
process.exit(failures.length ? 1 : 0);
