#!/usr/bin/env node
// captcha-solver.mjs — Optional automated CAPTCHA solving via 2captcha API
// Falls back to manual solve (handleCaptchaDetected) if no API key configured.
// Store your API key in Supabase: key_value key="captcha_solver_config" value={"provider":"2captcha","apiKey":"..."}

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toURL = (p) => pathToFileURL(p).href;

/**
 * Attempt to solve a reCAPTCHA v2 on the page using the 2captcha API.
 * Returns true if solved, false if should fall back to manual.
 */
export async function solveRecaptchaV2(page, opts = {}) {
  const { getConfig } = await import(toURL(join(__dirname, "supabase-helpers.mjs")));

  // Load API config from Supabase
  const config = await getConfig("captcha_solver_config");
  if (!config?.apiKey || config.provider !== "2captcha") {
    return { solved: false, reason: "No 2captcha API key configured" };
  }

  const apiKey = config.apiKey;

  // Extract sitekey from page
  let sitekey;
  try {
    sitekey = await page.evaluate(() => {
      const el = document.querySelector("[data-sitekey]");
      return el?.getAttribute("data-sitekey") || null;
    });
  } catch {
    return { solved: false, reason: "Could not find reCAPTCHA sitekey on page" };
  }

  if (!sitekey) {
    return { solved: false, reason: "No data-sitekey attribute found" };
  }

  const pageUrl = page.url();

  // Step 1: Submit CAPTCHA to 2captcha
  let taskId;
  try {
    const submitUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
    const submitRes = await fetch(submitUrl);
    const submitJson = await submitRes.json();
    if (submitJson.status !== 1) {
      return { solved: false, reason: `2captcha submit failed: ${submitJson.request}` };
    }
    taskId = submitJson.request;
  } catch (err) {
    return { solved: false, reason: `2captcha API error: ${err.message}` };
  }

  // Step 2: Poll for solution (max 2 minutes)
  let solution = null;
  const maxPollTime = 120000;
  const start = Date.now();

  while (Date.now() - start < maxPollTime) {
    await new Promise((r) => setTimeout(r, 5000)); // Wait 5s between polls

    try {
      const resultUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
      const resultRes = await fetch(resultUrl);
      const resultJson = await resultRes.json();

      if (resultJson.status === 1) {
        solution = resultJson.request;
        break;
      }
      if (resultJson.request !== "CAPCHA_NOT_READY") {
        return { solved: false, reason: `2captcha error: ${resultJson.request}` };
      }
    } catch {
      // Network error — retry
    }
  }

  if (!solution) {
    return { solved: false, reason: "2captcha timeout (2 minutes)" };
  }

  // Step 3: Inject solution into page
  try {
    await page.evaluate((token) => {
      // Set the textarea that reCAPTCHA uses
      const textarea = document.getElementById("g-recaptcha-response");
      if (textarea) {
        textarea.style.display = "block";
        textarea.value = token;
        textarea.style.display = "none";
      }
      // Also try setting in all iframes (multi-widget pages)
      document.querySelectorAll("[name='g-recaptcha-response']").forEach((el) => {
        el.value = token;
      });
      // Trigger the callback if it exists
      if (typeof window.___grecaptcha_cfg !== "undefined") {
        const clients = window.___grecaptcha_cfg.clients;
        if (clients) {
          Object.values(clients).forEach((client) => {
            try {
              // Find callback in client structure
              const findCallback = (obj, depth = 0) => {
                if (depth > 5 || !obj) return;
                for (const key of Object.keys(obj)) {
                  if (typeof obj[key] === "function" && key.length > 2) {
                    try { obj[key](token); } catch {}
                  } else if (typeof obj[key] === "object") {
                    findCallback(obj[key], depth + 1);
                  }
                }
              };
              findCallback(client);
            } catch {}
          });
        }
      }
    }, solution);

    // Wait for page to process
    await new Promise((r) => setTimeout(r, 3000));

    return { solved: true, method: "2captcha" };
  } catch (err) {
    return { solved: false, reason: `Failed to inject solution: ${err.message}` };
  }
}

/**
 * Combined solver: tries 2captcha first, falls back to manual if needed.
 */
export async function solveCaptcha(page, opts = {}) {
  // Try automated solving first
  const autoResult = await solveRecaptchaV2(page, opts);
  if (autoResult.solved) return autoResult;

  // Fall back to manual solving
  const { handleCaptchaDetected } = await import(toURL(join(__dirname, "anti-detect.mjs")));
  const manualResult = await handleCaptchaDetected({
    currentUrl: page.url(),
    site: opts.site,
    ...opts,
  });

  return {
    solved: manualResult.solved,
    method: "manual",
    timedOut: manualResult.timedOut,
    screenshotPath: manualResult.screenshotPath,
  };
}
