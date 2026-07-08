/**
 * Meridian CRM — comprehensive QA checklist (Phases 1–5).
 * Usage: node scripts/crm-qa-checklist.mjs [baseUrl]
 * Spawns a local static server when baseUrl is omitted.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../crm/dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startCrmServer(port = 4173) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || '/').split('?')[0];
      if (urlPath.startsWith('/crm')) urlPath = urlPath.slice(4) || '/index.html';
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = path.resolve(DIST, `.${urlPath}`);
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(DIST, 'index.html'), (err2, html) => {
            if (err2) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(html);
          });
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${port}/crm/` });
    });
  });
}

let localServer = null;
let BASE = (process.argv[2] || '').replace(/\/?$/, '/');
if (!process.argv[2]) {
  localServer = await startCrmServer();
  BASE = localServer.base;
}
const OUT = 'reports/crm-qa';
fs.mkdirSync(OUT, { recursive: true });

/** Sidebar labels use industry terminology — include aliases per nav id. */
const NAV_ITEMS = [
  { id: 'dashboard', labels: ['Dashboard'] },
  { id: 'contacts', labels: ['Contacts', 'Patients', 'Clients'] },
  { id: 'sales', labels: ['Sales', 'Pipeline'] },
  { id: 'schedule', labels: ['Schedule'] },
  { id: 'companies', labels: ['Companies', 'Accounts', 'Medical Facilities'] },
  { id: 'notes', labels: ['Notes'] },
  { id: 'sequences', labels: ['Sequences'] },
  { id: 'packages', labels: ['Packages'] },
  { id: 'intake', labels: ['Proposals & Intake'] },
  { id: 'email-templates', labels: ['Email Templates'] },
  { id: 'automations', labels: ['Automations'] },
  { id: 'analytics', labels: ['Analytics'] },
  { id: 'ai-prospector', labels: ['AI Prospector'] },
  { id: 'ai', labels: ['AI'] },
  { id: 'portal', labels: ['Portal'] },
  { id: 'data-tools', labels: ['Data Management'] },
  { id: 'onboarding', labels: ['Setup'] },
  { id: 'settings', labels: ['Settings'] },
];

const failures = [];
const passes = [];
const consoleErrors = [];

