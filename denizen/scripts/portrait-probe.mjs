// Portrait phone layout smoke check (fresh emulated iPhone context).
// Asserts the crop-zoom portrait design: game pane ~50dvh tall, 16:9 wide
// (intentionally wider than the screen, centered, sides cropped), camera
// zoomed + following the player, rotate hint non-blocking.
// Usage: node scripts/portrait-probe.mjs [baseUrl]
import { chromium, devices } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:8080';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const gc = document.getElementById('game-container')?.getBoundingClientRect();
  const rotateHint = document.getElementById('denizen-rotate-hint');
  const cam = window.game?.scene?.scenes?.[0]?.cameras?.main;
  return {
    htmlClass: document.documentElement.className,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    container: gc ? { w: Math.round(gc.width), h: Math.round(gc.height), top: Math.round(gc.top), left: Math.round(gc.left) } : null,
    rotateHintBlocking: rotateHint ? getComputedStyle(rotateHint).pointerEvents !== 'none' : false,
    camZoom: cam?.zoom ?? null,
    camFollowing: !!cam?._follow,
  };
});

console.log(JSON.stringify({ state, errors }, null, 2));
await browser.close();

const c = state.container;
const aspectOk = c && Math.abs(c.w / c.h - 16 / 9) < 0.05;
const heightOk = c && c.h >= state.innerH * 0.35 && c.h <= state.innerH * 0.55;
const centeredOk = c && Math.abs(c.left - (state.innerW - c.w) / 2) <= 4;
const ok = c
  && aspectOk
  && heightOk
  && centeredOk
  && state.htmlClass.includes('denizen-portrait')
  && state.camZoom >= 1.5
  && state.camFollowing
  && !state.rotateHintBlocking
  && errors.length === 0;
console.log(ok ? 'PORTRAIT LAYOUT OK' : 'PORTRAIT LAYOUT BROKEN');
process.exit(ok ? 0 : 1);
