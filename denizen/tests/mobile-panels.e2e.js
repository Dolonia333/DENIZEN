'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const DENIZEN_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 9881;
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
  await page.locator('[data-action="path-ceo"]').tap({ timeout: 15_000 });
  await page.locator('#denizen-visitor-code-input').fill('Dolonia');
  await page.locator('[data-action="submit-ceo-code"]').tap({ timeout: 15_000 });
  await page.waitForFunction(
    () => !document.getElementById('denizen-visitor-name-modal'),
    { timeout: 30_000 },
  );
}

function assertBrowserShell(metrics, label) {
  assert.ok(metrics.width >= metrics.expectedWidth - 4, `${label}: width should fill viewport minus inset`);
  assert.ok(metrics.width <= metrics.expectedWidth + 4, `${label}: width should not exceed viewport minus inset`);
  assert.ok(metrics.height >= metrics.expectedHeight - 8, `${label}: height should fill viewport minus inset`);
  assert.ok(metrics.left >= 4 && metrics.left <= 10, `${label}: left inset should be ~6px`);
  assert.ok(metrics.top >= 4 && metrics.top <= 10, `${label}: top inset should be ~6px`);
  assert.ok(metrics.rightGap >= 4 && metrics.rightGap <= 10, `${label}: right inset should be ~6px`);
  assert.ok(metrics.bottomGap >= 4 && metrics.bottomGap <= 10, `${label}: bottom inset should be ~6px`);
  assert.ok(metrics.widthRatio >= 0.96, `${label}: should use most of landscape width`);
  assert.ok(metrics.heightRatio >= 0.94, `${label}: should use most of landscape height`);
}

describe('mobile dock panels match browser mirror sizing', () => {
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

  it('iPhone 14 landscape — browser mirror is full inset shell', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1&diag=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(5000);

    await page.waitForFunction(() => !!document.getElementById('denizen-browser-mirror-chip'), { timeout: 45_000 });
    await page.locator('#denizen-browser-mirror-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(() => document.getElementById('denizen-browser-mirror-panel')?.classList.contains('open'), { timeout: 15_000 });

    const browserUi = await page.evaluate(() => {
      const panel = document.getElementById('denizen-browser-mirror-panel');
      const rect = panel.getBoundingClientRect();
      const inset = 6;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        rightGap: vw - rect.right,
        bottomGap: vh - rect.bottom,
        widthRatio: rect.width / vw,
        heightRatio: rect.height / vh,
        expectedWidth: vw - inset * 2,
        expectedHeight: vh - inset * 2,
      };
    });
    assertBrowserShell(browserUi, 'browser mirror');

    await ctx.close();
  });

  it('iPhone 14 landscape — Settings matches browser inset shell', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(5000);

    await page.waitForFunction(() => !!document.getElementById('denizen-llm-tel-chip'), { timeout: 45_000 });
    await page.locator('#denizen-llm-tel-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(() => globalThis.DenizenLlmTelemetry?.isOpen?.() === true, { timeout: 15_000 });

    const settingsUi = await page.evaluate(() => {
      const panel = document.getElementById('denizen-llm-tel-panel');
      const rect = panel.getBoundingClientRect();
      const inset = 6;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const dock = document.getElementById('denizen-bottom-dock');
      const dockStyle = dock ? getComputedStyle(dock) : null;
      const dockHidden = dockStyle
        ? Number.parseFloat(dockStyle.opacity) < 0.05 || dockStyle.pointerEvents === 'none'
        : false;
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        rightGap: vw - rect.right,
        bottomGap: vh - rect.bottom,
        widthRatio: rect.width / vw,
        heightRatio: rect.height / vh,
        expectedWidth: vw - inset * 2,
        expectedHeight: vh - inset * 2,
        dockHidden,
        htmlOpen: document.documentElement.classList.contains('denizen-llm-tel-open'),
      };
    });

    assert.equal(settingsUi.htmlOpen, true);
    assert.equal(settingsUi.dockHidden, true);
    assertBrowserShell(settingsUi, 'settings');

    await ctx.close();
  });

  it('iPhone 14 landscape — diag panel matches browser inset shell', async () => {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loginCeo(page);
    await page.waitForTimeout(5000);

    await page.waitForFunction(() => !!document.getElementById('denizen-diag-chip'), { timeout: 45_000 });
    await page.locator('#denizen-diag-chip').tap({ timeout: 10_000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('denizen-diag-open'), { timeout: 15_000 });

    const diagUi = await page.evaluate(() => {
      const panel = document.getElementById('denizen-diag-panel');
      const rect = panel.getBoundingClientRect();
      const inset = 6;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        rightGap: vw - rect.right,
        bottomGap: vh - rect.bottom,
        widthRatio: rect.width / vw,
        heightRatio: rect.height / vh,
        expectedWidth: vw - inset * 2,
        expectedHeight: vh - inset * 2,
        open: panel.classList.contains('open'),
      };
    });

    assert.equal(diagUi.open, true);
    assertBrowserShell(diagUi, 'diag');

    await ctx.close();
  });
});
