#!/usr/bin/env node
// job-applier.mjs — Auto-fill and submit job applications via browser automation
// Supports LinkedIn Easy Apply, Indeed, and common ATS platforms.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = join(__dirname, "..", "job-apply-shared");
const toURL = (p) => pathToFileURL(p).href;

const {
  launchJobBrowser,
  detectATS,
  formatBrowserLabel,
  safeNavigate,
  captureScreenshot,
  closeBrowser,
} = await import(toURL(join(SHARED_DIR, "browser-helpers.mjs")));
const { humanType, humanClick, humanScroll, humanPause, randomDelay } = await import(
  toURL(join(SHARED_DIR, "anti-detect.mjs"))
);
const { getJobById, getProfile, saveApplication, updateApplicationStatus, logEvent, getConfig } = await import(
  toURL(join(SHARED_DIR, "supabase-helpers.mjs"))
);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--") && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

// ─── Field Mapping ───────────────────────────────────────────────

/**
 * Try to fill a form field by common selectors.
 * Returns true if successful.
 */
async function tryFillField(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await humanType(page, sel, value);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Try to upload a file to a file input by common selectors.
 */
async function tryUploadFile(page, selectors, filePath) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.setInputFiles(filePath);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

// ─── LinkedIn Easy Apply ─────────────────────────────────────────

async function applyLinkedIn(page, job, profile, resumePath, dryRun) {
  await safeNavigate(page, job.url);
  await humanPause("read");

  // Click Easy Apply button
  const easyApplyBtn = await page.$('button.jobs-apply-button, button[aria-label*="Easy Apply"]');
  if (!easyApplyBtn) {
    return { success: false, error: "No Easy Apply button found. This job may require external application." };
  }
  await humanClick(page, 'button.jobs-apply-button, button[aria-label*="Easy Apply"]');
  await humanPause("think");

  // Handle multi-step modal
  let stepCount = 0;
  const maxSteps = 10;
  const filledFields = [];
  const skippedFields = [];

  while (stepCount < maxSteps) {
    stepCount++;
    await randomDelay(1000, 2000);

    // Check for resume upload
    const resumeUploaded = await tryUploadFile(page, [
      'input[type="file"]',
      'input[name*="resume"]',
      'input[name*="Resume"]',
    ], resumePath);
    if (resumeUploaded) filledFields.push("resume");

    // Try to fill common fields
    const p = profile.personal || {};
    const fieldMap = [
      { name: "email", value: p.email, selectors: ['input[name*="email"]', 'input[type="email"]', 'input[aria-label*="Email"]'] },
      { name: "phone", value: p.phone, selectors: ['input[name*="phone"]', 'input[type="tel"]', 'input[aria-label*="Phone"]', 'input[aria-label*="phone"]'] },
      { name: "first_name", value: p.name?.split(" ")[0], selectors: ['input[name*="firstName"]', 'input[name*="first_name"]', 'input[aria-label*="First"]'] },
      { name: "last_name", value: p.name?.split(" ").slice(1).join(" "), selectors: ['input[name*="lastName"]', 'input[name*="last_name"]', 'input[aria-label*="Last"]'] },
      { name: "city", value: p.location?.split(",")[0], selectors: ['input[name*="city"]', 'input[aria-label*="City"]'] },
      { name: "linkedin", value: p.linkedin, selectors: ['input[name*="linkedin"]', 'input[aria-label*="LinkedIn"]'] },
      { name: "website", value: p.website || p.github, selectors: ['input[name*="website"]', 'input[name*="portfolio"]', 'input[aria-label*="Website"]'] },
    ];

    for (const field of fieldMap) {
      if (field.value) {
        const filled = await tryFillField(page, field.selectors, field.value);
        if (filled) filledFields.push(field.name);
      }
    }

    // Check for "Next" button
    const nextBtn = await page.$('button[aria-label="Continue to next step"], button[aria-label*="Next"], button:has-text("Next")');
    if (nextBtn && await nextBtn.isVisible()) {
      if (dryRun) {
        // Screenshot before proceeding
        await captureScreenshot(page, `apply-linkedin-step${stepCount}`);
      }
      await humanClick(page, 'button[aria-label="Continue to next step"], button[aria-label*="Next"], button:has-text("Next")');
      await humanPause("think");
      continue;
    }

    // Check for "Review" button
    const reviewBtn = await page.$('button[aria-label="Review your application"], button:has-text("Review")');
    if (reviewBtn && await reviewBtn.isVisible()) {
      await humanClick(page, 'button[aria-label="Review your application"], button:has-text("Review")');
      await humanPause("read");
    }

    // Check for submit button
    const submitBtn = await page.$('button[aria-label="Submit application"], button:has-text("Submit")');
    if (submitBtn && await submitBtn.isVisible()) {
      const screenshot = await captureScreenshot(page, `apply-linkedin-final`);
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          message: "Dry run complete. Application form filled but NOT submitted.",
          filled_fields: filledFields,
          screenshot: screenshot?.canvasUrl,
          previewUrl: screenshot?.previewUrl,
          steps: stepCount,
        };
      }
      await humanClick(page, 'button[aria-label="Submit application"], button:has-text("Submit")');
      await humanPause("think");
      const confirmScreenshot = await captureScreenshot(page, `apply-linkedin-confirm`);
      return {
        success: true,
        submitted: true,
        message: "Application submitted via LinkedIn Easy Apply",
        filled_fields: filledFields,
        screenshot: confirmScreenshot?.canvasUrl,
          previewUrl: confirmScreenshot?.previewUrl,
        steps: stepCount,
      };
    }

    // Check if modal closed (success or error)
    const modalClosed = !(await page.$('.jobs-easy-apply-modal, [class*="easy-apply"]'));
    if (modalClosed) {
      return {
        success: true,
        submitted: true,
        message: "Application modal closed — likely submitted successfully",
        filled_fields: filledFields,
        steps: stepCount,
      };
    }
  }

  return {
    success: false,
    error: `Reached max steps (${maxSteps}) without finding submit button`,
    filled_fields: filledFields,
    skipped_fields: skippedFields,
  };
}

