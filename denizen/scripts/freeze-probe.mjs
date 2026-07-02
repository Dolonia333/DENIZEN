/**
 * Diagnose player/NPC freeze — snapshots Phaser state over ~40s after load.
 * Usage: node scripts/freeze-probe.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = (process.argv[2] || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const OUT = 'reports/freeze-probe.json';
const SAMPLE_MS = [5000, 20000, 67000, 180000, 185000, 300000];

function snap(page, label) {
  return page.evaluate((lbl) => {
    const sc = window.game?.scene?.scenes?.[0];
    const loop = window.game?.loop;
    const p = sc?.player;
    return {
      label: lbl,
      ts: Date.now(),
      url: location.href,
      phaser: !!window.Phaser,
      game: !!window.game,
      inputEnabled: window.game?.input?.enabled,
      modalOpen: document.documentElement.dataset.denizenModal === 'open',
      onboardingOpen: document.documentElement.dataset.denizenOnboarding === 'open',
      inputBlockedFlag: !!window.__DenizenGameInputBlocked,
      loopPaused: !!loop?.isPaused,
      loopRunning: loop?.running,
      sceneActive: sc?.scene?.isActive?.(),
      hasPlayer: !!p,
      playerPos: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
      playerVel: p?.body ? { x: p.body.velocity?.x, y: p.body.velocity?.y } : null,
      playerLocked: sc?.playerLocked,
      playerOnPhone: sc?._playerOnPhone,
      playerSitting: sc?._playerSitting,
      hasCursors: !!sc?.cursors,
      editorActive: !!window.__DenizenEditorActive,
      rawMove: { ...(window.__DenizenRawMoveKeys || {}) },
      npcCount: sc?.npcs?.length ?? 0,
      npcMoving: Array.isArray(sc?.npcs)
        ? sc.npcs.filter((n) => Math.abs(n.body?.velocity?.x || 0) > 2 || Math.abs(n.body?.velocity?.y || 0) > 2).length
        : 0,
      activeElement: document.activeElement?.tagName + (document.activeElement?.id ? `#${document.activeElement.id}` : ''),
      classes: [...document.documentElement.classList],
      runtimeError: document.getElementById('runtime-error')?.textContent?.slice(0, 300) || '',
    };
  }, label);
}

async function moveProbe(page) {
  const before = await snap(page, 'move_before');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const after = await snap(page, 'move_after');
  const moved = before.playerPos && after.playerPos
    && (Math.abs(after.playerPos.x - before.playerPos.x) > 3
      || Math.abs(after.playerPos.y - before.playerPos.y) > 3);
  return { before, after, moved };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

const report = { base: BASE, errors: [], snapshots: [], moveProbes: [] };
const t0 = Date.now();

try {
  await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await loginOwner(page).catch((e) => { report.loginError = String(e?.message || e); });

  for (const ms of SAMPLE_MS) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    report.snapshots.push(await snap(page, `t_${ms}ms`));
    if (ms === 67000 || ms === 180000 || ms === 185000 || ms === 300000) {
      report.moveProbes.push({ atMs: ms, ...(await moveProbe(page)) });
    }
  }

  report.errors = errors;
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  report.fatal = String(e?.message || e);
  console.error(report.fatal);
  process.exitCode = 1;
} finally {
  await browser.close();
}
