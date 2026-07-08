// Probe group chat picker clicks
import { chromium } from 'playwright';
import { loginOwner } from './lib/probe-login.mjs';

const BASE = process.argv[2] || 'http://localhost:8080';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await loginOwner(page);
await page.waitForTimeout(6000);
await page.click('#denizen-phone-fab');
await page.waitForSelector('#denizen-phone-shell.open');
await page.click('.dzp-app[data-app="chat"]');
await page.waitForTimeout(1000);
await page.click('#phc-tabs button[data-tab="contacts"]');
await page.waitForTimeout(500);
await page.click('#phc-new-group-btn');
await page.waitForTimeout(500);

const before = await page.evaluate(() => ({
  view: document.getElementById('player-chat-panel')?.dataset?.phcView,
  phoneChat: document.getElementById('player-chat-panel')?.dataset?.phoneChat,
  contacts: document.querySelectorAll('.phc-contact').length,
  logDisplay: getComputedStyle(document.getElementById('player-chat-log')).display,
  listRect: document.getElementById('phc-list-wrap')?.getBoundingClientRect(),
  logRect: document.getElementById('player-chat-log')?.getBoundingClientRect(),
  roster: (globalThis.DenizenNpcRoster?.entries || []).length,
  newGroupHidden: document.getElementById('phc-new-group-btn')?.hidden,
}));
console.log('before pick:', JSON.stringify(before, null, 2));

const contacts = page.locator('.phc-contact');
const n = await contacts.count();
for (let i = 0; i < Math.min(n, 2); i++) {
  await contacts.nth(i).click();
  await page.waitForTimeout(250);
}
const afterPick = await page.evaluate(() => ({
  selected: document.querySelectorAll('.phc-contact.selected').length,
  status: document.querySelector('.phc-status')?.textContent,
  btnText: document.getElementById('phc-create-group-btn')?.textContent,
}));
console.log('after picks:', JSON.stringify(afterPick, null, 2));

await page.click('#phc-create-group-btn');
await page.waitForTimeout(2500);
const afterCreate = await page.evaluate(() => ({
  view: document.getElementById('player-chat-panel')?.dataset?.phcView,
  status: document.querySelector('.phc-status')?.textContent,
  activeThread: window.__DenizenPlayerChat?.getActiveThreadId?.(),
  groupMode: null,
}));
console.log('after create:', JSON.stringify(afterCreate, null, 2));
if (errors.length) console.log('errors:', errors.slice(0, 8));
await browser.close();
