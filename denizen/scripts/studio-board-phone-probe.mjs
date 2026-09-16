// Studio Board phone frame probe — iPhone viewport, calendar must stay in first screen.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'studio-board-phone');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = url.pathname.replace(/^\//, '');
  if (!rel || rel === 'studio-board' || rel === 'studio-board/') rel = 'studio-board/index.html';
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('missing');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(name);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 14'],
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/studio-board/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForSelector('.cal-grid, .cal-head', { timeout: 15_000 });
await page.waitForTimeout(400);

const layout = await page.evaluate(() => {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const cal = document.querySelector('.cal-grid, .cal-head')?.getBoundingClientRect();
  const newBtn = document.querySelector('.newbtn')?.getBoundingClientRect();
  const stats = document.getElementById('stats');
  const statsShown = stats && getComputedStyle(stats).display !== 'none' && stats.getClientRects().length > 0;
  const overviewOpen = !!document.getElementById('boardOverview')?.open;
  const pulse = document.getElementById('phonePulse');
  const pulseShown = pulse && getComputedStyle(pulse).display !== 'none';
  return {
    vp,
    calTop: cal ? Math.round(cal.top) : null,
    calVisibleInFrame: cal ? cal.top < vp.h * 0.72 && cal.bottom > 40 : false,
    newBtnRight: newBtn ? Math.round(newBtn.right) : null,
    newBtnInFrame: newBtn ? newBtn.right <= vp.w + 1 && newBtn.left >= -1 : false,
    statsShown,
    overviewOpen,
    pulseShown,
  };
});

check('calendar enters first viewport', layout.calVisibleInFrame, JSON.stringify({
  calTop: layout.calTop, h: layout.vp.h,
}));
check('overview collapsed by default on phone', !layout.overviewOpen && !layout.statsShown);
check('phone pulse visible', layout.pulseShown);
check('+ New button fully in frame', layout.newBtnInFrame, `right=${layout.newBtnRight} w=${layout.vp.w}`);

await page.screenshot({ path: path.join(OUT, '01-phone-calendar-in-frame.png'), fullPage: false });

await page.locator('#phoneOverviewBtn').tap();
await page.waitForTimeout(250);
const afterOpen = await page.evaluate(() => !!document.getElementById('boardOverview')?.open);
check('Overview toggle opens stats', afterOpen);
await page.screenshot({ path: path.join(OUT, '02-phone-overview-open.png'), fullPage: false });

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nstudio board phone frame probe passed');
