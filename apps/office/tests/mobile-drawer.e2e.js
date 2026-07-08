'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const DENIZEN_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 9877;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProc;
let browser;
let serverLog = '';

function startServer() {
  const envFile = path.join(DENIZEN_ROOT, '.env');
  const nodeArgs = fs.existsSync(envFile)
    ? ['--env-file', envFile, 'server.js']
    : ['server.js'];

  serverProc = spawn(process.execPath, nodeArgs, {
    cwd: DENIZEN_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProc.stdout?.on('data', (chunk) => { serverLog += chunk.toString(); });
  serverProc.stderr?.on('data', (chunk) => { serverLog += chunk.toString(); });
}

async function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc?.exitCode != null) {
      throw new Error(`Server exited (${serverProc.exitCode}):\n${serverLog.slice(-3000)}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}/api/health`);
}

async function loginCeo(page) {
  const modal = page.locator('#denizen-visitor-name-modal');
  if (await modal.count() === 0) return;
  await page.locator('[data-action="path-login"]').tap({ timeout: 15_000 });
  await page.locator('#denizen-visitor-username-input').fill('Dolonia');
  await page.locator('#denizen-visitor-password-input').fill('Dolonia');
  await page.locator('#denizen-visitor-team-code-input').fill('Dolonia');
  await page.locator('[data-action="submit-login"]').tap({ timeout: 15_000 });
  await page.waitForFunction(
    () => !document.getElementById('denizen-visitor-name-modal'),
    { timeout: 30_000 },
  );
}

async function openCitizenIdFromPhone(page) {
  const phoneBtn = page.locator('#denizen-phone-fab');
  await phoneBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await phoneBtn.tap({ timeout: 10_000 });

  const citizenId = page.locator('#denizen-phone-screen .dzp-app[data-app="profile"]');
  await citizenId.waitFor({ state: 'visible', timeout: 10_000 });
  await citizenId.tap({ timeout: 10_000 });

  await page.waitForFunction(
    () => globalThis.DenizenMobileSidebar?.isOpen?.() === true,
    { timeout: 10_000 },
  );
}

describe('mobile Me drawer e2e', () => {
  before(async () => {
    startServer();
    await waitForHealth();
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    if (serverProc && serverProc.exitCode == null) {
      serverProc.kill('SIGTERM');
      await new Promise((r) => serverProc.once('exit', r));
    }
  });

  it('Citizen ID opens and closes the profile drawer on iPhone landscape', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 13'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(3000);

    const phoneBtn = page.locator('#denizen-phone-fab');
    await phoneBtn.waitFor({ state: 'visible', timeout: 30_000 });

    const before = await page.evaluate(() => ({
      touch: document.documentElement.classList.contains('denizen-touch'),
      landscape: document.documentElement.classList.contains('denizen-landscape'),
      sidebar: !!globalThis.DenizenMobileSidebar,
      phoneBtn: !!document.getElementById('denizen-phone-fab'),
      drawer: !!document.getElementById('denizen-mobile-drawer'),
      open: globalThis.DenizenMobileSidebar?.isOpen?.() ?? null,
      runtimeError: document.getElementById('runtime-error')?.textContent?.slice(0, 500) || '',
    }));

    assert.equal(before.touch, true, 'expected denizen-touch class');
    assert.equal(before.landscape, true, 'expected landscape mode');
    assert.equal(before.phoneBtn, true, 'phone button should exist');
    assert.equal(before.drawer, true, 'drawer shell should exist');
    assert.equal(before.open, false, 'drawer should start closed');
    assert.equal(before.runtimeError, '', `runtime errors: ${before.runtimeError}`);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);

    await openCitizenIdFromPhone(page);

    await page.waitForFunction(() => {
      const drawer = document.getElementById('denizen-mobile-drawer');
      const apiOpen = globalThis.DenizenMobileSidebar?.isOpen?.();
      const title = drawer?.querySelector('.drawer-title')?.textContent || '';
      const tabs = drawer?.querySelectorAll('.drawer-tab').length || 0;
      const shown = drawer && getComputedStyle(drawer).display !== 'none';
      return apiOpen === true && shown && title.includes('Me') && tabs >= 2;
    }, { timeout: 10_000 });

    const openState = await page.evaluate(() => ({
      open: globalThis.DenizenMobileSidebar?.isOpen?.(),
      title: document.querySelector('#denizen-mobile-drawer .drawer-title')?.textContent || '',
      display: getComputedStyle(document.getElementById('denizen-mobile-drawer')).display,
      backdrop: getComputedStyle(document.getElementById('denizen-mobile-drawer-backdrop')).display,
      profileTab: document.querySelector('#denizen-mobile-drawer .drawer-tab[data-tab="profile"]')?.textContent || '',
      powerTab: document.querySelector('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]')?.textContent || '',
    }));

    assert.equal(openState.open, true);
    assert.match(openState.title, /Me/);
    assert.notEqual(openState.display, 'none');
    assert.notEqual(openState.backdrop, 'none');
    assert.match(openState.profileTab, /Citizen ID/);
    assert.match(openState.powerTab, /City Power/);

    await page.locator('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]').tap({ timeout: 10_000 });
    const computeTab = await page.evaluate(() => ({
      tab: document.getElementById('denizen-mobile-drawer')?.dataset?.tab,
      profileDisplay: getComputedStyle(document.getElementById('denizen-account-panel')).display,
      computeDisplay: getComputedStyle(document.getElementById('denizen-node-ui-chip')).display,
    }));
    assert.equal(computeTab.tab, 'compute');
    assert.equal(computeTab.profileDisplay, 'none');
    assert.notEqual(computeTab.computeDisplay, 'none');

    await page.locator('#denizen-mobile-drawer .drawer-close').tap({ timeout: 10_000 });

    await page.waitForFunction(
      () => globalThis.DenizenMobileSidebar?.isOpen?.() === false,
      { timeout: 10_000 },
    );

    await ctx.close();
  });

  it('small phone uses compact bottom sheet and 2-column stats', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone SE'],
      viewport: { width: 667, height: 375 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(3000);

    await openCitizenIdFromPhone(page);

    const phoneUi = await page.evaluate(() => {
      const root = document.documentElement;
      const drawer = document.getElementById('denizen-mobile-drawer');
      const drawerStyle = drawer ? getComputedStyle(drawer) : null;
      const toolbar = drawer?.querySelector('.drawer-toolbar');
      const panel = document.getElementById('denizen-account-panel');
      const stats = panel?.querySelector('.acct-stats');
      const toolbarRect = toolbar?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        phone: root.classList.contains('denizen-phone'),
        borderRadius: drawerStyle?.borderTopLeftRadius || '',
        statsLayout: stats ? getComputedStyle(stats).display : '',
        acctTopColumn: panel
          ? getComputedStyle(panel.querySelector('.acct-top')).flexDirection
          : '',
        toolbar: !!toolbar,
        grab: !!drawer?.querySelector('.drawer-grab'),
        panelNotWiderThanToolbar: !!(toolbarRect && panelRect && panelRect.width <= toolbarRect.width + 2),
      };
    });

    assert.equal(phoneUi.phone, true, 'expected denizen-phone class');
    assert.equal(phoneUi.toolbar, true, 'compact toolbar should exist');
    assert.equal(phoneUi.grab, true, 'grab handle should exist');
    assert.notEqual(phoneUi.borderRadius, '0px', 'phone drawer should have rounded top');
    assert.equal(phoneUi.statsLayout, 'flex', 'profile stats should stack vertically on phone');
    assert.equal(phoneUi.acctTopColumn, 'column', 'name and logout should stack on phone');
    assert.equal(phoneUi.panelNotWiderThanToolbar, true, 'profile card should not exceed tab bar width');

    await page.locator('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]').tap({ timeout: 10_000 });
    const computeUi = await page.evaluate(() => ({
      tab: document.getElementById('denizen-mobile-drawer')?.dataset?.tab,
      contribGrid: getComputedStyle(document.querySelector('#denizen-node-ui-chip .node-contrib-body')).display,
    }));
    assert.equal(computeUi.tab, 'compute');
    assert.equal(computeUi.contribGrid, 'grid');

    await ctx.close();
  });
});
