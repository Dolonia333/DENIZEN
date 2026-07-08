#!/usr/bin/env node
// web-search.mjs — Lucy opens a VISIBLE browser and performs a real web search,
// moving her cursor like a person, then returns the top results.
//
// Browser routing — all paths use Playwright; engine picks the underlying browser:
//   playwright / chromium — Playwright bundled Chromium (general searches)
//   chrome              — Playwright driving system Google Chrome (tunnels / CF)
//   msedge              — Playwright driving system Edge (CF fallback on Windows)
//   auto                — pick per situation; CF retry: Chromium → Chrome → Edge
//
// Usage:
//   node web-search.mjs --query "..." [--headless false] [--browser-mode auto|playwright|chrome|msedge] [--open-results 1] [--linger-ms 240000]
//
// Output: JSON { ok, query, engine, browserEngine, results, visitedUrls, cloudflareChallenge, ... }

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = resolve(__dirname, "..", "job-apply-shared");
const toURL = (p) => pathToFileURL(p).href;

const {
  getPersistentBrowser,
  captureScreenshot,
  captureMirrorFrame,
  startMirrorStream,
  startMirrorInputLoop,
  appendMirrorActivity,
  closeBrowser,
  clearLucyCloseFlag,
  waitForCloseOrSearchCommand,
  writeSearchResult,
  writeMirrorState,
  lucyMouseMove,
} = await import(toURL(join(SHARED_DIR, "browser-helpers.mjs")));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

const TUNNEL_HOST_RE = /(?:^|\.)dolonia\.cloud$/i;

function isLikelyTunnelHost(url) {
  try {
    return TUNNEL_HOST_RE.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function queryImpliesTunnel(query) {
  const q = String(query || "").trim();
  if (/\bdolonia\.cloud\b/i.test(q)) return true;
  if (/^https?:\/\//i.test(q)) return isLikelyTunnelHost(q);
  if (/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}$/i.test(q)) return isLikelyTunnelHost(`https://${q}`);
  return false;
}

function inferOpenTarget(query, results) {
  const q = String(query || "").trim();
  if (/^https?:\/\//i.test(q)) {
    return { title: q, url: q, needsChrome: isLikelyTunnelHost(q) };
  }
  if (/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}$/i.test(q)) {
    const url = `https://${q}`;
    return { title: q, url, needsChrome: isLikelyTunnelHost(url) };
  }
  if (queryImpliesTunnel(q)) {
    const tunnelHit = results.find((r) => isLikelyTunnelHost(r.url));
    if (tunnelHit) return { ...tunnelHit, needsChrome: true };
  }
  const open = results.find((r) => !isLikelyTunnelHost(r.url));
  if (open) return { ...open, needsChrome: false };
  const fallback = results[0];
  return fallback ? { ...fallback, needsChrome: isLikelyTunnelHost(fallback.url) } : null;
}

async function humanMoveAndType(page, selector, text) {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  const box = await el.boundingBox();
  if (box) {
    await lucyMouseMove(page, box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  }
  await el.click();
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 40 + Math.random() * 80 });
  }
}

async function detectCloudflareChallenge(page) {
  try {
    const title = await page.title();
    const body = await page.evaluate(() => (document.body?.innerText || "").slice(0, 2500));
    const hay = `${title}\n${body}`;
    const blocked = /\b(?:additional verification required|just a moment|checking your browser|verify you are human|attention required|cf-browser-verification|challenge-platform)\b/i.test(hay);
    const rayId = hay.match(/\bRay ID[:\s]*([a-f0-9]{16})\b/i)?.[1] || null;
    return { blocked, rayId, url: page.url() };
  } catch {
    return { blocked: false, rayId: null, url: null };
  }
}

async function humanOpenResult(page, result) {
  const linkSel = 'article[data-testid="result"] a[data-testid="result-title-a"], .result a.result__a, .result h2 a';
  try {
    const el = await page.$(linkSel);
    const box = el && (await el.boundingBox());
    if (box) {
      await lucyMouseMove(page, box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
      await page.waitForTimeout(250 + Math.random() * 350);
    }
  } catch {}
  await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollBy(0, 280 + Math.random() * 120));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 200));
}

