#!/usr/bin/env node
// session-health.mjs — Check and fix login status for job board browser sessions
// Usage:
//   node session-health.mjs --site all
//   node session-health.mjs --site linkedin --fix

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = join(__dirname, "..", "job-apply-shared");
const toURL = (p) => pathToFileURL(p).href;

const { getPersistentBrowser, closeBrowser } = await import(
  toURL(join(SHARED_DIR, "browser-helpers.mjs"))
);
const { randomDelay } = await import(toURL(join(SHARED_DIR, "anti-detect.mjs")));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key.slice(2)] = next;
        i++;
      } else {
        args[key.slice(2)] = "true";
      }
    }
  }
  return args;
}

// ─── Site login check definitions ───────────────────────────────

const SITE_CHECKS = {
  linkedin: {
    name: "LinkedIn",
    checkUrl: "https://www.linkedin.com/feed/",
    loginIndicators: ["/login", "/authwall", "/checkpoint"],
    loggedInSelector: 'div[data-test-id="feed-sort-dropdown"], .feed-identity-module, .global-nav__me',
    loginUrl: "https://www.linkedin.com/login",
  },
  indeed: {
    name: "Indeed",
    checkUrl: "https://www.indeed.com/myjobs",
    loginIndicators: ["/account/login", "/auth/", "secure.indeed.com"],
    loggedInSelector: '.gnav-LoggedInAccountLink, [data-gnav-element-name="AccountMenu"]',
    loginUrl: "https://secure.indeed.com/account/login",
  },
  glassdoor: {
    name: "Glassdoor",
    checkUrl: "https://www.glassdoor.com/member/home/index.htm",
    loginIndicators: ["/member/sign_in", "/member/auth/"],
    loggedInSelector: '.HeaderAccountMenu, [data-test="site-header-profile"]',
    loginUrl: "https://www.glassdoor.com/profile/login_input.htm",
  },
  ziprecruiter: {
    name: "ZipRecruiter",
    checkUrl: "https://www.ziprecruiter.com/candidate/suggested-jobs",
    loginIndicators: ["/authn/login", "/candidate/login"],
    loggedInSelector: ".navbar-profile, .user-menu",
    loginUrl: "https://www.ziprecruiter.com/authn/login",
  },
};

// ─── Check a single site ────────────────────────────────────────

async function checkSite(siteName) {
  const config = SITE_CHECKS[siteName];
  if (!config) {
    return { site: siteName, error: `Unknown site: ${siteName}` };
  }

  let context, page;
  try {
    ({ context, page } = await getPersistentBrowser({ headless: true, site: siteName }));
  } catch (err) {
    return { site: siteName, name: config.name, error: `Browser launch failed: ${err.message}` };
  }

  try {
    await page.goto(config.checkUrl, { waitUntil: "networkidle", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    const currentUrl = page.url();
    const redirectedToLogin = config.loginIndicators.some((ind) => currentUrl.includes(ind));

    let hasLoggedInElement = false;
    if (!redirectedToLogin) {
      try {
        hasLoggedInElement = !!(await page.$(config.loggedInSelector));
      } catch {
        // Selector check failed — not critical
      }
    }

    const loggedIn = !redirectedToLogin && hasLoggedInElement;

    return {
      site: siteName,
      name: config.name,
      logged_in: loggedIn,
      current_url: currentUrl,
      redirected_to_login: redirectedToLogin,
      checked_at: new Date().toISOString(),
      action: loggedIn ? null : "Re-login needed. Run with --fix to open visible browser.",
    };
  } catch (err) {
    return {
      site: siteName,
      name: config.name,
      error: `Check failed: ${err.message}`,
      checked_at: new Date().toISOString(),
    };
  } finally {
    await closeBrowser(context);
  }
}

// ─── Fix a single site (visible browser for manual login) ──────

async function fixSite(siteName) {
  const config = SITE_CHECKS[siteName];
  if (!config) {
    return { site: siteName, error: `Unknown site: ${siteName}` };
  }

  let context, page;
  try {
    ({ context, page } = await getPersistentBrowser({ headless: false, site: siteName }));
  } catch (err) {
    return { site: siteName, name: config.name, error: `Browser launch failed: ${err.message}` };
  }

  try {
    // First try loading credentials from Supabase for auto-fill
    let credentials = null;
    try {
      const { getCredentials } = await import(toURL(join(SHARED_DIR, "supabase-helpers.mjs")));
      credentials = await getCredentials(siteName);
    } catch {
      // No credentials stored — manual login
    }

    // Navigate to login page
    await page.goto(config.loginUrl, { waitUntil: "networkidle", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // If we have credentials, try auto-fill
    if (credentials?.email && credentials?.password) {
      try {
        const { humanType } = await import(toURL(join(SHARED_DIR, "anti-detect.mjs")));
        // Try common email field selectors
        const emailSelectors = ['input[name="session_key"]', 'input[name="email"]', 'input[type="email"]', '#login-email-input', '#emailOrPhone'];
        for (const sel of emailSelectors) {
          const el = await page.$(sel);
          if (el) {
            await humanType(page, sel, credentials.email);
            break;
          }
        }
        // Try common password field selectors
        const pwSelectors = ['input[name="session_password"]', 'input[name="password"]', 'input[type="password"]', '#login-password-input'];
        for (const sel of pwSelectors) {
          const el = await page.$(sel);
          if (el) {
            await humanType(page, sel, credentials.password);
            break;
          }
        }
      } catch {
        // Auto-fill failed — user will fill manually
      }
    }

    // Poll for login success (up to 5 minutes)
    console.error(JSON.stringify({
      status: "waiting",
      site: siteName,
      message: `Browser opened to ${config.name} login page. Please log in.`,
    }));

    const maxWait = 300000; // 5 minutes
    const start = Date.now();
    let loggedIn = false;

    while (Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, 3000));

      const currentUrl = page.url();
      const onLoginPage = config.loginIndicators.some((ind) => currentUrl.includes(ind));

      if (!onLoginPage) {
        // Check for logged-in indicator
        try {
          const found = await page.$(config.loggedInSelector);
          if (found) {
            loggedIn = true;
            break;
          }
        } catch {
          // Keep waiting
        }

        // Also consider: if we're no longer on login and no indicator found,
        // the user might have navigated away — check if we left the login domain
        if (!currentUrl.includes("login") && !currentUrl.includes("auth")) {
          loggedIn = true;
          break;
        }
      }
    }

    return {
      site: siteName,
      name: config.name,
      logged_in: loggedIn,
      action: loggedIn ? "Login successful!" : "Login timed out (5 minutes). Try again.",
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      site: siteName,
      name: config.name,
      error: `Fix failed: ${err.message}`,
      checked_at: new Date().toISOString(),
    };
  } finally {
    await closeBrowser(context);
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const siteArg = args.site || "all";
  const fix = args.fix === "true";

  const sites = siteArg === "all" ? Object.keys(SITE_CHECKS) : [siteArg];

  const results = {};
  for (const site of sites) {
    if (fix) {
      // First check if already logged in
      const check = await checkSite(site);
      if (check.logged_in) {
        results[site] = check;
        continue;
      }
      // Not logged in — open visible browser
      results[site] = await fixSite(site);
    } else {
      results[site] = await checkSite(site);
    }
  }

  console.log(JSON.stringify({
    success: true,
    action: fix ? "fix" : "check",
    sites: results,
  }));
}

main().catch((err) => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
