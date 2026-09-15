// Phone UI smoke check — desktop + iPhone contexts.
// Asserts: no bottom dock, FAB present, shell opens, chat app renders inside
// the phone screen bounds, Home returns to the grid, ?phonemode=0 still boots
// with the tool chips mounted. Saves screenshots to reports/phone-ui/.
// Usage: node scripts/phone-ui-probe.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { loginOwner, assertOwnerProfile } from './lib/probe-login.mjs';

const BASE_URL = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const OUT = 'reports/phone-ui';
const SNAP = { timeout: 10_000, animations: 'disabled' };
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const failures = [];
const check = (name, cond) => { if (!cond) failures.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

async function flow(ctxName, ctx, tap) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await loginOwner(page);
  const owner = await assertOwnerProfile(page);
  check(`${ctxName}: owner session`, owner.ok);
  await page.waitForTimeout(3000);

  const click = (sel) => tap ? page.locator(sel).tap({ timeout: 10_000 }) : page.locator(sel).click({ timeout: 10_000 });

  const base = await page.evaluate(() => ({
    noDock: !document.getElementById('denizen-bottom-dock'),
    fabVisible: (() => { const f = document.getElementById('denizen-phone-fab'); return f && getComputedStyle(f).display !== 'none'; })(),
  }));
  check(`${ctxName}: no bottom dock`, base.noDock);
  check(`${ctxName}: phone FAB visible`, base.fabVisible);

  await click('#denizen-phone-fab');
  await page.waitForSelector('#denizen-phone-shell.open', { timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/home-${ctxName}.png`, ...SNAP });
  check(`${ctxName}: shell opens`, true);

  await click('.dzp-app[data-app="chat"]');
  await page.waitForTimeout(800);
  const chat = await page.evaluate(() => {
    const s = document.getElementById('denizen-phone-screen').getBoundingClientRect();
    const p = document.getElementById('player-chat-panel')?.getBoundingClientRect();
    return p ? {
      within: Math.abs(p.top - s.top) <= 4 && Math.abs(p.left - s.left) <= 4
        && Math.abs(p.width - s.width) <= 4 && Math.abs(p.height - s.height) <= 4,
    } : { within: false };
  });
  check(`${ctxName}: chat panel inside phone screen`, chat.within);
  await page.screenshot({ path: `${OUT}/chat-${ctxName}.png`, ...SNAP });

  await click('#denizen-phone-frame .dzp-home');
  await page.waitForTimeout(500);
  const home = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-denizen-phone-app'),
    gridShown: getComputedStyle(document.querySelector('.dzp-grid')).display !== 'none',
  }));
  check(`${ctxName}: Home returns to grid`, home.attr === null && home.gridShown);

  if (tap) {
    // Touch: Citizen ID opens full-screen drawer (not in-phone me shell)
    await click('.dzp-app[data-app="profile"]');
    await page.waitForSelector('html.denizen-drawer-open', { timeout: 12_000 });
    await page.waitForTimeout(800);
    const drawer = await page.evaluate(() => {
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const d = document.getElementById('denizen-mobile-drawer')?.getBoundingClientRect();
      const body = document.getElementById('denizen-mobile-drawer-body')?.getBoundingClientRect();
      const panel = document.getElementById('denizen-account-panel')?.getBoundingClientRect();
      const tabs = document.querySelectorAll('#denizen-mobile-drawer .drawer-tab').length;
      const gapBelow = d ? Math.round(vp.h - d.bottom) : null;
      const panelWidthPct = panel && body ? Math.round((panel.width / body.width) * 100) : 0;
      return {
        drawerFill: d ? gapBelow <= 2 && d.top <= 2 && Math.abs(d.width - vp.w) <= 4 : false,
        panelFullWidth: panelWidthPct >= 95,
        tabs,
        hasProfShell: !!document.getElementById('prof-shell'),
      };
    });
    check(`${ctxName}: drawer fills viewport`, drawer.drawerFill);
    check(`${ctxName}: Citizen ID panel full width`, drawer.panelFullWidth);
    check(`${ctxName}: drawer has Citizen ID | City Power tabs`, drawer.tabs === 2);
    check(`${ctxName}: profile UI loaded in drawer`, drawer.hasProfShell);
    await page.screenshot({ path: `${OUT}/drawer-profile-${ctxName}.png`, ...SNAP });

    await click('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]');
    await page.waitForTimeout(700);
    const computeDrawer = await page.evaluate(() => {
      const panel = document.getElementById('denizen-node-ui-chip')?.getBoundingClientRect();
      const body = document.getElementById('denizen-mobile-drawer-body')?.getBoundingClientRect();
      const panelWidthPct = panel && body ? Math.round((panel.width / body.width) * 100) : 0;
      const profileHidden = getComputedStyle(document.getElementById('denizen-account-panel')).display === 'none';
      return { panelFullWidth: panelWidthPct >= 95, profileHidden, nodeH: panel?.height || 0 };
    });
    check(`${ctxName}: City Power panel full width`, computeDrawer.panelFullWidth);
    check(`${ctxName}: City Power tab hides profile`, computeDrawer.profileHidden);
    check(`${ctxName}: City Power content visible`, computeDrawer.nodeH > 80);
    await page.screenshot({ path: `${OUT}/drawer-compute-${ctxName}.png`, ...SNAP });

    await click('#denizen-mobile-drawer .drawer-close');
    await page.waitForTimeout(500);
    await click('#denizen-phone-fab');
    await page.waitForSelector('#denizen-phone-shell.open', { timeout: 10_000 });
    await page.waitForTimeout(400);
  }

  if (!tap) {
    // Desktop-only deep checks: me shell, Settings app, CEO-gated tours
    await click('.dzp-app[data-app="profile"]');
    await page.waitForTimeout(1200);
    const profile = await page.evaluate(() => {
      const screen = document.getElementById('denizen-phone-screen')?.getBoundingClientRect();
      const meShell = document.querySelector('.dzp-me-shell.open')?.getBoundingClientRect();
      const panel = document.getElementById('denizen-account-panel')?.getBoundingClientRect();
      const shell = document.getElementById('prof-shell');
      const expanded = document.getElementById('denizen-account-panel')?.dataset?.expanded === '1';
      const bounds = meShell || panel;
      const overflow = bounds && screen
        ? Math.round(bounds.right - screen.right) > 2 || Math.round(bounds.left - screen.left) < -2
        : false;
      return {
        expanded,
        hasProfileUi: !!shell,
        hasMeShell: !!meShell,
        within: meShell && screen
          ? Math.abs(meShell.top - screen.top) <= 5
            && Math.abs(meShell.left - screen.left) <= 5
            && Math.abs(meShell.width - screen.width) <= 5
            && Math.abs(meShell.height - screen.height) <= 5
          : panel && screen
            ? Math.abs(panel.top - screen.top) <= 5
              && Math.abs(panel.left - screen.left) <= 5
              && Math.abs(panel.width - screen.width) <= 5
            : false,
        overflow,
        hasMeTabs: !!document.querySelector('.dzp-me-tab[data-tab="compute"]'),
      };
    });
    check(`${ctxName}: profile/me inside phone screen`, profile.within);
    check(`${ctxName}: profile expands with Citizen ID UI`, profile.expanded && profile.hasProfileUi);
    check(`${ctxName}: Citizen ID | City Power tabs`, profile.hasMeShell && profile.hasMeTabs);
    check(`${ctxName}: profile does not bleed past screen`, !profile.overflow);
    await page.screenshot({ path: `${OUT}/profile-${ctxName}.png`, ...SNAP });
    await click('#denizen-phone-frame .dzp-home');
    await page.waitForTimeout(400);

    await click('.dzp-app[data-app="compute"]');
    await page.waitForTimeout(800);
    const compute = await page.evaluate(() => {
      const meOpen = document.querySelector('.dzp-me-shell.open')?.dataset?.tab;
      const node = document.getElementById('denizen-node-ui-chip')?.getBoundingClientRect();
      return { meTab: meOpen, nodeVisible: node && node.width > 0 && node.height > 0 };
    });
    check(`${ctxName}: compute opens City Power tab`, compute.meTab === 'compute' && compute.nodeVisible);
    await page.screenshot({ path: `${OUT}/compute-${ctxName}.png`, ...SNAP });
    await click('#denizen-phone-frame .dzp-home');
    await page.waitForTimeout(400);

    await click('.dzp-app[data-app="settings"]');
    await page.waitForTimeout(500);
    const settings = await page.evaluate(() => ({
      shown: !!document.querySelector('#denizen-phone-frame .dzp-settings.show'),
      hasAbout: (document.querySelector('#denizen-phone-frame .dzp-settings')?.textContent || '').includes('Denizen OS'),
    }));
    check(`${ctxName}: Settings app renders`, settings.shown && settings.hasAbout);
    await page.screenshot({ path: `${OUT}/settings-${ctxName}.png`, ...SNAP });
    await click('#denizen-phone-frame .dzp-home');
    await page.waitForTimeout(400);

    // CEO can't use the tour replays — those apps must hide once scripts settle
    const gated = await page.waitForFunction(() => {
      const tour = document.querySelector('.dzp-app[data-app="tour"]');
      const meshtour = document.querySelector('.dzp-app[data-app="meshtour"]');
      return tour?.classList.contains('dzp-hidden') && meshtour?.classList.contains('dzp-hidden');
    }, { timeout: 40_000 }).then(() => true).catch(() => false);
    check(`${ctxName}: CEO-gated tour apps hidden`, gated);
  }

  await click('#denizen-phone-frame .dzp-close');
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => !document.getElementById('denizen-phone-shell')?.classList.contains('open'));
  check(`${ctxName}: phone closes`, closed);
  check(`${ctxName}: no page errors`, errors.length === 0);
  if (errors.length) console.log(`  errors: ${errors.join('; ')}`);
  await page.close();
}

// Desktop
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await flow('desktop', desk, false);
await desk.close();

// iPhone
const phone = await browser.newContext({
  ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await flow('iphone', phone, true);
await phone.close();

// ?phonemode=0 debug switch still boots (no phone, tool chips at fallback spots)
const legacy = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lp = await legacy.newPage();
await lp.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(lp);
await lp.waitForTimeout(4000);
const leg = await lp.evaluate(() => ({
  chipsMounted: !!document.getElementById('player-chat-fab'),
  noFab: !document.getElementById('denizen-phone-fab'),
}));
check('legacy: tool chips mount with ?phonemode=0', leg.chipsMounted);
check('legacy: no phone FAB', leg.noFab);
await legacy.close();

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nPHONE UI OK');
process.exit(failures.length ? 1 : 0);