/** Pull readable text from the page Lucy is actually looking at. */
async function extractPageText(page) {
  try {
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const clone = document.body?.cloneNode(true);
      if (!clone) return { title: document.title || "", text: "", url: location.href };
      clone.querySelectorAll("script, style, noscript, nav, footer, header, aside, [role='navigation'], [aria-hidden='true']").forEach((n) => n.remove());
      const main = clone.querySelector("main, article, [role='main'], .content, #content, .post, .article") || clone;
      const title = (document.title || "").trim();
      const text = (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6500);
      return { title, text, url: location.href };
    });
  } catch {
    return { title: "", text: "", url: page.url?.() || "" };
  }
}

async function searchDuckDuckGo(page, query) {
  await page.goto("https://duckduckgo.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  await humanMoveAndType(page, 'input[name="q"]', query);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return await page.$$eval('article[data-testid="result"], .result', (nodes) =>
    nodes.slice(0, 8).map((n) => {
      const a = n.querySelector('a[data-testid="result-title-a"], a.result__a, h2 a');
      const snip = n.querySelector('[data-result="snippet"], .result__snippet');
      return { title: a?.innerText?.trim() || "", url: a?.href || "", snippet: snip?.innerText?.trim() || "" };
    }).filter((r) => r.title && r.url)
  );
}

function siteForEngine(engine) {
  if (engine === "chrome") return "search-chrome";
  if (engine === "msedge") return "search-msedge";
  return "search";
}

function isPlaywrightOnlyMode(browserMode) {
  return browserMode === "playwright" || browserMode === "chromium";
}

async function launchSearchBrowser({ headless, browserMode, engine }) {
  const site = siteForEngine(engine);
  const mode = engine === "chromium"
    ? (isPlaywrightOnlyMode(browserMode) ? "playwright" : browserMode === "auto" ? "auto" : browserMode)
    : engine;
  const session = await getPersistentBrowser({
    headless,
    site,
    browserMode: mode,
    preferChrome: engine === "chrome",
    preferMsedge: engine === "msedge",
    needsCloudflarePass: engine === "chrome" || engine === "msedge",
    channel: engine === "msedge" ? "msedge" : undefined,
  });
  return { ...session, site, engine: session.browserEngine || engine };
}

