'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const DENIZEN_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 9876;
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

async function waitForSettingsChip(page) {
  await page.waitForFunction(() => {
    const chip = document.getElementById('denizen-llm-tel-chip');
    return chip && getComputedStyle(chip).display !== 'none';
  }, { timeout: 45_000 });
}

describe('mobile Settings panel e2e', () => {
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

  it('Settings chip opens and closes on iPhone landscape', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 13'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(4000);
    await waitForSettingsChip(page);

    await page.locator('#denizen-llm-tel-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('denizen-llm-tel-panel');
      return globalThis.DenizenLlmTelemetry?.isOpen?.() === true
        && panel
        && getComputedStyle(panel).display !== 'none';
    }, { timeout: 15_000 });

    const openState = await page.evaluate(() => ({
      open: globalThis.DenizenLlmTelemetry?.isOpen?.(),
      htmlOpen: document.documentElement.classList.contains('denizen-llm-tel-open'),
      toolbar: !!document.querySelector('#denizen-llm-tel-panel .tel-toolbar'),
      closeBtn: !!document.querySelector('#denizen-llm-tel-panel .close-btn'),
    }));
    assert.equal(openState.open, true);
    assert.equal(openState.htmlOpen, true);
    assert.equal(openState.toolbar, true);
    assert.equal(openState.closeBtn, true);

    await page.locator('#denizen-llm-tel-panel .close-btn').tap({ timeout: 10_000 });
    await page.waitForFunction(
      () => globalThis.DenizenLlmTelemetry?.isOpen?.() === false,
      { timeout: 10_000 },
    );

    await ctx.close();
  });

  it('small phone uses compact settings bottom sheet', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone SE'],
      viewport: { width: 667, height: 375 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(4000);
    await waitForSettingsChip(page);

    await page.locator('#denizen-llm-tel-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(
      () => globalThis.DenizenLlmTelemetry?.isOpen?.() === true,
      { timeout: 15_000 },
    );

    const phoneUi = await page.evaluate(() => {
      const panel = document.getElementById('denizen-llm-tel-panel');
      const style = panel ? getComputedStyle(panel) : null;
      const rect = panel?.getBoundingClientRect();
      const tier = globalThis.DenizenDeviceProfile?.tier?.() || '';
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        phone: document.documentElement.classList.contains('denizen-phone'),
        tier,
        grab: !!panel?.querySelector('.tel-grab'),
        borderRadius: style?.borderRadius || '',
        datasetPhone: panel?.dataset?.phone || '',
        datasetTier: panel?.dataset?.tier || '',
        panelWidth: rect?.width || 0,
        panelHeight: rect?.height || 0,
        left: rect?.left || 0,
        top: rect?.top || 0,
        rightGap: rect ? vw - rect.right : 0,
        bottomGap: rect ? vh - rect.bottom : 0,
        viewportWidth: vw,
        viewportHeight: vh,
        dockHidden: (() => {
          const dock = document.getElementById('denizen-bottom-dock');
          if (!dock) return false;
          const s = getComputedStyle(dock);
          return Number.parseFloat(s.opacity) < 0.05 || s.pointerEvents === 'none';
        })(),
      };
    });

    assert.equal(phoneUi.phone, true);
    assert.match(phoneUi.tier, /^phone/);
    assert.equal(phoneUi.datasetTier, phoneUi.tier);
    assert.equal(phoneUi.grab, true);
    assert.equal(phoneUi.datasetPhone, '1');
    assert.equal(phoneUi.dockHidden, true);
    assert.ok(phoneUi.panelWidth >= phoneUi.viewportWidth - 16);
    assert.ok(phoneUi.panelHeight >= phoneUi.viewportHeight - 20);
    assert.ok(phoneUi.left >= 4 && phoneUi.left <= 10);
    assert.ok(phoneUi.rightGap >= 4 && phoneUi.rightGap <= 10);

    await page.locator('#denizen-llm-tel-panel .tab[data-tab="stats"]').tap({ timeout: 10_000 });
    const statsTab = await page.evaluate(() => (
      document.querySelector('#denizen-llm-tel-panel .tab[data-tab="stats"]')?.dataset?.active
    ));
    assert.equal(statsTab, 'true');

    await ctx.close();
  });

  it('iPhone 14 landscape gets full inset settings shell like browser mirror', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(4000);
    await waitForSettingsChip(page);

    await page.locator('#denizen-llm-tel-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(
      () => globalThis.DenizenLlmTelemetry?.isOpen?.() === true,
      { timeout: 15_000 },
    );

    const ui = await page.evaluate(() => {
      const panel = document.getElementById('denizen-llm-tel-panel');
      const rect = panel?.getBoundingClientRect();
      const profile = globalThis.DenizenDeviceProfile?.get?.() || {};
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        tier: profile.tier,
        panelWidth: rect?.width || 0,
        panelHeight: rect?.height || 0,
        viewportWidth: vw,
        viewportHeight: vh,
        widthRatio: rect ? rect.width / vw : 0,
        heightRatio: rect ? rect.height / vh : 0,
        dockHidden: (() => {
          const dock = document.getElementById('denizen-bottom-dock');
          if (!dock) return false;
          const s = getComputedStyle(dock);
          return Number.parseFloat(s.opacity) < 0.05 || s.pointerEvents === 'none';
        })(),
      };
    });

    assert.equal(ui.tier, 'phone');
    assert.equal(ui.dockHidden, true);
    assert.ok(ui.panelWidth >= ui.viewportWidth - 16);
    assert.ok(ui.panelHeight >= ui.viewportHeight - 20);
    assert.ok(ui.widthRatio >= 0.96);
    assert.ok(ui.heightRatio >= 0.94);

    await ctx.close();
  });
});
