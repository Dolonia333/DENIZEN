// Mobile Buzz ring probe — demo guest path on iPhone viewport.
// Exercises Screenshot, Record, Meet, Apps, Say (+ hit-tests for FAB overlay).
// Usage: node scripts/buzz-ring-probe.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE_URL = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUT = 'reports/buzz-ring';
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(name);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function tapSel(page, sel) {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error(`no box for ${sel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function enterDemo(page) {
  await page.goto(`${BASE_URL}/office?demo=1&reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('[data-action="path-demo"]', { timeout: 30_000 });
  await tapSel(page, '[data-action="path-demo"]');
  await page.waitForSelector('#denizen-visitor-email-input', { timeout: 15_000 });
  await page.fill('#denizen-visitor-email-input', `buzz-probe-${Date.now()}@example.com`);
  await page.waitForTimeout(200);
  await tapSel(page, '[data-action="submit-demo-email"]');
  await page.waitForSelector('#denizen-visitor-name-input', { timeout: 15_000 });
  await page.fill('#denizen-visitor-name-input', 'Buzz Probe');
  await page.waitForTimeout(400);
  await tapSel(page, '[data-action="submit-name"]');
  await page.waitForFunction(() => {
    const m = document.getElementById('denizen-visitor-name-modal');
    return !m || getComputedStyle(m).display === 'none' || m.hidden;
  }, { timeout: 30_000 });
  await page.evaluate(() => {
    localStorage.setItem('denizen-onboarding-seen', '1');
    localStorage.setItem('denizen-onboarding-seen-v2', '1');
    localStorage.setItem('denizen-onboarding-seen-v7', '1');
    localStorage.setItem('denizen-onboarding-seen-v7-demo', '1');
    localStorage.setItem('denizen-onboarding-seen-v7-demo-anonymous', '1');
    localStorage.setItem('denizen-onboarding-seen-v7-team', '1');
    localStorage.setItem('denizen-onboarding-seen-v7-team-anonymous', '1');
  });
  await page.waitForTimeout(800);
  // Dismiss HQ tour / coach overlays so ring actions are unobstructed.
  for (let i = 0; i < 4; i += 1) {
    const skipped = await page.evaluate(() => {
      if (globalThis.DenizenVisitorOnboarding?.dismiss) {
        globalThis.DenizenVisitorOnboarding.dismiss();
        return true;
      }
      const skip = document.querySelector('.onb-skip, .su-skip, #denizen-visitor-onboarding .onb-skip');
      if (skip) { skip.click(); return true; }
      const overlay = document.getElementById('denizen-visitor-onboarding');
      if (overlay) { overlay.remove(); document.documentElement.classList.remove('denizen-onboarding-open'); return true; }
      return false;
    });
    if (!skipped) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
}

async function revealFab(page) {
  await page.evaluate(() => {
    document.documentElement.classList.add('denizen-corner-hud-open');
  });
  const hit = page.locator('#denizen-corner-hit-phone');
  if (await hit.count()) {
    await hit.tap({ timeout: 2000, force: true }).catch(() => {});
  }
  await page.waitForTimeout(250);
}

async function settle(page) {
  await page.evaluate(() => {
    globalThis.DenizenBuzzCapture?.closeNote?.();
    globalThis.DenizenBuzzCapture?.closeRing?.();
    globalThis.DenizenPhoneUi?.close?.();
  });
  await page.waitForTimeout(500);
}

async function openRing(page, { viaFab = false } = {}) {
  await settle(page);
  await revealFab(page);
  if (viaFab) {
    const box = await page.locator('#denizen-phone-fab').boundingBox();
    if (!box) throw new Error('FAB has no box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.evaluate(() => globalThis.DenizenBuzzCapture.openRing());
  }
  await page.waitForSelector('#denizen-buzz-ring.open', { timeout: 8_000 });
  await page.waitForTimeout(550);
}

async function hitTest(page, act) {
  return page.evaluate((actionId) => {
    const btn = document.querySelector(`#denizen-buzz-ring .bz-act[data-act="${actionId}"]`);
    if (!btn) return { ok: false, reason: 'missing' };
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const hits = !!(top && (top === btn || btn.contains(top) || top.closest?.(`[data-act="${actionId}"]`)));
    const fab = document.getElementById('denizen-phone-fab');
    return {
      ok: hits,
      reason: hits ? 'hit' : `blocked:${top?.id || String(top?.className) || top?.tagName}`,
      fabPe: fab && getComputedStyle(fab).pointerEvents,
      fabZ: fab && getComputedStyle(fab).zIndex,
      ringZ: getComputedStyle(document.getElementById('denizen-buzz-ring')).zIndex,
    };
  }, act);
}

async function tapAct(page, act) {
  const pos = await page.evaluate((actionId) => {
    const btn = document.querySelector(`#denizen-buzz-ring .bz-act[data-act="${actionId}"]`);
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, act);
  await page.touchscreen.tap(pos.x, pos.y);
}

async function noteState(page) {
  return page.evaluate(() => {
    const note = document.getElementById('denizen-buzz-note');
    return {
      note: !!note?.classList.contains('open'),
      meta: note?.querySelector('#bz-meta')?.textContent || '',
      kind: note?.dataset?.kind || null,
      stop: !!note?.querySelector('[data-note="stop"]'),
    };
  });
}

async function run() {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));

  await enterDemo(page);
  await page.screenshot({ path: `${OUT}/01-ready.png` });

  const ready = await page.evaluate(() => ({
    fab: getComputedStyle(document.getElementById('denizen-phone-fab')).display,
    buzz: !!globalThis.DenizenBuzzCapture?.toggleRing,
    phone: document.documentElement.classList.contains('denizen-phone'),
  }));
  check('phone UI ready', ready.fab !== 'none' && ready.buzz && ready.phone, JSON.stringify(ready));

  // FAB opens ring
  await openRing(page, { viaFab: true });
  await page.screenshot({ path: `${OUT}/02-ring-open.png` });
  check('FAB tap opens ring', true);

  const present = await page.evaluate(() =>
    [...document.querySelectorAll('#denizen-buzz-ring .bz-act')].map((b) => b.dataset.act));
  const expected = ['screenshot', 'record', 'dictate', 'meeting', 'phone'];
  check('phone ring has 5 actions', expected.every((id) => present.includes(id)) && present.length === 5, present.join(','));
  check('no desktop/ghost on phone', !present.includes('desktop') && !present.includes('invisible'));

  for (const act of expected) {
    const h = await hitTest(page, act);
    check(`hit-test ${act}`, h.ok, JSON.stringify(h));
  }

  // Screenshot — keep waitForEvent before the gesture; prefer button click so
  // Playwright treats it as a trusted file-chooser opener.
  await page.evaluate(() => globalThis.DenizenBuzzCapture?.closeRing?.());
  await openRing(page);
  await page.waitForTimeout(600); // past OPEN_GUARD so dismiss wiring is idle
  const chooserP = page.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
  await page.locator('#denizen-buzz-ring .bz-act[data-act="screenshot"]').click({ timeout: 8_000 });
  const chooser = await chooserP;
  if (chooser) {
    // Picker opened on the same gesture — success for mobile screenshot path.
    // Feed a tiny PNG so the flow continues into crop/note if desired.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const tmp = `${OUT}/probe-pixel.png`;
    fs.writeFileSync(tmp, png);
    await chooser.setFiles(tmp).catch(() => {});
    check('screenshot opens file picker', true);
    await page.waitForTimeout(800);
  } else {
    // Fallback: API path still invoked pickImageFile (input attached).
    const attached = await page.evaluate(() => !!document.querySelector('input[type="file"][accept="image/*"]'));
    const s = await page.evaluate(() => ({
      crop: !!document.getElementById('denizen-buzz-crop')?.classList.contains('open'),
      note: !!document.getElementById('denizen-buzz-note')?.classList.contains('open'),
    }));
    check('screenshot opens file picker', attached || s.crop || s.note, JSON.stringify({ attached, ...s }));
  }
  await page.screenshot({ path: `${OUT}/03-screenshot.png` });
  await page.evaluate(() => {
    globalThis.DenizenBuzzCapture?.closeCrop?.();
    globalThis.DenizenBuzzCapture?.closeNote?.();
    document.getElementById('denizen-buzz-crop')?.remove();
  });

  // Record
  await page.evaluate(() => { globalThis.DenizenBuzzCapture?.closeNote?.(); globalThis.DenizenBuzzCapture?.closeRing?.(); });
  await openRing(page);
  await tapAct(page, 'record');
  await page.waitForTimeout(1600);
  let st = await noteState(page);
  check('record starts capture UI', st.note || /record|mic|captur|listen|speak/i.test(st.meta), JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/04-record.png` });
  await page.evaluate(() => {
    document.querySelector('#denizen-buzz-note [data-note="stop"]')?.click?.();
    globalThis.DenizenBuzzCapture?.closeNote?.();
  });

  // Meet
  await page.evaluate(() => globalThis.DenizenBuzzCapture?.closeRing?.());
  await openRing(page);
  await tapAct(page, 'meeting');
  await page.waitForTimeout(2000);
  st = await noteState(page);
  check('meet starts mic session', st.note || /mic|meeting|record|permission/i.test(st.meta), JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/05-meet.png` });
  await page.evaluate(() => {
    document.querySelector('#denizen-buzz-note [data-note="stop"]')?.click?.();
    globalThis.DenizenBuzzCapture?.closeNote?.();
  });

  // Say (dictate)
  await page.evaluate(() => globalThis.DenizenBuzzCapture?.closeRing?.());
  await openRing(page);
  await tapAct(page, 'dictate');
  await page.waitForTimeout(2000);
  st = await noteState(page);
  check(
    'say/dictate opens note',
    st.note || /dictat|speech|speak|listen|record|type the note/i.test(st.meta),
    JSON.stringify(st),
  );
  await page.screenshot({ path: `${OUT}/06-say.png` });
  await page.evaluate(() => {
    document.querySelector('#denizen-buzz-note [data-note="stop"]')?.click?.();
    globalThis.DenizenBuzzCapture?.closeNote?.();
  });

  // Apps
  await page.evaluate(() => globalThis.DenizenBuzzCapture?.closeRing?.());
  await openRing(page);
  await tapAct(page, 'phone');
  await page.waitForTimeout(1000);
  const phone = await page.evaluate(() => ({
    shell: !!document.getElementById('denizen-phone-shell')?.classList.contains('open'),
    ring: !!document.getElementById('denizen-buzz-ring')?.classList.contains('open'),
  }));
  check('apps opens phone shell', phone.shell && !phone.ring, JSON.stringify(phone));
  await page.screenshot({ path: `${OUT}/07-apps.png` });

  await browser.close();
  console.log(`\n${failures.length ? `FAILED ${failures.length}\n${failures.join('\n')}` : 'ALL OK'}`);
  if (failures.length) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
