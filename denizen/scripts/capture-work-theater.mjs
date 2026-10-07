#!/usr/bin/env node
/**
 * Record office work theater: researching → coffee run → research handoff.
 * Usage: node scripts/capture-work-theater.mjs [outDir]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const outDir = path.resolve(process.argv[2] || '/tmp/denizen-work-theater');
fs.mkdirSync(outDir, { recursive: true });

const url = process.env.DENIZEN_URL || 'http://localhost:8080/?demo=1';
const videoDir = path.join(outDir, 'playwright-video');
fs.mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

page.on('console', (msg) => {
  const t = msg.text();
  if (/AgentManager|error|Error|theater|coffee|handoff/i.test(t)) {
    console.log('[console]', t.slice(0, 220));
  }
});

console.log('Opening', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
    if (await el.isVisible({ timeout: 700 })) {
      await el.click({ timeout: 1000 });
      console.log('Clicked', sel);
    }
  } catch (_) {}
}

// Dismiss HQ tour via localStorage + any skip UI
await page.evaluate(() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /onboarding|tour|hq/i.test(k)) localStorage.setItem(k, '1');
    }
    localStorage.setItem('denizen-onboarding-seen-v7-demo', '1');
  } catch (_) {}
});

await page.waitForSelector('canvas', { timeout: 45000 });
await page.waitForTimeout(8000);

// Kill remaining overlays
for (const sel of ['button:has-text("Skip")', 'button:has-text("Got it")', 'button:has-text("Close")']) {
  try {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 800 });
  } catch (_) {}
}

await page.waitForFunction(() => typeof window.__DenizenRunWorkTheaterDemo === 'function'
  || !!window.__DenizenAgentManager?.runWorkTheaterDemo, { timeout: 30000 });

const started = await page.evaluate(() => {
  if (typeof window.__DenizenRunWorkTheaterDemo === 'function') {
    return window.__DenizenRunWorkTheaterDemo();
  }
  return window.__DenizenAgentManager?.runWorkTheaterDemo?.() || { ok: false };
});
console.log('demo start', started);

// Capture key beats across the ~26s sequence (absolute delays from demo start)
const shots = [
  [2000, '01_researching.png'],
  [6000, '02_coffee_accept.png'],
  [12000, '03_coffee_carry.png'],
  [17000, '04_coffee_deliver.png'],
  [20000, '05_handoff_carry.png'],
  [26000, '06_handoff_done.png'],
];
let elapsed = 0;
for (const [at, name] of shots) {
  await page.waitForTimeout(Math.max(0, at - elapsed));
  elapsed = at;
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log('wrote', p);
}

const probe = await page.evaluate(() => {
  const m = window.__DenizenAgentManager;
  if (!m?.agents) return { ok: false };
  const rows = [];
  m.agents.forEach((agent, key) => {
    rows.push({
      key,
      name: agent.name,
      status: agent.status,
      task: agent.currentTask,
      mug: !!m.actions?._coffeeMugs?.has?.(key),
      brief: !!m.actions?._briefFolders?.has?.(key),
      clutter: m.actions?._deskClutter?.get?.(key)?.kinds || [],
    });
  });
  const strip = window.DenizenFloorStrip?.recent?.() || [];
  return { ok: true, rows, strip: strip.slice(0, 12) };
});
fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));
console.log('probe strip', JSON.stringify(probe.strip || []).slice(0, 500));

await context.close();
await browser.close();

// Find playwright webm and convert to mp4
const vids = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
if (!vids.length) {
  console.error('No playwright video found');
  process.exit(1);
}
const webm = path.join(videoDir, vids[0]);
const mp4 = path.join(outDir, 'office_work_theater_demo.mp4');
const artifactsMp4 = '/opt/cursor/artifacts/office_work_theater_demo.mp4';
await new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', [
    '-y', '-i', webm,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
    '-movflags', '+faststart',
    mp4,
  ], { stdio: 'inherit' });
  ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));
});
fs.copyFileSync(mp4, artifactsMp4);
console.log('wrote', mp4);
console.log('wrote', artifactsMp4);
console.log('done', outDir);