// ─── Indeed Apply ────────────────────────────────────────────────

async function applyIndeed(page, job, profile, resumePath, dryRun) {
  await safeNavigate(page, job.url);
  await humanPause("read");

  // Click "Apply now" button
  const applyBtn = await page.$('#indeedApplyButton, button[id*="apply"], a[href*="/applystart"]');
  if (!applyBtn) {
    return { success: false, error: "No Apply button found on Indeed listing" };
  }

  const href = await applyBtn.getAttribute("href");
  if (href && (href.includes("http") && !href.includes("indeed.com"))) {
    return { success: false, error: `External application required: ${href}`, external_url: href };
  }

  await humanClick(page, '#indeedApplyButton, button[id*="apply"], a[href*="/applystart"]');
  await humanPause("think");

  // Fill contact info
  const p = profile.personal || {};
  const fields = [
    { name: "name", value: p.name, selectors: ['input[name*="name"]', '#input-applicant.name'] },
    { name: "email", value: p.email, selectors: ['input[name*="email"]', 'input[type="email"]'] },
    { name: "phone", value: p.phone, selectors: ['input[name*="phone"]', 'input[type="tel"]'] },
  ];

  const filledFields = [];
  for (const field of fields) {
    if (field.value && await tryFillField(page, field.selectors, field.value)) {
      filledFields.push(field.name);
    }
  }

  // Upload resume
  if (resumePath) {
    const uploaded = await tryUploadFile(page, ['input[type="file"]', 'input[name*="resume"]'], resumePath);
    if (uploaded) filledFields.push("resume");
  }

  const screenshot = await captureScreenshot(page, "apply-indeed-form");

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      message: "Dry run complete. Form filled but NOT submitted.",
      filled_fields: filledFields,
      screenshot: screenshot?.canvasUrl,
          previewUrl: screenshot?.previewUrl,
    };
  }

  // Submit
  const submitBtn = await page.$('button[type="submit"], button:has-text("Submit"), button:has-text("Apply")');
  if (submitBtn) {
    await humanClick(page, 'button[type="submit"], button:has-text("Submit"), button:has-text("Apply")');
    await humanPause("think");
    const confirmScreenshot = await captureScreenshot(page, "apply-indeed-confirm");
    return {
      success: true,
      submitted: true,
      message: "Application submitted via Indeed",
      filled_fields: filledFields,
      screenshot: confirmScreenshot?.canvasUrl,
          previewUrl: confirmScreenshot?.previewUrl,
    };
  }

  return { success: false, error: "Could not find submit button", filled_fields: filledFields };
}

