#!/usr/bin/env node
// job-scraper.mjs — Scrape job listings from LinkedIn, Indeed, Glassdoor, ZipRecruiter, or direct URLs
// Saves results to Supabase via bridge, deduplicates by source_id.

import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = join(__dirname, "..", "job-apply-shared");
const toURL = (p) => pathToFileURL(p).href;

// Dynamic imports for shared modules
const { getPersistentBrowser, safeNavigate, captureScreenshot, closeBrowser } = await import(
  toURL(join(SHARED_DIR, "browser-helpers.mjs"))
);
const { humanScroll, humanClick, humanPause, randomDelay, RateLimiter, detectCaptcha, handleCaptchaDetected } = await import(
  toURL(join(SHARED_DIR, "anti-detect.mjs"))
);
const { saveJobListing, logEvent } = await import(toURL(join(SHARED_DIR, "supabase-helpers.mjs")));

const CANVAS_DIR = join(homedir(), ".openclaw", "canvas");
const rateLimiter = new RateLimiter(5000);

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

// ─── LinkedIn Scraper ────────────────────────────────────────────

async function scrapeLinkedIn(page, query, location, maxPages, remoteOnly) {
  const jobs = [];
  const baseUrl = "https://www.linkedin.com/jobs/search/";
  const params = new URLSearchParams({
    keywords: query,
    location: location || "",
    f_WT: remoteOnly ? "2" : "",
  });

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    await rateLimiter.wait();
    params.set("start", String(pageNum * 25));
    const url = `${baseUrl}?${params}`;

    try {
      await safeNavigate(page, url);
    } catch (err) {
      // Check for login wall
      if (page.url().includes("/login") || page.url().includes("/authwall")) {
        return { jobs, error: "LinkedIn requires login. Run with --headless false to log in manually.", needsLogin: true };
      }
      throw err;
    }

    await humanScroll(page, "down", 600);
    await humanPause("browse");

    // Check for CAPTCHA
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      const captchaResult = await handleCaptchaDetected({
        currentUrl: page.url(),
        site: "linkedin",
      });
      if (!captchaResult.solved) {
        return { jobs, error: "CAPTCHA detected on LinkedIn — manual solve timed out.", needsCaptcha: true };
      }
      await page.goto(page.url(), { waitUntil: "networkidle", timeout: 30000 });
      await humanPause("browse");
    }

    // Extract job cards
    const cards = await page.$$eval(
      ".jobs-search__results-list li, .scaffold-layout__list-container li",
      (items) =>
        items.map((el) => {
          const titleEl = el.querySelector(".base-search-card__title, .job-card-list__title");
          const companyEl = el.querySelector(".base-search-card__subtitle, .job-card-container__company-name");
          const locationEl = el.querySelector(".job-search-card__location, .job-card-container__metadata-item");
          const linkEl = el.querySelector("a[href*='/jobs/view/']");
          const easyApply = el.querySelector(".job-card-container__apply-method") !== null;
          return {
            title: titleEl?.textContent?.trim() || "",
            company: companyEl?.textContent?.trim() || "",
            location: locationEl?.textContent?.trim() || "",
            url: linkEl?.href || "",
            easy_apply: easyApply,
          };
        })
    );

    for (const card of cards) {
      if (!card.title || !card.url) continue;
      const sourceId = card.url.match(/\/view\/(\d+)/)?.[1] || card.url;
      jobs.push({
        title: card.title,
        company: card.company,
        location: card.location,
        url: card.url,
        source: "linkedin",
        source_id: sourceId,
        easy_apply: card.easy_apply,
        status: "new",
        scraped_at: new Date().toISOString(),
      });
    }

    if (cards.length < 10) break; // No more results
  }
  return { jobs };
}

// ─── Indeed Scraper ──────────────────────────────────────────────

