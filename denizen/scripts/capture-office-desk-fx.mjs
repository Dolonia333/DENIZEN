#!/usr/bin/env node
/**
 * Capture the live office floor for desk-work FX visual proof.
 * Usage: node scripts/capture-office-desk-fx.mjs [outDir]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || '/tmp/denizen-office-shots');
fs.mkdirSync(outDir, { recursive: true });

const url = process.env.DENIZEN_URL || 'http://localhost:8080/?demo=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

page.on('console', (msg) => {
  const t = msg.text();
  if (/AgentManager|error|Error|Phaser|desk/i.test(t)) {
    console.log('[console]', t.slice(0, 240));
  }
});

console.log('Opening', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Dismiss common overlays if present
for (const sel of [
  'button:has-text("Enter")',
  'button:has-text("Play")',
  'button:has-text("Start")',
  'button:has-text("Continue")',
  'button:has-text("Skip")',
  'button:has-text("Spectate")',
  'button:has-text("Watch")',
  '[data-dismiss]',
  '.modal-close',
]) {
  try {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 })) {
      await el.click({ timeout: 1000 });
      console.log('Clicked', sel);
    }
  } catch (_) {}
}

// Wait for canvas + furniture ready
await page.waitForSelector('canvas', { timeout: 45000 });
await page.waitForTimeout(12000);

const canvasBox = await page.locator('canvas').first().boundingBox();
console.log('canvas', canvasBox);

const wide = path.join(outDir, 'office_floor_wide.png');
await page.screenshot({ path: wide, fullPage: false });
console.log('wrote', wide);

// Focus crop around canvas if we can find it
if (canvasBox) {
  const crop = path.join(outDir, 'office_canvas_focus.png');
  await page.screenshot({
    path: crop,
    clip: {
      x: Math.max(0, canvasBox.x),
      y: Math.max(0, canvasBox.y),
      width: Math.min(canvasBox.width, 1400),
      height: Math.min(canvasBox.height, 860),
    },
  });
  console.log('wrote', crop);
}

// Nudge camera if game exposes keys
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(1500);
const pan = path.join(outDir, 'office_floor_pan.png');
await page.screenshot({ path: pan, fullPage: false });
console.log('wrote', pan);

// Probe runtime state for seated + clutter
const probe = await page.evaluate(() => {
  const m = window.__DenizenAgentManager || null;
  if (!m?.agents) {
    return {
      ok: false,
      keys: Object.keys(window).filter((k) => /denizen|agent|office|phaser/i.test(k)).slice(0, 40),
    };
  }
  const rows = [];
  m.agents.forEach((agent, key) => {
    const sit = m.actions?._sittingNpcs?.has?.(key);
    const clutter = m.actions?._deskClutter?.get?.(key);
    const gem = m._statusGemFor?.(agent);
    rows.push({
      key,
      status: agent.status,
      sit: !!sit,
      load: m._deskLoadFor?.(agent, key),
      gem: gem?.kind,
      clutter: clutter?.kinds || [],
    });
  });
  return { ok: true, rows };
});
fs.writeFileSync(path.join(outDir, 'office_probe.json'), JSON.stringify(probe, null, 2));
console.log('probe', JSON.stringify(probe).slice(0, 1200));

await browser.close();
console.log('done', outDir);
