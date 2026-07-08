// Landscape phone UI diagnostics
import { chromium, devices } from 'playwright';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = process.argv[2] || 'http://localhost:8081';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 14'],
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(page);
await page.waitForTimeout(6000);
await page.evaluate(() => window.DenizenPhoneUi?.open?.());
await page.waitForTimeout(2000);

const home = await page.evaluate(() => {
  const rect = (el) => el ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } : null;
  const frame = document.getElementById('denizen-phone-frame');
  const screen = document.getElementById('denizen-phone-screen');
  const root = document.documentElement;
  const apps = [...document.querySelectorAll('.dzp-grid .dzp-app')].map((a) => ({
    label: a.querySelector('.dzp-app-label')?.textContent,
    h: a.getBoundingClientRect().height,
    visible: a.getBoundingClientRect().height > 0 && a.getBoundingClientRect().bottom <= screen.getBoundingClientRect().bottom,
  }));
  return {
    classes: [...root.classList].filter((c) => c.startsWith('denizen')),
    frame: rect(frame),
    screen: rect(screen),
    homescr: rect(document.querySelector('.dzp-homescr')),
    widget: rect(document.querySelector('.dzp-widget')),
    grid: rect(document.querySelector('.dzp-grid')),
    dock: rect(document.querySelector('.dzp-dock')),
    nav: rect(document.querySelector('.dzp-nav')),
    statusbar: rect(document.querySelector('.dzp-statusbar')),
    appCount: apps.length,
    appsVisible: apps.filter((a) => a.visible).length,
    apps,
    game: rect(document.getElementById('game-container')),
    vars: {
      dzpW: getComputedStyle(root).getPropertyValue('--dzp-screen-w'),
      dzpH: getComputedStyle(root).getPropertyValue('--dzp-screen-h'),
    },
  };
});
console.log('HOME', JSON.stringify(home, null, 2));
if (home.grid?.h < 120) {
  console.error(`FAIL: grid too short (${home.grid?.h}px)`);
  process.exitCode = 1;
}
if (home.appsVisible < 8) {
  console.error(`FAIL: only ${home.appsVisible} apps visible`);
  process.exitCode = 1;
}

await page.evaluate(() => window.DenizenPhoneUi.openApp('chat'));
await page.waitForTimeout(1500);

const chat = await page.evaluate(() => {
  const rect = (el) => el ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top } : null;
  const screen = document.getElementById('denizen-phone-screen');
  const panel = document.getElementById('player-chat-panel') || document.querySelector('[id*="chat"]');
  const root = document.documentElement;
  return {
    app: root.getAttribute('data-denizen-phone-app'),
    screen: rect(screen),
    panel: rect(panel),
    panelId: panel?.id || null,
    vars: {
      dzpW: getComputedStyle(root).getPropertyValue('--dzp-screen-w'),
      dzpH: getComputedStyle(root).getPropertyValue('--dzp-screen-h'),
    },
  };
});
console.log('CHAT', JSON.stringify(chat, null, 2));

await browser.close();
