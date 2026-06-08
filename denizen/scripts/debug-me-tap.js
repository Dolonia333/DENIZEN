'use strict';

const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9878;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const envFile = path.join(ROOT, '.env');
  const nodeArgs = fs.existsSync(envFile) ? ['--env-file', envFile, 'server.js'] : ['server.js'];
  const proc = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true,
  });

  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (await page.locator('#denizen-visitor-name-modal').count()) {
    await page.locator('[data-action="path-ceo"]').tap();
    await page.locator('#denizen-visitor-code-input').fill('Dolonia');
    await page.locator('[data-action="submit-ceo-code"]').tap();
    await page.waitForTimeout(5000);
  }

  await page.waitForSelector('#denizen-mobile-menu-btn', { timeout: 30000 });

  const snap = async (label) => {
    console.log(label, await page.evaluate(() => ({
      open: globalThis.DenizenMobileSidebar?.isOpen?.(),
      toggle: document.getElementById('denizen-drawer-toggle')?.checked,
      display: getComputedStyle(document.getElementById('denizen-mobile-drawer')).display,
      classOpen: document.documentElement.classList.contains('denizen-drawer-open'),
      btn: document.getElementById('denizen-mobile-menu-btn')?.textContent,
    })));
  };

  await snap('pre-tap');
  await page.locator('#denizen-mobile-menu-btn').tap();
  await page.waitForTimeout(800);
  await snap('post-tap');
  await page.evaluate(() => globalThis.DenizenMobileSidebar?.open?.());
  await page.waitForTimeout(300);
  await snap('api-open');

  await browser.close();
  proc.kill('SIGTERM');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