async function openUrlInEngine({ headless, browserMode, engine, url }) {
  const session = await launchSearchBrowser({ headless, browserMode, engine });
  const page = session.page || session.context.pages()[0] || (await session.context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  return { ...session, page };
}

async function retryCloudflareEngines({ headless, browserMode, openTarget, currentEngine, context, contextKey }) {
  if (isPlaywrightOnlyMode(browserMode)) return { context, contextKey, browserEngine: currentEngine, cloudflareChallenge: null, browserSwitched: false };

  const chain = currentEngine === "chromium" ? ["chrome", "msedge"] : currentEngine === "chrome" ? ["msedge"] : [];
  let activeContext = context;
  let activeKey = contextKey;
  let activeEngine = currentEngine;
  let challenge = null;
  let switched = false;

  for (const engine of chain) {
    if (activeContext) await closeBrowser(activeContext, { key: activeKey });
    activeContext = null;
    const session = await openUrlInEngine({
      headless,
      browserMode: engine,
      engine,
      url: openTarget.url,
    });
    activeContext = session.context;
    activeKey = session.contextKey;
    activeEngine = session.engine;
    switched = true;
    challenge = await detectCloudflareChallenge(session.page);
    challenge.retriedWith = engine;
    if (!challenge.blocked) break;
  }

  return {
    context: activeContext,
    contextKey: activeKey,
    browserEngine: activeEngine,
    cloudflareChallenge: challenge,
    browserSwitched: switched,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const query = args.query || args.q;
  const openOnly = args["open-only"] === "true" || args.openOnly === "true";
  if (!query && !openOnly) {
    console.log(JSON.stringify({ ok: false, error: 'Usage: --query "your search" [--headless false] [--browser-mode auto|playwright|chrome|msedge]' }));
    process.exit(1);
  }

  const headless = args.headless === "true";
  const browserMode = String(args["browser-mode"] || args.browserMode || "auto").toLowerCase();
  const directUrl = args["direct-url"] || args.directUrl || null;
  const jobBoard = args["job-board"] || args.jobBoard || null;
  const openResultsRaw = args["open-results"] ?? args.openResults;
  const openResults = openResultsRaw !== undefined
    ? Math.max(0, Number(openResultsRaw) || 0)
    : (headless ? 0 : 1);
  const keepOpen = args["keep-open"] === "true" || args.keepOpen === "true"
    || String(process.env.LUCY_BROWSER_UNTIL_CLOSE || "true").toLowerCase() !== "false";
  const defaultLinger = 4 * 60 * 1000;
  const lingerMs = keepOpen || headless
    ? 0
    : Math.max(0, Number(args["linger-ms"] || args.lingerMs || defaultLinger) || defaultLinger);

  let context = null;
  let contextKey = null;
  let browserEngine = "chromium";
  let browserSwitched = false;
  let page = null;
  let stopMirrorStream = () => {};
  let stopInputLoop = () => {};

  try {
    if (keepOpen) clearLucyCloseFlag();
    appendMirrorActivity(openOnly ? "Opening browser…" : `Searching: ${query || "(browser)"}`);
    const startEngine = directUrl || jobBoard
      ? "chrome"
      : browserMode === "chrome" || browserMode === "msedge" || browserMode === "edge"
        ? (browserMode === "edge" ? "msedge" : browserMode)
        : queryImpliesTunnel(query) ? "chrome" : "chromium";
    let session = await launchSearchBrowser({ headless, browserMode: directUrl ? "chrome" : browserMode, engine: startEngine });
    context = session.context;
    contextKey = session.contextKey;
    browserEngine = session.engine;

    page = session.page || context.pages()[0] || (await context.newPage());
    const getActivePage = () => {
      try {
        return context?.pages()?.slice(-1)[0] || context?.pages()?.[0] || page || null;
      } catch {
        return page || null;
      }
    };
    writeMirrorState({
      status: openOnly ? "open" : "searching",
      streaming: true,
      query: query || "",
      browserEngine,
    });
    stopMirrorStream = startMirrorStream(getActivePage, { intervalMs: 150 });

    let results = [];
    const visitedUrls = [];
    const readPages = [];
    let skippedTunnel = [];
    let cloudflareChallenge = null;
    let openTarget = null;

    if (openOnly) {
      await page.goto("https://duckduckgo.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      results = [{ title: "DuckDuckGo", url: page.url(), snippet: "Lucy browser ready" }];
      visitedUrls.push({ title: "DuckDuckGo", url: page.url() });
    } else if (directUrl) {
      await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
      const title = await page.title().catch(() => directUrl);
      results = [{ title, url: directUrl, snippet: jobBoard ? `${jobBoard} job search` : "" }];
      visitedUrls.push({ title, url: directUrl });
      const directRead = await extractPageText(page);
      if (directRead.text?.length > 80) readPages.push(directRead);
      cloudflareChallenge = await detectCloudflareChallenge(page);
      if (cloudflareChallenge?.blocked && !isPlaywrightOnlyMode(browserMode)) {
        const retry = await retryCloudflareEngines({
          headless,
          browserMode,
          openTarget: { title, url: directUrl },
          currentEngine: browserEngine,
          context,
          contextKey,
        });
        context = retry.context;
        contextKey = retry.contextKey;
        browserEngine = retry.browserEngine;
        cloudflareChallenge = retry.cloudflareChallenge;
        browserSwitched = retry.browserSwitched;
      }
    } else {
      results = await searchDuckDuckGo(page, query);
    }

    if (!directUrl && !headless && openResults > 0 && results.length > 0) {
      openTarget = inferOpenTarget(query, results);

      if (openTarget?.needsChrome && browserEngine === "chromium" && !isPlaywrightOnlyMode(browserMode)) {
        await closeBrowser(context, { key: contextKey });
        context = null;
        session = await openUrlInEngine({ headless, browserMode: "chrome", engine: "chrome", url: openTarget.url });
        context = session.context;
        contextKey = session.contextKey;
        browserEngine = "chrome";
        browserSwitched = true;
        visitedUrls.push({ title: openTarget.title, url: openTarget.url });
        cloudflareChallenge = await detectCloudflareChallenge(session.page);
        if (cloudflareChallenge?.blocked) {
          const retry = await retryCloudflareEngines({
            headless, browserMode, openTarget, currentEngine: "chrome", context, contextKey,
          });
          context = retry.context;
          contextKey = retry.contextKey;
          browserEngine = retry.browserEngine;
          cloudflareChallenge = retry.cloudflareChallenge;
          browserSwitched = browserSwitched || retry.browserSwitched;
        }
        const chromePage = context.pages().slice(-1)[0] || session.page;
        const chromeRead = await extractPageText(chromePage);
        if (chromeRead.text?.length > 80) readPages.push(chromeRead);
      } else if (openTarget) {
        await humanOpenResult(page, openTarget);
        visitedUrls.push({ title: openTarget.title, url: openTarget.url });
        cloudflareChallenge = await detectCloudflareChallenge(page);

        if (cloudflareChallenge?.blocked && !isPlaywrightOnlyMode(browserMode)) {
          const retry = await retryCloudflareEngines({
            headless, browserMode, openTarget, currentEngine: browserEngine, context, contextKey,
          });
          context = retry.context;
          contextKey = retry.contextKey;
          browserEngine = retry.browserEngine;
          cloudflareChallenge = retry.cloudflareChallenge;
          browserSwitched = retry.browserSwitched;
        }

        const activeForRead = context.pages().slice(-1)[0] || page;
        const opened = await extractPageText(activeForRead);
        if (opened.text?.length > 80) readPages.push(opened);
      }

      if (!visitedUrls.length) {
        skippedTunnel = results.filter((r) => isLikelyTunnelHost(r.url));
      }
    }

    const activePage = context.pages().slice(-1)[0] || context.pages()[0];
    let screenshot = null;
    const readExcerpt = readPages[0]?.text?.slice(0, 500) || null;
    try {
      ({ filePath: screenshot } = await captureScreenshot(activePage, `search-${Date.now()}`));
      await captureMirrorFrame(activePage, {
        status: keepOpen || lingerMs > 0 ? "open" : "done",
        query: query || "",
        browserEngine,
        readExcerpt,
        results: results.slice(0, 5),
        streaming: keepOpen || lingerMs > 0,
        activity: visitedUrls[0]?.url
          ? `Opened ${visitedUrls[0].url}`
          : openOnly ? "Browser ready" : `Found ${results.length} results`,
      });
    } catch {}

    console.log(JSON.stringify({
      ok: true,
      query: query || "",
      engine: openOnly ? "open" : directUrl ? "direct" : "duckduckgo",
      openOnly,
      directUrl: directUrl || null,
      jobBoard: jobBoard || null,
      browserEngine,
      browserMode,
      browserSwitched,
      count: results.length,
      results,
      visitedUrls,
      readPages,
      skippedTunnel,
      cloudflareChallenge,
      screenshot,
      lingerMs,
      keepOpen,
    }));

    if (keepOpen) {
      console.error(`[web-search] ${browserEngine} browser open until CEO says close the browser`);
      let metaTimer = setInterval(async () => {
        try {
          const active = getActivePage();
          if (!active) return;
          await captureMirrorFrame(active, {
            status: "open",
            query,
            browserEngine,
            results: results.slice(0, 5),
            readExcerpt,
            streaming: true,
          });
        } catch (_) {}
      }, 800);

      let cmd = null;
      while ((cmd = await waitForCloseOrSearchCommand())) {
        const page = getActivePage();
        if (!cmd?.query) continue;
        try {
          appendMirrorActivity(`Searching again: ${cmd.query}`);
          const searchPage = page || context.pages().slice(-1)[0] || context.pages()[0] || (await context.newPage());
          const moreResults = await searchDuckDuckGo(searchPage, cmd.query);
          const moreRead = await extractPageText(searchPage);
          const excerpt = moreRead?.text?.slice(0, 500) || null;
          await captureMirrorFrame(searchPage, {
            status: "open",
            query: cmd.query,
            browserEngine,
            results: moreResults.slice(0, 5),
            readExcerpt: excerpt,
            streaming: true,
            activity: `Results for "${cmd.query}"`,
          });
          writeSearchResult({
            id: cmd.id,
            ok: true,
            query: cmd.query,
            results: moreResults,
            browserEngine,
            keepOpen: true,
          });
        } catch (err) {
          writeSearchResult({
            id: cmd.id,
            ok: false,
            query: cmd.query,
            error: String(err?.message || err),
          });
        }
      }
      if (metaTimer) clearInterval(metaTimer);
      writeMirrorState({ status: "closed", streaming: false });
      appendMirrorActivity("Browser closed");
    } else if (lingerMs > 0) {
      console.error(`[web-search] ${browserEngine} browser staying open for ${Math.round(lingerMs / 1000)}s`);
      const deadline = Date.now() + lingerMs;
      while (Date.now() < deadline) {
        await activePage.waitForTimeout(Math.min(500, deadline - Date.now()));
      }
      writeMirrorState({ status: "closed", streaming: false });
    }
    stopInputLoop();
    stopMirrorStream();
    await closeBrowser(context, { key: contextKey });
  } catch (err) {
    stopInputLoop();
    stopMirrorStream();
    if (context) await closeBrowser(context, { key: contextKey });
    console.log(JSON.stringify({ ok: false, query, error: String(err?.message || err) }));
    process.exit(1);
  }
}

main();
