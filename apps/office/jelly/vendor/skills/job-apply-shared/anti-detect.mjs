#!/usr/bin/env node
// anti-detect.mjs — Human-like interaction helpers for browser automation
// Prevents bot detection through realistic typing, clicking, and scrolling.

/**
 * Type text character-by-character with random delays (50-200ms per char).
 */
export async function humanType(page, selector, text, opts = {}) {
  const minDelay = opts.minDelay ?? 50;
  const maxDelay = opts.maxDelay ?? 200;

  await page.click(selector);
  await randomDelay(100, 300);

  // Clear existing content via Ctrl+A (page.fill triggers change events that flag bots)
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await randomDelay(50, 150);

  for (const char of text) {
    await page.type(selector, char, {
      delay: Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay,
    });
  }
}

/**
 * Click an element with mouse movement simulation.
 */
export async function humanClick(page, selector, opts = {}) {
  const el = await page.waitForSelector(selector, { timeout: opts.timeout ?? 10000 });
  if (!el) throw new Error(`Element not found: ${selector}`);

  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Move to element with slight random offset
  const x = box.x + box.width / 2 + (Math.random() * 6 - 3);
  const y = box.y + box.height / 2 + (Math.random() * 6 - 3);
  try {
    const { lucyMouseMove } = await import("./browser-helpers.mjs");
    await lucyMouseMove(page, x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  } catch {
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  }

  await randomDelay(50, 200);
  await page.mouse.click(x, y);
}

/**
 * Scroll the page smoothly in a given direction.
 */
export async function humanScroll(page, direction = "down", amount = 300) {
  const delta = direction === "up" ? -amount : amount;
  const steps = Math.floor(Math.abs(amount) / 50) + 1;
  const stepDelta = delta / steps;

  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepDelta);
    await randomDelay(30, 80);
  }
}

/**
 * Random delay between min and max milliseconds.
 */
export async function randomDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Rate limiter — enforces minimum gap between page loads.
 */
export class RateLimiter {
  constructor(minGapMs = 5000) {
    this.minGap = minGapMs;
    this.lastAction = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastAction;
    if (elapsed < this.minGap) {
      const waitTime = this.minGap - elapsed + Math.floor(Math.random() * 2000);
      await new Promise((r) => setTimeout(r, waitTime));
    }
    this.lastAction = Date.now();
  }
}

/**
 * Wait for a random time interval to simulate human behavior between actions.
 */
export async function humanPause(activity = "browse") {
  const ranges = {
    browse: [3000, 8000],
    read: [5000, 15000],
    think: [2000, 5000],
    click: [500, 1500],
    type: [200, 800],
  };
  const [min, max] = ranges[activity] ?? ranges.browse;
  await randomDelay(min, max);
}

// ─── CAPTCHA Detection Selectors ────────────────────────────────────

const CAPTCHA_SELECTORS = [
  "iframe[src*='captcha']",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "#captcha-container",
  ".antibot",
  ".g-recaptcha",
  ".h-captcha",
  "[data-sitekey]",
  "#challenge-stage",
  "iframe[src*='challenge']",
];

/**
 * Detect whether a CAPTCHA is present on the page.
 * @returns {boolean}
 */
export async function detectCaptcha(page) {
  for (const sel of CAPTCHA_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) return true;
    } catch {
      // Selector failed — skip
    }
  }
  // Also check URL patterns
  const url = page.url();
  if (url.includes("/challenge") || url.includes("/captcha") || url.includes("/security-check")) {
    return true;
  }
  return false;
}

/**
 * Handle a detected CAPTCHA by switching to visible browser for manual solving.
 * Uses the persistent user-data dir so cookie state is preserved across switches.
 *
 * @param {object} opts
 * @param {string} opts.currentUrl - URL where CAPTCHA was encountered
 * @param {string} opts.site - Site name (for per-site browser profile)
 * @param {string} opts.canvasDir - Canvas dir for saving screenshots
 * @param {number} opts.timeout - Max wait time in ms (default 300000 = 5 min)
 * @returns {{ solved: boolean, timedOut?: boolean, screenshotPath?: string }}
 */
export async function handleCaptchaDetected(opts = {}) {
  const { dirname, join } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { existsSync, mkdirSync, readFileSync } = await import("node:fs");

  const __dir = dirname(fileURLToPath(import.meta.url));
  const toURL = (p) => pathToFileURL(p).href;

  const { getPersistentBrowser, captureScreenshot, closeBrowser } = await import(
    toURL(join(__dir, "browser-helpers.mjs"))
  );

  const currentUrl = opts.currentUrl || "about:blank";
  const site = opts.site || null;
  const { homedir } = await import("node:os");
  const canvasDir = opts.canvasDir || join(homedir(), ".openclaw", "canvas");
  const timeout = opts.timeout ?? 300000; // 5 minutes

  if (!existsSync(canvasDir)) mkdirSync(canvasDir, { recursive: true });

  // Log that CAPTCHA was detected (will show in agent's tool output)
  console.error(JSON.stringify({
    status: "captcha_detected",
    site,
    url: currentUrl,
    message: "CAPTCHA detected — opening visible browser for manual solving.",
  }));

  // Open visible browser at the CAPTCHA URL
  let context, page;
  try {
    ({ context, page } = await getPersistentBrowser({ headless: false, site }));
    await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch (err) {
    return { solved: false, error: `Failed to open visible browser: ${err.message}` };
  }

  // Take screenshot of the CAPTCHA
  const timestamp = Date.now();
  let screenshotPath;
  try {
    const result = await captureScreenshot(page, `captcha-${site || "unknown"}-${timestamp}`);
    screenshotPath = result.filePath;
  } catch {
    // Screenshot failed — continue
  }

  // Poll until CAPTCHA is solved (element disappears) or timeout
  const start = Date.now();
  let solved = false;

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 2000));

    // Check if CAPTCHA elements are gone
    const stillHasCaptcha = await detectCaptcha(page);
    if (!stillHasCaptcha) {
      solved = true;
      break;
    }

    // Also check if page navigated away from challenge
    const url = page.url();
    if (!url.includes("challenge") && !url.includes("captcha") && !url.includes("security-check")) {
      // May have navigated past — double-check selectors
      const remaining = await detectCaptcha(page);
      if (!remaining) {
        solved = true;
        break;
      }
    }
  }

  // Take confirmation screenshot
  if (solved) {
    try {
      const result = await captureScreenshot(page, `captcha-solved-${site || "unknown"}-${timestamp}`);
      screenshotPath = result.filePath;
    } catch {
      // Not critical
    }
  }

  await closeBrowser(context);

  return {
    solved,
    timedOut: !solved,
    screenshotPath,
  };
}
