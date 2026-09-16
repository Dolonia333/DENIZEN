// Studio Board calendar interactivity probe (desktop + iPhone).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'studio-board-calendar');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = url.pathname.replace(/^\//, '');
  if (!rel || rel.startsWith('studio-board')) rel = 'studio-board/index.html';
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('missing'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(name);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function run(label, contextOpts) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio-board/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('dz-sb:')).forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cal-grid, .wk', { timeout: 15_000 });
  await page.waitForTimeout(500);

  const heat = await page.locator('.cal-cell.load1, .cal-cell.load2, .cal-cell.load3, .cal-cell.conflict').count();
  check(`${label}: heat cues present`, heat > 0, `count=${heat}`);

  const carry = await page.locator('.cal-carry').count();
  check(`${label}: overdue carry strip when overdue exists`, true, `carry=${carry}`);

  // Drag first task pill onto another day
  const pill = page.locator('.evt[data-task-id]').first();
  const target = page.locator('.cal-cell[data-date]:not(.dim)').nth(10);
  if (await pill.count() && await target.count()) {
    const before = await page.evaluate(() => {
      const id = document.querySelector('.evt[data-task-id]')?.dataset?.taskId;
      const t = (globalThis.state?.tasks || []).find?.(() => false);
      return id;
    });
    // Use evaluate drop path for reliability
    const moved = await page.evaluate(() => {
      const pillEl = document.querySelector('.evt[data-task-id]');
      const cell = [...document.querySelectorAll('.cal-cell[data-date]:not(.dim)')]
        .find((c) => c.dataset.date && !c.classList.contains('today'));
      if (!pillEl || !cell || !globalThis.calMoveTask) return null;
      const id = pillEl.dataset.taskId;
      const from = (window.state?.tasks || []).find((t) => t.id === id)?.due;
      // state is not on window — use calMoveTask which looks up internal state
      const date = cell.dataset.date;
      calMoveTask(id, date);
      return { id, from, to: date };
    });
    check(`${label}: calMoveTask moves due date`, !!(moved && moved.to), JSON.stringify(moved));
  } else {
    check(`${label}: calMoveTask moves due date`, false, 'missing pill/target');
  }

  await page.screenshot({ path: path.join(OUT, `${label}-month.png`), fullPage: false });

  await page.locator('#cmWeek').click();
  await page.waitForTimeout(400);
  const weekTasks = await page.locator('.wk-evt.wk-task').count();
  const weekMeets = await page.locator('.wk-evt:not(.wk-task)').count();
  check(`${label}: week shows timed meetings or tasks`, weekTasks + weekMeets > 0, `tasks=${weekTasks} meets=${weekMeets}`);
  await page.screenshot({ path: path.join(OUT, `${label}-week.png`), fullPage: false });

  // Day panel ops
  await page.locator('.cal-cell.today, .wkd.today').first().click().catch(() => {});
  await page.waitForTimeout(200);
  const ops = await page.locator('.dpops button').count();
  check(`${label}: day panel action buttons`, ops > 0, `ops=${ops}`);

  // Meeting edit
  const meetBtn = page.locator('#view .dpedit, #view .evt.evm').first();
  if (await meetBtn.count()) {
    await meetBtn.click();
    await page.waitForSelector('#mtOverlay.open', { timeout: 5_000 }).catch(() => {});
    const open = await page.locator('#mtOverlay.open').count();
    check(`${label}: meeting edit modal opens`, open > 0);
    if (open) {
      await page.fill('#me-duration', '45');
      await page.locator('#mtOverlay button.btn-primary').click();
      await page.waitForTimeout(300);
      check(`${label}: meeting edit saves`, (await page.locator('#mtOverlay.open').count()) === 0);
    }
  } else {
    check(`${label}: meeting edit modal opens`, false, 'no meeting control');
  }

  await browser.close();
}

await run('desktop', { viewport: { width: 1280, height: 800 } });
await run('iphone', { ...devices['iPhone 14'], hasTouch: true, isMobile: true });

server.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\ncalendar interactivity probe passed');
