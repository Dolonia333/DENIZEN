// Screenshot tour of the Denizen OS phone (post-boot).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const OUT = 'reports/phone-ui/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function login(page) {
  if (await page.locator('#denizen-visitor-name-modal').count() === 0) return;
  await page.locator('[data-action="path-ceo"]').click({ timeout: 15_000 });
  await page.locator('#denizen-visitor-code-input').fill('Dolonia');
  await page.locator('[data-action="submit-ceo-code"]').click({ timeout: 15_000 });
  await page.waitForFunction(() => !document.getElementById('denizen-visitor-name-modal'), { timeout: 30_000 });
}

async function shots(name, ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/?reset=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await login(page);
  await page.waitForTimeout(9000);
  await page.evaluate(() => window.DenizenPhoneUi.open());
  await page.waitForTimeout(1600); // past boot splash
  await page.screenshot({ path: `${OUT}/${name}-home.png` });
  await page.evaluate(() => window.DenizenPhoneUi.openApp('mesh'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}-mesh.png` });
  await page.evaluate(() => { window.DenizenPhoneUi.close(); window.DenizenPhoneUi.open(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.DenizenPhoneUi.openApp('settings'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}-settings.png` });
  await page.close();
}

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await shots('desktop', desk);
await desk.close();

const phone = await browser.newContext({
  ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await shots('iphone', phone);
await phone.close();

await browser.close();
console.log('SHOTS DONE');
