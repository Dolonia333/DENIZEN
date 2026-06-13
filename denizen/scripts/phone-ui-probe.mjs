// Phone UI smoke check — desktop + iPhone contexts.
// Asserts: dock hidden, FAB present, shell opens, chat app renders inside the
// phone screen bounds, Home returns to the grid, legacy mode (?phonemode=0)
// still shows the dock. Saves screenshots to reports/phone-ui/.
// Usage: node scripts/phone-ui-probe.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const OUT = 'reports/phone-ui';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const failures = [];
const check = (name, cond) => { if (!cond) failures.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

async function loginCeo(page) {
  if (await page.locator('#denizen-visitor-name-modal').count() === 0) return;
  await page.locator('[data-action="path-ceo"]').click({ timeout: 15_000 });
  await page.locator('#denizen-visitor-code-input').fill('Dolonia');
  await page.locator('[data-action="submit-ceo-code"]').click({ timeout: 15_000 });
  await page.waitForFunction(() => !document.getElementById('denizen-visitor-name-modal'), { timeout: 30_000 });
}

async function flow(ctxName, ctx, tap) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await loginCeo(page);
  await page.waitForTimeout(5000);

  const click = (sel) => tap ? page.locator(sel).tap({ timeout: 10_000 }) : page.locator(sel).click({ timeout: 10_000 });

  const base = await page.evaluate(() => ({
    dockHidden: (() => { const d = document.getElementById('denizen-bottom-dock'); return d ? getComputedStyle(d).display === 'none' : false; })(),
    fabVisible: (() => { const f = document.getElementById('denizen-phone-fab'); return f && getComputedStyle(f).display !== 'none'; })(),
  }));
  check(`${ctxName}: dock hidden`, base.dockHidden);
  check(`${ctxName}: phone FAB visible`, base.fabVisible);

  await click('#denizen-phone-fab');
  await page.waitForSelector('#denizen-phone-shell.open', { timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/home-${ctxName}.png` });
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
  await page.screenshot({ path: `${OUT}/chat-${ctxName}.png` });

  await click('#denizen-phone-frame .dzp-home');
  await page.waitForTimeout(500);
  const home = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-denizen-phone-app'),
    gridShown: getComputedStyle(document.querySelector('.dzp-grid')).display !== 'none',
  }));
  check(`${ctxName}: Home returns to grid`, home.attr === null && home.gridShown);

  if (!tap) {
    // Desktop-only deep checks: compute visibility, Settings app, CEO-gated tours
    await click('.dzp-app[data-app="compute"]');
    await page.waitForTimeout(1200);
    const comp = await page.evaluate(() => {
      const el = document.getElementById('denizen-node-ui-chip');
      if (!el) return { ok: false };
      const cs = getComputedStyle(el);
      return { ok: cs.display !== 'none' && cs.opacity === '1' && cs.visibility === 'visible' };
    });
    check(`${ctxName}: compute panel visible (opacity 1)`, comp.ok);
    await click('#denizen-phone-frame .dzp-home');
    await page.waitForTimeout(400);

    await click('.dzp-app[data-app="settings"]');
    await page.waitForTimeout(500);
    const settings = await page.evaluate(() => ({
      shown: !!document.querySelector('#denizen-phone-frame .dzp-settings.show'),
      hasAbout: (document.querySelector('#denizen-phone-frame .dzp-settings')?.textContent || '').includes('Denizen OS'),
    }));
    check(`${ctxName}: Settings app renders`, settings.shown && settings.hasAbout);
    await page.screenshot({ path: `${OUT}/settings-${ctxName}.png` });
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

// Legacy escape hatch still works
const legacy = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lp = await legacy.newPage();
await lp.goto(`${BASE_URL}/?reset=1&phonemode=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginCeo(lp);
await lp.waitForTimeout(4000);
const leg = await lp.evaluate(() => ({
  dockShown: (() => { const d = document.getElementById('denizen-bottom-dock'); return d && getComputedStyle(d).display !== 'none'; })(),
  noFab: !document.getElementById('denizen-phone-fab'),
}));
check('legacy: dock visible with ?phonemode=0', leg.dockShown);
check('legacy: no phone FAB', leg.noFab);
await legacy.close();

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nPHONE UI OK');
process.exit(failures.length ? 1 : 0);
