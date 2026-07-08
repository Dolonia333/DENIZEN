'use strict';

const { chromium, devices } = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:8080';

(async () => {
  const { loginOwner } = await import('./lib/probe-login.mjs');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${url}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(2500);

  const modal = await page.locator('#denizen-visitor-name-modal').count();
  console.log('modal visible:', modal > 0);

  if (modal > 0) {
    await loginOwner(page);
    await page.waitForTimeout(3000);
  }

  const state = await page.evaluate(() => ({
    modal: !!document.getElementById('denizen-visitor-name-modal'),
    canvas: !!document.querySelector('#game-container canvas'),
    browserChip: !!document.getElementById('denizen-browser-mirror-chip'),
    ceoShell: !!document.getElementById('denizen-ceo-shell'),
    ceoChip: !!document.getElementById('denizen-ceo-mode-chip'),
    ceoModeClass: document.documentElement.classList.contains('denizen-ceo-mode'),
    session: (() => {
      try { return JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}'); }
      catch { return {}; }
    })(),
    runtimeError: document.getElementById('runtime-error')?.textContent?.slice(0, 400) || '',
  }));

  console.log(JSON.stringify({ url, state, pageErrors }, null, 2));
  await browser.close();

  if (pageErrors.length || state.modal || !state.canvas || state.ceoShell || state.ceoChip || state.ceoModeClass) {
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
