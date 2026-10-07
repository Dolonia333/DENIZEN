#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || '/tmp/denizen-bubbles');
fs.mkdirSync(outDir, { recursive: true });
const url = process.env.DENIZEN_URL || 'http://localhost:8080/office?demo=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript(() => {
  try {
    localStorage.setItem('denizen-onboarding-seen-v7-demo', '1');
    localStorage.setItem('denizen-demo-account-dismissed', '1');
    localStorage.setItem('denizen-demo-account-prompted', '1');
  } catch (_) {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 45000 });

async function clickFirst(sels) {
  for (const sel of sels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 1200 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

await clickFirst(['button:has-text("Just visiting")']);
try {
  const email = page.locator('#denizen-visitor-email-input').first();
  if (await email.isVisible({ timeout: 2500 })) {
    await email.fill('bubble-demo@denizen.local');
    await clickFirst(['button:has-text("Continue")']);
  }
} catch (_) {}
try {
  const name = page.locator('#denizen-visitor-name-input').first();
  if (await name.isVisible({ timeout: 2500 })) {
    await name.fill('Bubble');
    await clickFirst(['button:has-text("Continue")']);
  }
} catch (_) {}
await page.evaluate(() => {
  document.querySelectorAll('.vis-overlay, .vis-modal, #denizen-visitor-name-modal').forEach((el) => {
    if ((el.textContent || '').includes('HQ PASS') || (el.textContent || '').includes('Welcome')) {
      el.style.setProperty('display', 'none', 'important');
    }
  });
});

await page.waitForFunction(() => !!window.__DenizenAgentManager?.actions, { timeout: 30000 });
await page.waitForTimeout(2500);

const forced = await page.evaluate(() => {
  const m = window.__DenizenAgentManager;
  const a = m?.actions;
  if (!a?.speak) return { ok: false };
  const keys = [];
  m.agents.forEach((agent, key) => {
    if (agent?.assignedDesk) keys.push(key);
  });
  const pick = keys.slice(0, 5);
  const lines = [
    ['Looking that up…', 'thought'],
    ['Coffee for you.', 'speech'],
    ['Brief ready — OMES', 'speech'],
    ['On it.', 'speech'],
    ['Hmm.', 'thought'],
  ];
  // Bypass action queues — show bubbles immediately for the capture.
  pick.forEach((key, i) => {
    const [text, style] = lines[i % lines.length];
    const npc = a._getNpc?.(key);
    if (!npc || !a._showSpeechBubble) return;
    try { a._showSpeechBubble(npc, key, text, style, 10000); } catch (_) {}
  });
  // Two neighbors speaking at once exercises the side nudge.
  if (pick[0] && pick[1]) {
    const n0 = a._getNpc?.(pick[0]);
    const n1 = a._getNpc?.(pick[1]);
    try { if (n0) a._showSpeechBubble(n0, pick[0], 'Research ready.', 'speech', 10000); } catch (_) {}
    try { if (n1) a._showSpeechBubble(n1, pick[1], 'Thanks — sending it.', 'speech', 10000); } catch (_) {}
  }
  // Center camera on a speaker so the chip is fully in frame.
  try {
    const focus = a._getNpc?.(pick[1] || pick[0]);
    const cam = m.scene?.cameras?.main;
    if (focus && cam?.centerOn) cam.centerOn(focus.x, focus.y - 20);
  } catch (_) {}
  const live = [];
  a._speechBubbles?.forEach?.((v, k) => live.push({
    k,
    w: v.text?.width,
    h: v.text?.height,
    xOff: v.xOff,
    label: v.text?.text,
  }));
  return { ok: true, pick, live };
});
console.log('forced', JSON.stringify(forced, null, 2));
await page.waitForTimeout(400);

const shot = path.join(outDir, 'speech_bubbles_readable.png');
await page.screenshot({ path: shot, fullPage: false });
fs.copyFileSync(shot, '/opt/cursor/artifacts/screenshots/speech_bubbles_readable.png');
console.log('wrote', shot);

// Zoom crop around canvas if possible
const box = await page.locator('canvas').first().boundingBox();
if (box) {
  const crop = path.join(outDir, 'speech_bubbles_readable_crop.png');
  await page.screenshot({
    path: crop,
    clip: {
      x: Math.max(0, box.x + box.width * 0.15),
      y: Math.max(0, box.y + box.height * 0.05),
      width: Math.min(box.width * 0.7, 900),
      height: Math.min(box.height * 0.7, 560),
    },
  });
  fs.copyFileSync(crop, '/opt/cursor/artifacts/screenshots/speech_bubbles_readable_crop.png');
  console.log('wrote', crop);
}

await browser.close();
console.log('done');