const check = (phase, name, cond, detail = '') => {
  const ok = !!cond;
  const line = `${phase} | ${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passes.push(line);
    console.log(`PASS ${line}`);
  } else {
    failures.push(line);
    console.error(`FAIL ${line}`);
  }
};

async function clearMeridianStorage(page) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('meridian_')) localStorage.removeItem(k);
    }
  });
}

async function clickSidebar(page, item) {
  if (!item) return false;
  const { id, labels } = item;
  for (const label of labels) {
    const nav = page.locator('aside nav button.crm-nav-pill', { hasText: label }).first();
    if (await nav.count()) {
      await nav.click();
      return true;
    }
  }
  await page.evaluate((tabId) => {
    window.dispatchEvent(new CustomEvent('crm-navigate', { detail: tabId }));
  }, id);
  return true;
}

async function mainIsPopulated(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return !!(main && main.innerText.trim().length > 20);
  });
}

async function openAddContactModal(page) {
  const launcher = page.getByTitle(/tools — drag to reposition/i);
  if (await launcher.count()) {
    await launcher.click({ force: true });
    await page.waitForTimeout(400);
  }
  const addBtn = page.getByTitle(/quick add/i);
  if (await addBtn.count()) {
    await addBtn.click({ force: true });
  } else {
    const plus = page.getByRole('button', { name: '+' }).last();
    if (await plus.count()) await plus.click({ force: true });
  }
  await page.waitForTimeout(400);
  const item = page.getByRole('button', { name: /create contact|new contact/i });
  if (await item.count()) await item.first().click({ force: true });
  await page.waitForTimeout(500);
  return (await page.locator('h2').filter({ hasText: /new/i }).count()) > 0;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (e) => consoleErrors.push(e.message));

console.log(`Meridian CRM QA @ ${BASE}`);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2500);
await clearMeridianStorage(page);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// ─── PHASE 1 ───
check('P1', 'CRM shell loads', await mainIsPopulated(page));

for (const item of NAV_ITEMS) {
  await clickSidebar(page, item);
  await page.waitForTimeout(700);
  const ok = await mainIsPopulated(page);
  check('P1', `Sidebar: ${item.id}`, ok);
}

// Mobile drawer
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const menuBtn = page.getByRole('button', { name: '☰' });
check('P1', 'Mobile hamburger visible', await menuBtn.count() > 0);
if (await menuBtn.count()) {
  await menuBtn.click();
  await page.waitForTimeout(400);
  const drawerOpen = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    return aside && getComputedStyle(aside).transform !== 'matrix(1, 0, 0, 1, -220, 0)';
  });
  check('P1', 'Mobile drawer opens', drawerOpen);
  await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'settings'));
  await page.waitForTimeout(500);
  const drawerClosed = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    return aside && getComputedStyle(aside).transform.includes('-220');
  });
  check('P1', 'Mobile drawer closes after nav', drawerClosed);
}

await page.setViewportSize({ width: 1280, height: 900 });
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'dashboard'));
await page.waitForTimeout(600);

const allTasks = page.getByRole('button', { name: 'All tasks →' });
check('P1', 'Dashboard All tasks link present', await allTasks.count() > 0);
if (await allTasks.count()) {
  await allTasks.click();
  await page.waitForTimeout(400);
  const slideOpen = await page.getByRole('heading', { name: 'All Tasks' }).isVisible().catch(() => false);
  check('P1', 'Task slide-over opens', slideOpen);
  await page.getByRole('button', { name: '✕' }).first().click();
  await page.waitForTimeout(300);
  const slideClosed = !(await page.getByRole('heading', { name: 'All Tasks' }).isVisible().catch(() => false));
  check('P1', 'Task slide-over closes', slideClosed);
  check('P1', 'Dashboard still interactive after slide-over', await mainIsPopulated(page));
}

// ─── PHASE 2 ───
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'contacts'));
await page.waitForTimeout(500);
const modalOpened = await openAddContactModal(page);
check('P2', 'Add contact modal opens', modalOpened);

const QA_NAME = `QA Contact ${Date.now()}`;
const QA_EDITED = `${QA_NAME} Edited`;
if (modalOpened) {
  const modal = page.locator('[role="dialog"]');
  await modal.locator('input:not([type="file"]):not([type="hidden"])').first().fill(QA_NAME);
  const addBtn = modal.getByRole('button', { name: /add contact/i });
  await addBtn.click();
  await page.waitForTimeout(600);
  check('P2', 'Contact appears in list', await page.getByText(QA_NAME).count() > 0);

  const contactRow = page.locator('tr, [style*="cursor: pointer"]').filter({ hasText: QA_NAME }).first();
  const editBtn = contactRow.locator('button', { hasText: '✎' });
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForTimeout(400);
    await page.locator('[role="dialog"] input:not([type="file"]):not([type="hidden"])').first().fill(QA_EDITED);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(600);
    check('P2', 'Contact edit updates UI', await page.getByText(QA_EDITED).count() > 0);
  } else {
    check('P2', 'Contact edit updates UI', false, 'edit button not found');
  }

  const storedBefore = await page.evaluate((name) => {
    const raw = localStorage.getItem('meridian_contacts');
    return raw && raw.includes(name);
  }, QA_EDITED);
  check('P2', 'Contact persisted to localStorage', storedBefore);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'contacts'));
  await page.waitForTimeout(500);
  check('P2', 'Contact survives hard refresh', await page.getByText(QA_EDITED).count() > 0);

  const row = page.locator('.crm-contact-row').filter({ hasText: QA_EDITED });
  const delBtn = row.locator('button', { hasText: '✕' });
  if (await delBtn.count()) {
    await delBtn.click();
    await page.waitForTimeout(200);
    await row.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForTimeout(500);
    check('P2', 'Contact deleted from list', await page.locator('.crm-contact-row').filter({ hasText: QA_EDITED }).count() === 0);
  } else {
    check('P2', 'Contact deleted from list', false, 'delete button not found');
  }
  check('P2', 'Contacts list renders after delete (no crash)', await mainIsPopulated(page));
}

// ─── PHASE 3 ───
await page.evaluate(() => {
  localStorage.setItem('meridian_tasks', JSON.stringify([]));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'dashboard'));
await page.waitForTimeout(500);

const emptyMsg = await page.getByText(/all caught up/i).count() > 0;
check('P3', 'Tasks Due empty state message', emptyMsg);
const emptyHeight = await page.evaluate(() => {
  const el = [...document.querySelectorAll('main *')].find((n) => n.textContent?.includes('All caught up'));
  return el ? el.getBoundingClientRect().height : 0;
});
check('P3', 'Empty state has visible height', emptyHeight > 20, `height=${emptyHeight}`);

// Seed follow-up reminder data
await page.evaluate(() => {
  const old = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const contacts = [{
    id: 9001, name: 'FollowUp QA', company: 'TestCo', email: 'fu@test.com', phone: '',
    status: 'Lead', tags: [], score: 60, lastContact: old, interactions: 1,
  }];
  const deals = [{
    id: 9002, title: 'FollowUp Deal', contact: 'FollowUp QA', value: 5000,
    stage: 'Lead', probability: 20, closeDate: '2026-12-31', daysInStage: 14, health: 'good',
  }];
  localStorage.setItem('meridian_contacts', JSON.stringify(contacts));
  localStorage.setItem('meridian_deals', JSON.stringify(deals));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'dashboard'));
await page.waitForTimeout(500);
const reminderRow = page.locator('.crm-followup-row').first();
if (await reminderRow.count()) {
  await reminderRow.hover();
  await reminderRow.focus();
  await page.waitForTimeout(400);
  const snooze = reminderRow.getByRole('button', { name: /snooze/i });
  if (await snooze.count()) {
    await snooze.click({ force: true });
    await page.waitForTimeout(500);
    check('P3', 'Snooze removes follow-up reminder', await page.locator('.crm-followup-row').count() === 0);
  } else {
    check('P3', 'Snooze removes follow-up reminder', false, 'Snooze button not visible');
  }
} else {
  check('P3', 'Follow-up reminder row seeded', false, 'row not found');
}

await page.evaluate(() => {
  const tasks = Array.from({ length: 15 }, (_, i) => ({
    id: 10000 + i,
    title: `Scroll Task ${i + 1}`,
    contact: 'Test',
    due: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10),
    priority: 'Medium',
    done: false,
  }));
  localStorage.setItem('meridian_tasks', JSON.stringify(tasks));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const scrollInfo = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('main div')].find((el) => {
    const s = getComputedStyle(el);
    return s.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 10
      && el.textContent?.includes('Scroll Task');
  });
  return panel ? { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight } : null;
});
check('P3', 'Tasks panel scrolls with 15 tasks', !!scrollInfo, scrollInfo ? '' : 'no overflow container');

// Sales: Production Pipeline → Sales Hub sub-tab switch (regression)
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'sales'));
await page.waitForTimeout(600);
const subNav = page.locator('main').locator('button').filter({ hasText: /^(◆|📊|🎯|🏆)/ });
const pipelinePill = page.locator('main button').filter({ hasText: /pipeline/i }).first();
if (await pipelinePill.count()) await pipelinePill.click();
await page.waitForTimeout(500);
const hubPill = page.locator('main button').filter({ hasText: /sales hub|care hub|wealth hub|fundraising hub/i }).first();
check('P1', 'Sales Hub sub-tab pill present', await hubPill.count() > 0);
if (await hubPill.count()) {
  await hubPill.click();
  await page.waitForTimeout(800);
  const hubText = await page.locator('main').innerText();
  const hubOpen = /sales team dashboard/i.test(hubText);
  check('P1', 'Sales Hub opens from Pipeline sub-tab', hubOpen, hubOpen ? '' : hubText.slice(0, 120));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  const hubStill = /sales team dashboard/i.test(await page.locator('main').innerText());
  check('P1', 'Sales Hub survives re-render after sub-tab switch', hubStill);
}
void subNav;

// ─── PHASE 4 ───
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'settings'));
await page.waitForTimeout(600);
await page.locator('button', { hasText: 'Industry' }).first().click();
await page.waitForTimeout(400);
const healthcare = page.getByRole('button', { name: /Healthcare/i });
if (await healthcare.count()) {
  await healthcare.first().click();
  await page.waitForTimeout(500);
}
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'dashboard'));
await page.waitForTimeout(600);
const patientsLabel = await page.getByText('Patients').count() > 0;
check('P4', 'Healthcare shows Patients terminology', patientsLabel);

await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'ai-prospector'));
await page.waitForTimeout(800);
await page.locator('textarea').first().fill('healthcare SaaS in Texas');
await page.getByRole('button', { name: /run prospector scan/i }).click();
await page.waitForTimeout(4500);
check('P4', 'AI Prospector scan completes', await page.getByText(/prospects matched/i).count() > 0);

const importBtn = page.getByRole('button', { name: /import & launch loop/i }).first();
if (await importBtn.count()) {
  await importBtn.click();
  await page.waitForTimeout(600);
}
await clickSidebar(page, NAV_ITEMS.find((n) => n.id === 'sales'));
await page.waitForTimeout(800);
const pipelineTab = page.getByRole('button', { name: /pipeline/i });
if (await pipelineTab.count()) await pipelineTab.first().click();
await page.waitForTimeout(600);
check('P4', 'AI lead in pipeline', await page.getByText(/Northwind|Helix|Summit|Elena/i).count() > 0);

const leadsTab = page.getByRole('button', { name: /^leads$/i });
if (await leadsTab.count()) await leadsTab.first().click();
await page.waitForTimeout(400);
const trainBtn = page.getByRole('button', { name: /train model/i });
if (await trainBtn.count() && await trainBtn.isEnabled()) {
  await trainBtn.click();
  await page.waitForTimeout(3500);
  check('P4', 'Train Model completes', await page.getByRole('button', { name: /model trained/i }).count() > 0);
}

// ─── PHASE 5 ───
consoleErrors.length = 0;
const rapidTabs = ['dashboard', 'contacts', 'sales', 'analytics', 'settings'];
for (const id of rapidTabs) {
  await clickSidebar(page, NAV_ITEMS.find((n) => n.id === id));
  await page.waitForTimeout(150);
}
const reactKeyWarn = consoleErrors.some((e) => /unique.*key|Hydration failed/i.test(e));
check('P5', 'No React key/hydration console errors', !reactKeyWarn, consoleErrors.slice(0, 3).join(' | '));
check('P5', 'No uncaught page errors during rapid nav', consoleErrors.filter((e) => !/favicon|404|net::ERR/i.test(e)).length === 0);

await page.screenshot({ path: `${OUT}/final-dashboard.png`, fullPage: false });
await browser.close();
if (localServer) localServer.server.close();

console.log(`\n── Summary: ${passes.length} passed, ${failures.length} failed ──`);
if (failures.length) {
  console.error('\nFailures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('\nAll Meridian CRM QA checks passed.');