async function scrapeIndeed(page, query, location, maxPages, remoteOnly) {
  const jobs = [];

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    await rateLimiter.wait();
    const params = new URLSearchParams({
      q: query,
      l: location || "",
      start: String(pageNum * 10),
      ...(remoteOnly ? { remotejob: "032b3046-06a3-4876-8dfd-474eb5e7ed11" } : {}),
    });
    const url = `https://www.indeed.com/jobs?${params}`;

    try {
      await safeNavigate(page, url);
    } catch {
      return { jobs, error: "Indeed page load failed" };
    }

    await humanPause("browse");

    // Check for CAPTCHA and attempt to solve
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      const captchaResult = await handleCaptchaDetected({
        currentUrl: page.url(),
        site: "indeed",
      });
      if (!captchaResult.solved) {
        return { jobs, error: "CAPTCHA detected on Indeed — manual solve timed out.", needsCaptcha: true };
      }
      // Re-navigate after solving (session cookies now include CAPTCHA clearance)
      await page.goto(page.url(), { waitUntil: "networkidle", timeout: 30000 });
      await humanPause("browse");
    }

    const cards = await page.$$eval(
      ".resultContent, .job_seen_beacon, [data-jk]",
      (items) =>
        items.map((el) => {
          const titleEl = el.querySelector("h2 a, .jobTitle a");
          const companyEl = el.querySelector("[data-testid='company-name'], .companyName");
          const locationEl = el.querySelector("[data-testid='text-location'], .companyLocation");
          const jobKey = el.closest("[data-jk]")?.getAttribute("data-jk") || "";
          return {
            title: titleEl?.textContent?.trim() || "",
            company: companyEl?.textContent?.trim() || "",
            location: locationEl?.textContent?.trim() || "",
            url: titleEl?.href || (jobKey ? `https://www.indeed.com/viewjob?jk=${jobKey}` : ""),
            source_id: jobKey,
          };
        })
    );

    for (const card of cards) {
      if (!card.title) continue;
      jobs.push({
        title: card.title,
        company: card.company,
        location: card.location,
        url: card.url,
        source: "indeed",
        source_id: card.source_id || card.url,
        status: "new",
        scraped_at: new Date().toISOString(),
      });
    }

    if (cards.length < 5) break;
  }
  return { jobs };
}

// ─── Glassdoor Scraper ───────────────────────────────────────────

async function scrapeGlassdoor(page, query, location, maxPages) {
  const jobs = [];
  const encodedQuery = encodeURIComponent(query);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    await rateLimiter.wait();
    const url = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodedQuery}&locT=&locId=&locKeyword=${encodeURIComponent(location || "")}&jobType=&fromAge=-1&minSalary=0&includeNoSalaryJobs=true&radius=-1&cityId=&minRating=0.0&industryId=&sgocId=&seniorityType=all&companyId=&employerSizes=0&applicationType=0&remoteWorkType=0&p=${pageNum}`;

    try {
      await safeNavigate(page, url);
    } catch {
      return { jobs, error: "Glassdoor page load failed" };
    }

    await humanPause("browse");

    // Check for CAPTCHA
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      const captchaResult = await handleCaptchaDetected({
        currentUrl: page.url(),
        site: "glassdoor",
      });
      if (!captchaResult.solved) {
        return { jobs, error: "CAPTCHA detected on Glassdoor — manual solve timed out.", needsCaptcha: true };
      }
      await page.goto(page.url(), { waitUntil: "networkidle", timeout: 30000 });
      await humanPause("browse");
    }

    const cards = await page.$$eval(
      "[data-test='jobListing'], .react-job-listing",
      (items) =>
        items.map((el) => {
          const titleEl = el.querySelector("[data-test='job-title'], .job-title");
          const companyEl = el.querySelector("[data-test='emp-name'], .employer-name");
          const locationEl = el.querySelector("[data-test='emp-location'], .location");
          const linkEl = el.querySelector("a[href*='/job-listing/']");
          return {
            title: titleEl?.textContent?.trim() || "",
            company: companyEl?.textContent?.trim() || "",
            location: locationEl?.textContent?.trim() || "",
            url: linkEl?.href || "",
          };
        })
    );

    for (const card of cards) {
      if (!card.title) continue;
      jobs.push({
        title: card.title,
        company: card.company,
        location: card.location,
        url: card.url,
        source: "glassdoor",
        source_id: card.url,
        status: "new",
        scraped_at: new Date().toISOString(),
      });
    }

    if (cards.length < 5) break;
  }
  return { jobs };
}

// ─── ZipRecruiter Scraper ────────────────────────────────────────

async function scrapeZipRecruiter(page, query, location, maxPages) {
  const jobs = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    await rateLimiter.wait();
    const params = new URLSearchParams({
      search: query,
      location: location || "",
      page: String(pageNum),
    });
    const url = `https://www.ziprecruiter.com/jobs-search?${params}`;

    try {
      await safeNavigate(page, url);
    } catch {
      return { jobs, error: "ZipRecruiter page load failed" };
    }

    await humanPause("browse");

    // Check for CAPTCHA
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      const captchaResult = await handleCaptchaDetected({
        currentUrl: page.url(),
        site: "ziprecruiter",
      });
      if (!captchaResult.solved) {
        return { jobs, error: "CAPTCHA detected on ZipRecruiter — manual solve timed out.", needsCaptcha: true };
      }
      await page.goto(page.url(), { waitUntil: "networkidle", timeout: 30000 });
      await humanPause("browse");
    }

    const cards = await page.$$eval(
      ".job_content, article[data-job-id]",
      (items) =>
        items.map((el) => {
          const titleEl = el.querySelector(".job_title, h2 a");
          const companyEl = el.querySelector(".hiring_company, .company_name");
          const locationEl = el.querySelector(".location, .job_location");
          const jobId = el.getAttribute("data-job-id") || "";
          return {
            title: titleEl?.textContent?.trim() || "",
            company: companyEl?.textContent?.trim() || "",
            location: locationEl?.textContent?.trim() || "",
            url: titleEl?.closest("a")?.href || "",
            source_id: jobId,
          };
        })
    );

    for (const card of cards) {
      if (!card.title) continue;
      jobs.push({
        title: card.title,
        company: card.company,
        location: card.location,
        url: card.url,
        source: "ziprecruiter",
        source_id: card.source_id || card.url,
        status: "new",
        scraped_at: new Date().toISOString(),
      });
    }

    if (cards.length < 5) break;
  }
  return { jobs };
}

