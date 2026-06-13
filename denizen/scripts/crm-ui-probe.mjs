// CRM UI smoke — visits every sidebar tab, dashboard quick actions, FAB, command palette.
// Usage: node scripts/crm-ui-probe.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:8081').replace(/\/$/, '');
const CRM_URL = `${BASE}/crm/`;
const OUT = 'reports/crm-ui';
fs.mkdirSync(OUT, { recursive: true });

const NAV_IDS = [
  'dashboard', 'contacts', 'sales', 'schedule', 'notes', 'packages', 'intake',
  'email-templates', 'automations', 'analytics', 'ai', 'portal', 'data-tools', 'onboarding', 'settings',
];

const LEGACY_NAV = [
  { id: 'pipeline', expectHeading: /pipeline|sales|kanban/i },
  { id: 'tasks', expectHeading: /task|schedule|meeting/i },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const check = (name, cond, detail = '') => {
  const ok = !!cond;
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Probing ${BASE}`);
await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(1500);
if (await page.locator('#denizen-visitor-name-modal').count()) {
  await page.click('[data-action="path-ceo"]');
  await page.waitForTimeout(400);
  await page.fill('#denizen-visitor-code-input', 'Dolonia');
  await page.click('[data-action="submit-ceo-code"]');
  await page.waitForTimeout(10_000);
}
const sid = await page.evaluate(() => JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}').session_id);
let crmUrl = CRM_URL;
if (sid) crmUrl += `?dz_sid=${encodeURIComponent(sid)}`;
console.log(`Probing ${crmUrl}`);
await page.goto(crmUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(4000);

const not404 = await page.locator('h1:has-text("404")').count() === 0;
check('CRM loads (not 404)', not404);

for (const id of NAV_IDS) {
  await page.evaluate((tabId) => {
    window.dispatchEvent(new CustomEvent('crm-navigate', { detail: tabId }));
  }, id);
  await page.waitForTimeout(600);
  const blank = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return true;
    return main.innerText.trim().length < 20;
  });
  check(`nav tab: ${id}`, !blank, blank ? 'main area empty' : '');
  await page.screenshot({ path: `${OUT}/tab-${id}.png` });
}

for (const { id } of LEGACY_NAV) {
  await page.evaluate((tabId) => {
    window.dispatchEvent(new CustomEvent('crm-navigate', { detail: tabId }));
  }, id);
  await page.waitForTimeout(700);
  const blank = await page.evaluate(() => {
    const main = document.querySelector('main');
    return !main || main.innerText.trim().length < 20;
  });
  check(`legacy nav: ${id}`, !blank, blank ? 'blank after alias' : '');
}

// Dashboard quick actions
await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm-navigate', { detail: 'dashboard' })));
await page.waitForTimeout(500);
for (const label of ['New Deal', 'View Tasks', 'Analytics']) {
  const btn = page.getByRole('button', { name: label });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(500);
    const blank = await page.evaluate(() => document.querySelector('main')?.innerText.trim().length < 20);
    check(`dashboard action: ${label}`, !blank);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm-navigate', { detail: 'dashboard' })));
    await page.waitForTimeout(300);
  }
}

// Command palette
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
const cmdVisible = await page.locator('input[placeholder*="Search"]').count() > 0;
check('command palette opens (Ctrl+K)', cmdVisible);
if (cmdVisible) {
  await page.keyboard.press('Escape');
}

// FAB add contact
const fab = page.getByRole('button', { name: '+' }).last();
if (await fab.count()) {
  await fab.click({ force: true });
  await page.waitForTimeout(400);
  const addContact = page.getByRole('button', { name: /new contact/i });
  if (await addContact.count()) {
    await addContact.first().click();
    await page.waitForTimeout(500);
    const modal = await page.locator('input[type="text"], input:not([type])').first().isVisible().catch(() => false);
    check('FAB opens add-contact modal', modal);
    await page.keyboard.press('Escape');
  } else {
    check('FAB opens add-contact modal', false, 'FAB menu item not found');
  }
}

// Back to Denizen link
const back = page.getByText('Back to Denizen Phone');
check('back to Denizen link present', await back.count() > 0);

// AI Assistant — must not return "CRM route not found"
await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm-navigate', { detail: 'ai' })));
await page.waitForTimeout(800);
const aiInput = page.locator('input[placeholder*="Ask about"]');
if (await aiInput.count()) {
  await aiInput.fill('hi');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(4000);
  const aiText = await page.evaluate(() => document.querySelector('main')?.innerText || '');
  check('AI tab responds', !/CRM route not found/i.test(aiText), aiText.slice(0, 120));
} else {
  check('AI tab input present', false, 'input not found');
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();

if (failures.length) {
  console.error('\nFailures:', failures.join('\n  '));
  process.exit(1);
}
console.log('\nAll CRM UI checks passed.');
