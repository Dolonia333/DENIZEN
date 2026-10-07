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

const url = process.env.DENIZEN_URL || 'http://localhost:8080/office?demo=1';
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
  if (/AgentManager|error|Error|theater|coffee|handoff|Furniture ready/i.test(t)) {
    console.log('[console]', t.slice(0, 220));
  }
});

async function clickFirst(sels, timeout = 1500) {
  for (const sel of sels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout });
        console.log('Clicked', sel);
        await page.waitForTimeout(500);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

console.log('Opening', url);
await page.addInitScript(() => {
  try {
    localStorage.setItem('denizen-onboarding-seen-v7-demo', '1');
    localStorage.setItem('denizen-demo-account-dismissed', '1');
    localStorage.setItem('denizen-demo-account-prompted', '1');
  } catch (_) {}
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 45000 });

await clickFirst(['button:has-text("Just visiting")', 'text=Just visiting']);
await page.waitForTimeout(800);

// Email step
try {
  const email = page.locator('#denizen-visitor-email-input').first();
  if (await email.isVisible({ timeout: 3000 })) {
    await email.fill('demo-theater@denizen.local');
    await clickFirst(['button:has-text("Continue")']);
    console.log('Submitted demo email');
  }
} catch (_) {}

// Name step
try {
  const name = page.locator('#denizen-visitor-name-input').first();
  if (await name.isVisible({ timeout: 4000 })) {
    await name.fill('Theater');
    await clickFirst(['button:has-text("Continue")']);
    console.log('Submitted demo name');
  }
} catch (_) {}

// Hide only the visitor modal roots — never touch #game-container / canvas parents.
await page.evaluate(() => {
  const ids = [
    'denizen-visitor-name-modal',
    'denizen-visitor-login-modal',
    'denizen-visitor-email-modal',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  }
  document.querySelectorAll('.vis-overlay, .vis-modal').forEach((el) => {
    if ((el.textContent || '').includes('HQ PASS')) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  document.documentElement.dataset.denizenModal = '';
});

await clickFirst(['button:has-text("Skip")', 'button:has-text("Got it")', 'button:has-text("Close")'], 800);
await page.waitForTimeout(4000);

await page.waitForFunction(
  () => typeof window.__DenizenRunWorkTheaterDemo === 'function'
    || typeof window.__DenizenAgentManager?.runWorkTheaterDemo === 'function',
  { timeout: 30000 },
);

const started = await page.evaluate(() => {
  if (typeof window.__DenizenRunWorkTheaterDemo === 'function') {
    return window.__DenizenRunWorkTheaterDemo();
  }
  return window.__DenizenAgentManager?.runWorkTheaterDemo?.() || { ok: false };
});
console.log('demo start', started);

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
  // Keep modals suppressed during the shoot.
  await page.evaluate(() => {
    document.querySelectorAll('.vis-overlay, .vis-modal, #denizen-visitor-name-modal').forEach((el) => {
      if ((el.textContent || '').includes('HQ PASS') || (el.textContent || '').includes('Welcome to Denizen')) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  });
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log('wrote', p, 'bytes', fs.statSync(p).size);
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
  const canvas = !!document.querySelector('#game-container canvas, canvas');
  return { ok: true, canvas, rows, strip: strip.slice(0, 12) };
});
fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));
console.log('probe', JSON.stringify({
  canvas: probe.canvas,
  strip: probe.strip,
  active: (probe.rows || []).filter((r) => /coffee|deliver|research|talking|break/i.test(r.status + (r.task || ''))).slice(0, 8),
}).slice(0, 800));

await context.close();
await browser.close();

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
