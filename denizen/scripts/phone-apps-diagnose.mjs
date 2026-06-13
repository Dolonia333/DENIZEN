// Diagnostic: click EVERY phone app and record what actually happens.
// Usage: node scripts/phone-apps-diagnose.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const OUT = 'reports/phone-ui/diagnose';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
if (await page.locator('#denizen-visitor-name-modal').count()) {
  await page.locator('[data-action="path-ceo"]').click({ timeout: 15_000 });
  await page.locator('#denizen-visitor-code-input').fill('Dolonia');
  await page.locator('[data-action="submit-ceo-code"]').click({ timeout: 15_000 });
  await page.waitForFunction(() => !document.getElementById('denizen-visitor-name-modal'), { timeout: 30_000 });
}
await page.waitForTimeout(8000);

// What chips/panels exist at all?
const inventory = await page.evaluate(() => {
  const ids = [
    'player-chat-fab', 'player-chat-panel',
    'denizen-mic-button', 'denizen-presence-chip', 'denizen-audio-mode-chip',
    'denizen-diag-chip', 'denizen-diag-panel',
    'denizen-llm-tel-chip', 'denizen-llm-tel-panel',
    'denizen-mesh-jobs-chip', 'denizen-mesh-jobs-panel',
    'denizen-proposals-chip', 'denizen-proposals-panel',
    'denizen-browser-mirror-chip', 'denizen-browser-mirror-panel',
    'denizen-security-chip', 'denizen-security-feed',
    'denizen-account-panel', 'denizen-node-ui-chip',
    'denizen-onboarding-replay-chip', 'denizen-superuser-replay-chip', 'denizen-capabilities-guide-chip',
  ];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    out[id] = el ? getComputedStyle(el).display : 'MISSING';
  }
  return out;
});
console.log('--- element inventory (computed display, or MISSING) ---');
console.log(JSON.stringify(inventory, null, 2));

const appIds = ['chat', 'voice', 'presence', 'listen', 'health', 'lm', 'mesh',
  'approvals', 'browser', 'security', 'profile', 'compute'];

console.log('\n--- per-app click results ---');
for (const id of appIds) {
  // fresh: close phone fully between apps
  await page.evaluate(() => window.DenizenPhoneUi?.close?.());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.DenizenPhoneUi?.open?.());
  await page.waitForTimeout(300);
  await page.locator(`.dzp-app[data-app="${id}"]`).click({ timeout: 5_000 });
  await page.waitForTimeout(1600);
  const r = await page.evaluate((appId) => {
    const cur = window.DenizenPhoneUi?.currentApp?.();
    const attr = document.documentElement.getAttribute('data-denizen-phone-app');
    const ph = document.querySelector('#denizen-phone-frame .dzp-placeholder');
    const screen = document.getElementById('denizen-phone-screen')?.getBoundingClientRect();
    const panelSel = {
      chat: '#player-chat-panel', health: '#denizen-diag-panel', lm: '#denizen-llm-tel-panel',
      mesh: '#denizen-mesh-jobs-panel', approvals: '#denizen-proposals-panel',
      browser: '#denizen-browser-mirror-panel', security: '#denizen-security-feed',
      profile: '#denizen-account-panel', compute: '#denizen-node-ui-chip',
    }[appId];
    let panel = null;
    if (panelSel) {
      const el = document.querySelector(panelSel);
      if (el) {
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        panel = {
          display: cs.display, vis: cs.visibility, opacity: cs.opacity,
          rect: { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) },
          inScreen: screen ? (Math.abs(b.top - screen.top) <= 5 && Math.abs(b.left - screen.left) <= 5
            && Math.abs(b.width - screen.width) <= 5 && Math.abs(b.height - screen.height) <= 5) : false,
        };
      } else panel = 'MISSING';
    }
    return {
      currentApp: cur, attr,
      placeholder: ph?.classList.contains('show') ? ph.textContent : null,
      bouncedToGrid: cur === null,
      panel,
    };
  }, id);
  const ok = (id === 'voice' || id === 'presence' || id === 'listen')
    ? true // action apps judged separately
    : (r.currentApp === id && r.panel && r.panel !== 'MISSING' && r.panel.inScreen && !r.placeholder);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${OUT}/${id}.png` });
}

if (errors.length) {
  console.log('\n--- page errors ---');
  for (const e of errors) console.log(e);
}
await browser.close();