// ─── Direct URL Scraper ──────────────────────────────────────────

async function scrapeDirect(page, url) {
  await rateLimiter.wait();
  await safeNavigate(page, url);
  await humanPause("read");

  // Try to extract job info heuristically
  const info = await page.evaluate(() => {
    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("[class*='title']")?.textContent?.trim() ||
      document.title;
    const bodyText = document.body.innerText?.slice(0, 5000) || "";
    return { title, bodyText, url: location.href };
  });

  return {
    jobs: [
      {
        title: info.title,
        company: new URL(url).hostname.replace("www.", ""),
        url: info.url,
        description: info.bodyText,
        source: "direct",
        source_id: url,
        status: "new",
        scraped_at: new Date().toISOString(),
      },
    ],
  };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const site = args.site || "linkedin";
  const query = args.query || "";
  const location = args.location || "";
  const maxPages = parseInt(args.pages || "3", 10);
  const remoteOnly = args["remote-only"] === "true";
  const directUrl = args.url;
  const headless = args.headless !== "false";
  const save = args.save !== "false"; // Save to Supabase by default

  if (!query && !directUrl) {
    console.log(JSON.stringify({
      success: false,
      error: 'Usage: node job-scraper.mjs --site linkedin|indeed|glassdoor|ziprecruiter|direct --query "..." --location "..." [--pages 3] [--remote-only true] [--url <direct_url>] [--headless false] [--save false]',
    }));
    process.exit(1);
  }

  let context, page;
  try {
    ({ context, page } = await getPersistentBrowser({ headless, site, proxy: args.proxy }));
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: `Browser launch failed: ${err.message}` }));
    process.exit(1);
  }

  let result;
  try {
    switch (site) {
      case "linkedin":
        result = await scrapeLinkedIn(page, query, location, maxPages, remoteOnly);
        break;
      case "indeed":
        result = await scrapeIndeed(page, query, location, maxPages, remoteOnly);
        break;
      case "glassdoor":
        result = await scrapeGlassdoor(page, query, location, maxPages);
        break;
      case "ziprecruiter":
        result = await scrapeZipRecruiter(page, query, location, maxPages);
        break;
      case "direct":
        if (!directUrl) throw new Error("--url required for direct scraping");
        result = await scrapeDirect(page, directUrl);
        break;
      default:
        throw new Error(`Unknown site: ${site}. Use: linkedin, indeed, glassdoor, ziprecruiter, direct`);
    }

    // Save to Supabase
    let saved = 0;
    let duplicates = 0;
    if (save && result.jobs?.length) {
      for (const job of result.jobs) {
        try {
          const res = await saveJobListing(job);
          if (res?.duplicate) {
            duplicates++;
          } else {
            saved++;
          }
        } catch (err) {
          // Log but continue
          await logEvent("job_save_error", "warn", { error: err.message, job: job.title });
        }
      }
    }

    // Capture screenshot
    let screenshot = null;
    try {
      screenshot = await captureScreenshot(page, `scrape-${site}-${Date.now()}`);
    } catch {
      // Screenshot optional
    }

    const output = {
      success: true,
      site,
      query,
      location,
      total_found: result.jobs?.length || 0,
      saved,
      duplicates,
      screenshot: screenshot?.canvasUrl,
      previewUrl: screenshot?.previewUrl,
    };

    if (result.error) output.warning = result.error;
    if (result.needsLogin) output.needs_login = true;
    if (result.needsCaptcha) output.needs_captcha = true;

    // Include job summaries (not full descriptions to keep output manageable)
    output.jobs = (result.jobs || []).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      source: j.source,
      easy_apply: j.easy_apply,
    }));

    console.log(JSON.stringify(output));
    await logEvent("job_scrape", "info", { site, query, found: output.total_found, saved });
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
  } finally {
    await closeBrowser(context);
  }
}

main();
