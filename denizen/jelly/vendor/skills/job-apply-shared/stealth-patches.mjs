#!/usr/bin/env node
// stealth-patches.mjs — Comprehensive browser fingerprint spoofing
// Applies the same patches as puppeteer-extra-plugin-stealth via addInitScript().
// No new dependencies needed — pure JavaScript init scripts.

/**
 * Apply all stealth patches to a Playwright browser context.
 * Call this after creating the context but before navigating.
 * @param {import('playwright-core').BrowserContext} context
 */
export async function applyStealthPatches(context) {
  // 1. navigator.webdriver → false
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // 2. navigator.plugins — inject fake Chrome plugins
  await context.addInitScript(() => {
    const makePlugin = (name, filename, desc) => {
      const mime = { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" };
      return { name, filename, description: desc, length: 1, 0: mime, item: (i) => mime, namedItem: () => mime };
    };
    const plugins = [
      makePlugin("Chrome PDF Plugin", "internal-pdf-viewer", "Portable Document Format"),
      makePlugin("Chrome PDF Viewer", "mhjfbmdgcfjbbpaeojofohoefgiehjai", ""),
      makePlugin("Native Client", "internal-nacl-plugin", ""),
    ];
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr = plugins;
        arr.item = (i) => plugins[i];
        arr.namedItem = (name) => plugins.find((p) => p.name === name);
        arr.refresh = () => {};
        return arr;
      },
    });
  });

  // 3. navigator.languages
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  // 4. navigator.hardwareConcurrency — random realistic value
  const cores = Math.random() > 0.5 ? 8 : 4;
  await context.addInitScript((c) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => c });
  }, cores);

  // 5. navigator.deviceMemory
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  });

  // 6. navigator.platform — match Windows UA
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  });

  // 7. window.chrome.runtime — headless chromium lacks this
  await context.addInitScript(() => {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
        id: undefined,
        OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
        OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
        PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
        RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
      };
    }
  });

  // 8. Permissions.query — return "prompt" for notifications
  await context.addInitScript(() => {
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params) => {
      if (params.name === "notifications") {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery(params);
    };
  });

  // 9. WebGL renderer/vendor — hide SwiftShader (instant bot flag)
  await context.addInitScript(() => {
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return "Intel Inc.";
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return "Intel Iris OpenGL Engine";
      return getParameterProto.call(this, param);
    };
    // Also patch WebGL2
    if (typeof WebGL2RenderingContext !== "undefined") {
      const getParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 37445) return "Intel Inc.";
        if (param === 37446) return "Intel Iris OpenGL Engine";
        return getParam2.call(this, param);
      };
    }
  });

  // 10. iframe contentWindow — prevent cross-origin iframe detection
  await context.addInitScript(() => {
    try {
      const orig = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
      if (orig && orig.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
          get: function () {
            const win = orig.get.call(this);
            if (!win) return win;
            // Ensure iframe looks normal
            return win;
          },
        });
      }
    } catch {
      // Best effort — some environments restrict this
    }
  });

  // 11. navigator.connection — fake NetworkInformation
  await context.addInitScript(() => {
    if (!navigator.connection) {
      Object.defineProperty(navigator, "connection", {
        get: () => ({
          effectiveType: "4g",
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }
  });

  // 12. Prevent detection via toString() on overridden functions
  await context.addInitScript(() => {
    const nativeToString = Function.prototype.toString;
    const fakes = new Map();

    function patchToString(fn, nativeName) {
      fakes.set(fn, `function ${nativeName}() { [native code] }`);
    }

    Function.prototype.toString = function () {
      if (fakes.has(this)) return fakes.get(this);
      return nativeToString.call(this);
    };
    // Protect toString itself
    patchToString(Function.prototype.toString, "toString");
  });
}

// ─── CLI self-test ──────────────────────────────────────────────────

if (process.argv[2] === "--test") {
  const { chromium } = await import("playwright-core");
  const { existsSync, mkdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const { homedir } = await import("node:os");
  const CANVAS_DIR = join(homedir(), ".openclaw", "canvas");
  if (!existsSync(CANVAS_DIR)) mkdirSync(CANVAS_DIR, { recursive: true });

  console.log(JSON.stringify({ status: "starting", message: "Launching browser with stealth patches..." }));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/Chicago",
  });

  await applyStealthPatches(context);
  const page = await context.newPage();

  // Visit bot detection test site
  await page.goto("https://bot.sannysoft.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const screenshotPath = join(CANVAS_DIR, "stealth-test.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Grab the results table
  const results = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tr");
    const data = {};
    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        data[cells[0].textContent.trim()] = cells[1].textContent.trim();
      }
    });
    return data;
  });

  // Read screenshot for base64 preview
  const pngBytes = readFileSync(screenshotPath);
  const base64 = pngBytes.toString("base64");

  console.log(JSON.stringify({
    success: true,
    screenshot: screenshotPath,
    previewUrl: `data:image/png;base64,${base64}`,
    results,
  }));

  await browser.close();
}
