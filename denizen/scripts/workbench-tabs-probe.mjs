// Phone Workbench tab tap probe — iPhone touch context, no backend required.
// Loads touch-bind + work-rail in a denizen-phone shell stub and taps Crew/Inbox.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'workbench-tabs');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const harness = `<!doctype html>
<html class="denizen-phone">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <style>
    html, body { margin: 0; height: 100%; background: #050a14; }
    #denizen-phone-frame {
      position: relative; width: 100%; height: 100%;
      font-family: system-ui, sans-serif; color: #e2e8f0;
    }
    .dzp-settings.dzp-workbench {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      padding: 0; gap: 0; overflow: hidden; background: #060c18;
    }
    .dzp-settings button {
      border: 1px solid #334155; background: #0f172a; color: #cbd5e1;
      border-radius: 10px; cursor: pointer; font: 600 12px/1.2 system-ui, sans-serif;
      padding: 8px 14px; touch-action: manipulation;
    }
    .dzp-settings button:hover { border-color: #60a5fa; color: #dbeafe; }
    #dzp-workbench-host {
      flex: 1; min-height: 0; display: flex; flex-direction: column;
      position: relative; z-index: 2; pointer-events: auto;
    }
  </style>
</head>
<body>
  <div id="denizen-phone-frame">
    <div class="dzp-settings dzp-workbench show">
      <div id="dzp-workbench-host"></div>
    </div>
  </div>
  <script src="/src/touch-bind.js"></script>
  <script src="/src/work-rail.js"></script>
  <script>
    document.documentElement.classList.add('denizen-phone');
    const host = document.getElementById('dzp-workbench-host');
    globalThis.DenizenWorkRail.mountPhone(host);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(harness);
    return;
  }
  const filePath = path.join(ROOT, url.pathname.replace(/^\//, ''));
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

async function tapSel(page, sel) {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error(`no box for ${sel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 14'],
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/harness.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#denizen-work-rail-phone [data-tab="crew"]', { timeout: 10_000 });

const sizes = await page.evaluate(() => {
  const btn = document.querySelector('#denizen-work-rail-phone [data-tab="crew"]');
  const r = btn.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check('crew tab hit target >= 64x44', sizes.w >= 64 && sizes.h >= 44, JSON.stringify(sizes));

await page.screenshot({ path: path.join(OUT, '01-abby-default.png'), animations: 'disabled' });

await tapSel(page, '#denizen-work-rail-phone [data-tab="crew"]');
await page.waitForTimeout(300);
const afterCrew = await page.evaluate(() => ({
  active: document.querySelector('#denizen-work-rail-phone [data-tab].active')?.dataset?.tab,
  body: document.querySelector('#denizen-work-rail-phone [data-wr-body]')?.textContent?.slice(0, 80) || '',
}));
check('tap Crew activates crew tab', afterCrew.active === 'crew', afterCrew.active);
check('Crew body rendered', /Seated desks|Seat an AI/i.test(afterCrew.body), afterCrew.body);
await page.screenshot({ path: path.join(OUT, '02-crew-after-tap.png'), animations: 'disabled' });

await tapSel(page, '#denizen-work-rail-phone [data-tab="inbox"]');
await page.waitForTimeout(300);
const afterInbox = await page.evaluate(() => ({
  active: document.querySelector('#denizen-work-rail-phone [data-tab].active')?.dataset?.tab,
  body: document.querySelector('#denizen-work-rail-phone [data-wr-body]')?.textContent?.slice(0, 80) || '',
}));
check('tap Inbox activates inbox tab', afterInbox.active === 'inbox', afterInbox.active);
check('Inbox body rendered', /Approvals|Buzz drops|handoffs/i.test(afterInbox.body), afterInbox.body);
await page.screenshot({ path: path.join(OUT, '03-inbox-after-tap.png'), animations: 'disabled' });

await tapSel(page, '#denizen-work-rail-phone [data-tab="trail"]');
await page.waitForTimeout(250);
const afterTrail = await page.evaluate(() =>
  document.querySelector('#denizen-work-rail-phone [data-tab].active')?.dataset?.tab,
);
check('tap Trail activates trail tab', afterTrail === 'trail', afterTrail);

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nworkbench tabs probe passed');