// ─── Generic ATS Apply ──────────────────────────────────────────

async function applyGenericATS(page, job, profile, resumePath, dryRun, atsType) {
  await safeNavigate(page, job.url);
  await humanPause("read");

  // Look for apply button
  const applySelectors = [
    'a:has-text("Apply")', 'button:has-text("Apply")',
    'a[href*="apply"]', 'button[class*="apply"]',
    '#apply-button', '.apply-button',
  ];

  let clicked = false;
  for (const sel of applySelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await humanClick(page, sel);
        clicked = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!clicked) {
    const screenshot = await captureScreenshot(page, `apply-${atsType}-nobutton`);
    return {
      success: false,
      error: `Could not find apply button on ${atsType} page`,
      screenshot: screenshot?.canvasUrl,
          previewUrl: screenshot?.previewUrl,
      page_url: page.url(),
    };
  }

  await humanPause("think");

  // Fill in standard fields
  const p = profile.personal || {};
  const filledFields = [];
  const commonFields = [
    { name: "first_name", value: p.name?.split(" ")[0], selectors: ['input[name*="first"]', 'input[id*="first"]', 'input[aria-label*="First"]'] },
    { name: "last_name", value: p.name?.split(" ").slice(1).join(" "), selectors: ['input[name*="last"]', 'input[id*="last"]', 'input[aria-label*="Last"]'] },
    { name: "email", value: p.email, selectors: ['input[name*="email"]', 'input[type="email"]'] },
    { name: "phone", value: p.phone, selectors: ['input[name*="phone"]', 'input[type="tel"]'] },
    { name: "linkedin", value: p.linkedin, selectors: ['input[name*="linkedin"]', 'input[id*="linkedin"]'] },
    { name: "address", value: p.location, selectors: ['input[name*="address"]', 'input[name*="location"]', 'input[name*="city"]'] },
  ];

  for (const field of commonFields) {
    if (field.value && await tryFillField(page, field.selectors, field.value)) {
      filledFields.push(field.name);
    }
  }

  // Upload resume
  if (resumePath) {
    const uploaded = await tryUploadFile(page, ['input[type="file"]'], resumePath);
    if (uploaded) filledFields.push("resume");
  }

  const screenshot = await captureScreenshot(page, `apply-${atsType}-form`);

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      ats_type: atsType,
      message: `Dry run on ${atsType}. Form partially filled (${filledFields.length} fields). Review screenshot.`,
      filled_fields: filledFields,
      screenshot: screenshot?.canvasUrl,
          previewUrl: screenshot?.previewUrl,
      page_url: page.url(),
    };
  }

  // Attempt submit
  const submitSelectors = ['button[type="submit"]', 'button:has-text("Submit")', 'input[type="submit"]'];
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await humanClick(page, sel);
        await humanPause("think");
        const confirmScreenshot = await captureScreenshot(page, `apply-${atsType}-confirm`);
        return {
          success: true,
          submitted: true,
          ats_type: atsType,
          filled_fields: filledFields,
          screenshot: confirmScreenshot?.canvasUrl,
          previewUrl: confirmScreenshot?.previewUrl,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    success: false,
    error: "Could not find or click submit button",
    ats_type: atsType,
    filled_fields: filledFields,
    screenshot: screenshot?.canvasUrl,
          previewUrl: screenshot?.previewUrl,
  };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const jobId = args["job-id"];
  const resumePath = args["resume-pdf"] ? resolve(args["resume-pdf"]) : null;
  const coverLetter = args["cover-letter"];
  const dryRun = args["dry-run"] !== "false";
  const headless = args.headless === "true";
  const browserMode = String(args["browser-mode"] || args.browserMode || "auto").toLowerCase();
  const directUrl = args.url;

  if (!jobId && !directUrl) {
    console.log(JSON.stringify({
      success: false,
      error: 'Usage: node job-applier.mjs --job-id <supabase_id> --resume-pdf <path> [--cover-letter "..."] [--dry-run true] [--headless false]',
    }));
    process.exit(1);
  }

  // Check daily cap
  const config = await getConfig("job_apply_config");
  const dailyCap = config?.daily_cap ?? 20;
  // Simple daily counter via config
  const today = new Date().toISOString().split("T")[0];
  const dailyCount = await getConfig(`apply_count_${today}`);
  if ((dailyCount?.count ?? 0) >= dailyCap) {
    console.log(JSON.stringify({
      success: false,
      error: `Daily application cap reached (${dailyCap}). Try again tomorrow or increase cap.`,
    }));
    process.exit(1);
  }

  // Fetch job listing
  let job;
  if (jobId) {
    job = await getJobById(jobId);
    if (!job) {
      console.log(JSON.stringify({ success: false, error: `Job not found: ${jobId}` }));
      process.exit(1);
    }
    job = { ...job.data, id: job.id }; // Flatten
  } else {
    job = { url: directUrl, title: "Direct Application", source: "direct" };
  }

  // Fetch profile
  const profileDoc = await getProfile();
  const profile = profileDoc?.data || {};

  // Validate resume file
  if (resumePath && !existsSync(resumePath)) {
    console.log(JSON.stringify({ success: false, error: `Resume file not found: ${resumePath}` }));
    process.exit(1);
  }

  const applyUrl = job?.url || args.url || "";
  const atsType = detectATS(applyUrl);

  let context, page, contextKey, browserEngine, cloudflareChallenge, browserSwitched;
  try {
    const session = await launchJobBrowser({
      url: applyUrl,
      headless,
      browserMode,
    });
    context = session.context;
    page = session.page;
    contextKey = session.contextKey;
    browserEngine = session.browserEngine;
    cloudflareChallenge = session.cloudflareChallenge;
    browserSwitched = session.browserSwitched;
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: `Browser launch failed: ${err.message}` }));
    process.exit(1);
  }

  if (cloudflareChallenge?.blocked) {
    const ray = cloudflareChallenge.rayId ? ` Ray ID ${cloudflareChallenge.rayId}` : "";
    console.log(JSON.stringify({
      success: false,
      blocked: "cloudflare",
      error: `Cloudflare challenge still blocking (${formatBrowserLabel(browserEngine)}).${ray} Complete verification in the browser window, then retry.`,
      browserEngine,
      browserSwitched,
      cloudflareChallenge,
      ats_type: atsType,
    }));
    const linger = Number(process.env.LUCY_APPLY_LINGER_MS || 120000);
    if (!headless && linger > 0) await page.waitForTimeout(linger);
    await closeBrowser(context, { key: contextKey });
    process.exit(1);
  }

  let result;
  try {
    switch (atsType) {
      case "linkedin":
        result = await applyLinkedIn(page, job, profile, resumePath, dryRun);
        break;
      case "indeed":
        result = await applyIndeed(page, job, profile, resumePath, dryRun);
        break;
      default:
        result = await applyGenericATS(page, job, profile, resumePath, dryRun, atsType);
        break;
    }

    // Save application record
    if (result.success && !dryRun) {
      try {
        await saveApplication({
          job_id: job.id || jobId,
          job_title: job.title,
          company: job.company,
          url: job.url,
          source: job.source || atsType,
          status: result.submitted ? "submitted" : "attempted",
          applied_at: new Date().toISOString(),
          resume_path: resumePath,
          cover_letter: coverLetter,
          filled_fields: result.filled_fields,
          screenshot: result.screenshot,
        });

        // Increment daily counter
        const currentCount = (dailyCount?.count ?? 0) + 1;
        const { setConfig } = await import(toURL(join(SHARED_DIR, "supabase-helpers.mjs")));
        await setConfig(`apply_count_${today}`, { count: currentCount, date: today });
      } catch (err) {
        result.save_error = err.message;
      }
    }

    await logEvent("job_apply", "info", {
      job_title: job.title,
      company: job.company,
      ats: atsType,
      dry_run: dryRun,
      success: result.success,
      submitted: result.submitted,
    });

    console.log(JSON.stringify({
      ...result,
      browserEngine,
      browserSwitched,
      browserLabel: formatBrowserLabel(browserEngine),
    }));
    const linger = Number(process.env.LUCY_APPLY_LINGER_MS || 120000);
    if (!headless && linger > 0) {
      console.error(`[job-applier] Browser open ${Math.round(linger / 1000)}s for review`);
      await page.waitForTimeout(linger);
    }
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message, browserEngine }));
  } finally {
    await closeBrowser(context, { key: contextKey });
  }
}

main();
