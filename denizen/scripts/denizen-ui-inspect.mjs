// Capture Denizen phone UI screenshots for agent/dev inspection.
// Usage:
//   node scripts/denizen-ui-inspect.mjs [baseUrl] [appId] [viewport]
// viewport: desktop (default) | iphone
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { loginOwner } from './lib/probe-login.mjs';

const BASE_URL = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const APP_ID = process.argv[3] || 'profile';
const VIEWPORT = process.argv[4] || 'desktop';
const OUT = 'reports/phone-ui/inspect';
fs.mkdirSync(OUT, { recursive: true });
const SNAP = { timeout: 10_000, animations: 'disabled' };

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1366, height: 768 },
  iphone: null,
};

const browser = await chromium.launch();
const ctxOpts = VIEWPORT === 'iphone'
  ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
  : { viewport: VIEWPORTS[VIEWPORT] || VIEWPORTS.desktop };
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await loginOwner(page, { baseUrl: BASE_URL });
await page.waitForTimeout(3000);
await page.evaluate(() => window.DenizenPhoneUi?.open?.());
await page.waitForTimeout(1000);

if (APP_ID !== 'home') {
  const tap = VIEWPORT === 'iphone';
  const appBtn = page.locator(`.dzp-app[data-app="${APP_ID}"]`);
  if (tap) await appBtn.tap({ timeout: 10_000 });
  else await appBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
}

const metrics = await page.evaluate((appId) => {
  const screen = document.getElementById('denizen-phone-screen')?.getBoundingClientRect();
  const panelMap = {
    profile: '#denizen-account-panel',
    chat: '#player-chat-panel',
    compute: '#denizen-node-ui-chip',
    mesh: '#denizen-mesh-jobs-panel',
    settings: '#denizen-phone-frame .dzp-settings',
    health: '#denizen-diag-panel',
    lm: '#denizen-llm-tel-panel',
    approvals: '#denizen-proposals-panel',
    browser: '#denizen-browser-mirror-panel',
    security: '#denizen-security-feed',
    voice: '#denizen-mic-button',
    presence: '#denizen-presence-chip',
    listen: '#denizen-audio-mode-chip',
  };
  const sel = panelMap[appId];
  const panelEl = sel ? document.querySelector(sel) : null;
  const panel = panelEl?.getBoundingClientRect();
  const cs = panelEl ? getComputedStyle(panelEl) : null;
  const overflow = panel && screen
    ? panel.right > screen.right + 2 || panel.left < screen.left - 2
      || panel.bottom > screen.bottom + 2
    : null;
  return {
    app: appId,
    currentApp: window.DenizenPhoneUi?.currentApp?.() || null,
    screen: screen ? {
      top: Math.round(screen.top),
      left: Math.round(screen.left),
      width: Math.round(screen.width),
      height: Math.round(screen.height),
    } : null,
    panel: panel ? {
      top: Math.round(panel.top),
      left: Math.round(panel.left),
      width: Math.round(panel.width),
      height: Math.round(panel.height),
      right: Math.round(panel.right),
      display: cs?.display,
      opacity: cs?.opacity,
    } : null,
    profileExpanded: document.getElementById('denizen-account-panel')?.dataset?.expanded === '1',
    hasProfileUi: !!document.getElementById('prof-shell'),
    overflow,
    inScreen: panel && screen
      ? Math.abs(panel.top - screen.top) <= 6 && Math.abs(panel.left - screen.left) <= 6
        && Math.abs(panel.width - screen.width) <= 6
      : null,
  };
}, APP_ID);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const shotPath = `${OUT}/${APP_ID}-${VIEWPORT}-${stamp}.png`;
await page.screenshot({ path: shotPath, fullPage: false, ...SNAP });

await browser.close();

const result = {
  ok: true,
  screenshot: shotPath.replace(/\\/g, '/'),
  metrics,
  viewport: VIEWPORT,
  pageErrors,
};
console.log(JSON.stringify(result, null, 2));
