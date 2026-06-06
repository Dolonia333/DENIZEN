#!/usr/bin/env node
// browser-helpers.mjs — Persistent Playwright browser for job automation
// Uses launchPersistentContext to keep login sessions across runs.
// Includes stealth patches, UA rotation, viewport randomization, proxy, per-site profiles.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, cpSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toURL = (p) => pathToFileURL(p).href;

const JELLY_HOME = process.env.JELLY_HOME || join(homedir(), ".denizen");
const BROWSER_BASE = join(JELLY_HOME, "browser", "job-apply");
const CANVAS_DIR = join(JELLY_HOME, "canvas");
export const LUCY_CLOSE_FLAG = join(JELLY_HOME, "browser", "lucy-close.flag");
export const SEARCH_CMD_FILE = join(JELLY_HOME, "browser", "search-command.json");
export const SEARCH_RESULT_FILE = join(JELLY_HOME, "browser", "search-result.json");
export const SEARCH_CMD_FLAG = join(JELLY_HOME, "browser", "search-command.flag");
export const INPUT_CMD_FILE = join(JELLY_HOME, "browser", "input-command.json");
export const INPUT_CMD_FLAG = join(JELLY_HOME, "browser", "input-command.flag");
const NPC_MIRROR_KEY = String(process.env.NPC_MIRROR_KEY || "lucy")
  .toLowerCase()
  .replace(/^xp_/, "")
  .replace(/[^a-z0-9_-]/g, "") || "lucy";
export const LUCY_MIRROR_STATE_FILE = join(JELLY_HOME, "browser", `${NPC_MIRROR_KEY}-mirror-state.json`);
export const LUCY_LIVE_HEARTBEAT_FILE = join(JELLY_HOME, "browser", "live-heartbeat.json");
export const LUCY_MIRROR_FRAME_NAME = `${NPC_MIRROR_KEY}-mirror-live.png`;
export const LUCY_MIRROR_STREAM_NAME = `${NPC_MIRROR_KEY}-mirror-live.jpg`;

export function touchLiveHeartbeat(extra = {}) {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    LUCY_LIVE_HEARTBEAT_FILE,
    JSON.stringify({ at: Date.now(), pid: process.pid, npcKey: NPC_MIRROR_KEY, ...extra }),
  );
}

export function clearLiveHeartbeat() {
  try {
    if (existsSync(LUCY_LIVE_HEARTBEAT_FILE)) unlinkSync(LUCY_LIVE_HEARTBEAT_FILE);
  } catch {}
}

export function clearLucyCloseFlag() {
  try {
    if (existsSync(LUCY_CLOSE_FLAG)) unlinkSync(LUCY_CLOSE_FLAG);
  } catch {}
}

export function signalLucyBrowserClose() {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LUCY_CLOSE_FLAG, String(Date.now()));
}

export async function waitForLucyCloseSignal(pollMs = 2000) {
  while (!existsSync(LUCY_CLOSE_FLAG)) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  clearLucyCloseFlag();
}

export function writeSearchCommand(cmd) {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SEARCH_CMD_FILE, JSON.stringify(cmd));
  writeFileSync(SEARCH_CMD_FLAG, String(Date.now()));
}

export function readSearchCommand() {
  try {
    if (!existsSync(SEARCH_CMD_FILE)) return null;
    return JSON.parse(readFileSync(SEARCH_CMD_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearSearchCommandFlag() {
  try {
    if (existsSync(SEARCH_CMD_FLAG)) unlinkSync(SEARCH_CMD_FLAG);
  } catch {}
}

export function writeBrowserInputCommand(cmd) {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(INPUT_CMD_FILE, JSON.stringify(cmd));
  writeFileSync(INPUT_CMD_FLAG, String(Date.now()));
}

export function readBrowserInputCommand() {
  try {
    if (!existsSync(INPUT_CMD_FILE)) return null;
    return JSON.parse(readFileSync(INPUT_CMD_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearBrowserInputCommandFlag() {
  try {
    if (existsSync(INPUT_CMD_FLAG)) unlinkSync(INPUT_CMD_FLAG);
  } catch {}
}

async function readPageViewport(page) {
  if (!page) return { width: null, height: null };
  try {
    const vp = page.viewportSize();
    if (vp?.width && vp?.height) return vp;
  } catch {}
  try {
    return await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  } catch {}
  return { width: null, height: null };
}

/** Remote CEO UI scroll / tap → Lucy's open Playwright page. */
export async function executeBrowserInput(page, cmd) {
  if (!page || !cmd?.type) return { ok: false, error: "missing page or type" };
  try {
    const vp = await readPageViewport(page);
    const midX = Math.round((vp.width || 960) / 2);
    const midY = Math.round((vp.height || 540) / 2);

    if (cmd.type === "scroll") {
      const deltaX = Number(cmd.deltaX) || 0;
      const deltaY = Number(cmd.deltaY) || 0;
      await page.evaluate(({ dx, dy }) => {
        window.scrollBy(dx, dy);
      }, { dx: deltaX, dy: deltaY });
      try {
        const x = Number.isFinite(cmd.x) ? cmd.x : midX;
        const y = Number.isFinite(cmd.y) ? cmd.y : midY;
        await page.mouse.move(x, y);
        await page.mouse.wheel(deltaX, deltaY);
      } catch (_) {}
      return { ok: true };
    }

    if (cmd.type === "click") {
      const x = Number(cmd.x);
      const y = Number(cmd.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: "bad click coords" };
      }
      await lucyMouseMove(page, x, y);
      await page.mouse.click(x, y);
      await syncLucySprite(page, x, y, { moving: false });
      return { ok: true };
    }

    return { ok: false, error: `unknown input type: ${cmd.type}` };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export function writeSearchResult(result) {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SEARCH_RESULT_FILE, JSON.stringify(result));
}

export function writeMirrorState(patch = {}) {
  const dir = join(JELLY_HOME, "browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let prev = {};
  try {
    if (existsSync(LUCY_MIRROR_STATE_FILE)) {
      prev = JSON.parse(readFileSync(LUCY_MIRROR_STATE_FILE, "utf8"));
    }
  } catch {}
  writeFileSync(
    LUCY_MIRROR_STATE_FILE,
    JSON.stringify({ ...prev, ...patch, updatedAt: Date.now() }),
  );
}

/** Fast frame for live mirror (~6 fps). PNG is used — JPEG capture silently failed on Windows Playwright. */
export async function captureMirrorStreamFrame(page) {
  const canvasDir = resolve(CANVAS_DIR);
  if (!existsSync(canvasDir)) mkdirSync(canvasDir, { recursive: true });
  const pngPath = join(canvasDir, LUCY_MIRROR_FRAME_NAME);
  await page.screenshot({ path: pngPath, type: "png", fullPage: false });
  try {
    const jpegPath = join(canvasDir, LUCY_MIRROR_STREAM_NAME);
    const buf = await page.screenshot({ type: "jpeg", quality: 50, fullPage: false });
    writeFileSync(jpegPath, buf);
  } catch {}
  touchLiveHeartbeat();
  return pngPath;
}

async function drainBrowserInput(page) {
  if (!page || !existsSync(INPUT_CMD_FLAG)) return;
  const cmd = readBrowserInputCommand();
  clearBrowserInputCommandFlag();
  if (!cmd?.id || !cmd?.type) return;
  if (cmd.type !== "scroll" && cmd.type !== "click") return;
  const r = await executeBrowserInput(page, cmd);
  if (!r?.ok) return;
  appendMirrorActivity(
    cmd.type === "click"
      ? `CEO tap ${Math.round(cmd.x)},${Math.round(cmd.y)}`
      : "CEO scrolled page",
  );
}

/**
 * Push JPEG frames continuously while Lucy's browser stays open.
 * @param {() => import('playwright').Page | null | undefined} getPage
 */
export function startMirrorStream(getPage, opts = {}) {
  const intervalMs = opts.intervalMs ?? 180;
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try {
      const page = getPage();
      if (!page) return;
      await drainBrowserInput(page);
      await captureMirrorStreamFrame(page);
    } catch (_) {}
  };
  tick();
  const id = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  return () => { alive = false; clearInterval(id); clearLiveHeartbeat(); };
}

/** Fast CEO input poll — also runs inside startMirrorStream each frame. */
export function startMirrorInputLoop(getPage, opts = {}) {
  const pollMs = opts.pollMs ?? 60;
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try {
      const page = getPage();
      if (!page) return;
      await drainBrowserInput(page);
    } catch (_) {}
  };
  const id = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return () => { alive = false; clearInterval(id); };
}

export function appendMirrorActivity(line) {
  let prev = {};
  try {
    if (existsSync(LUCY_MIRROR_STATE_FILE)) {
      prev = JSON.parse(readFileSync(LUCY_MIRROR_STATE_FILE, "utf8"));
    }
  } catch {}
  const log = Array.isArray(prev.activityLog) ? prev.activityLog.slice(-19) : [];
  log.push({ line: String(line || "").slice(0, 200), at: Date.now() });
  writeMirrorState({ lastActivity: String(line || "").slice(0, 200), activityLog: log });
}

/** Overwrite the live mirror frame used by the in-game browser preview panel. */
export async function captureMirrorFrame(page, extra = {}) {
  const shot = await captureScreenshot(page, LUCY_MIRROR_FRAME_NAME.replace(/\.png$/, ""));
  try { await captureMirrorStreamFrame(page); } catch (_) {}
  let title = extra.title;
  let url = extra.url;
  try { if (!title) title = await page.title(); } catch {}
  try { if (!url) url = page.url(); } catch {}
  if (extra.activity) appendMirrorActivity(extra.activity);
  const vp = await readPageViewport(page);
  writeMirrorState({
    status: extra.status || "open",
    streaming: extra.streaming !== false,
    title: title || null,
    url: url || null,
    query: extra.query !== undefined ? extra.query : prevQuery(extra),
    browserEngine: extra.browserEngine || null,
    readExcerpt: extra.readExcerpt || null,
    results: extra.results || null,
    framePath: shot.filePath,
    viewportWidth: vp.width || null,
    viewportHeight: vp.height || null,
  });
  return shot;
}

function prevQuery(extra) {
  try {
    if (existsSync(LUCY_MIRROR_STATE_FILE)) {
      const j = JSON.parse(readFileSync(LUCY_MIRROR_STATE_FILE, "utf8"));
      return j.query || null;
    }
  } catch {}
  return extra.query || null;
}

/** Wait for CEO close signal OR a follow-up search command (input uses startMirrorInputLoop). */
export async function waitForCloseOrSearchCommand(pollMs = 400) {
  while (!existsSync(LUCY_CLOSE_FLAG)) {
    if (existsSync(SEARCH_CMD_FLAG)) {
      const cmd = readSearchCommand();
      clearSearchCommandFlag();
      if (cmd?.id) return cmd;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  clearLucyCloseFlag();
  return null;
}

/** Reuse open persistent contexts — launching twice on the same profile crashes. */
const _openContexts = new Map(); // `${site}:${headless}` -> BrowserContext
const _contextWaiters = new Map(); // site key -> Promise chain

// ─── UA rotation pool (Chrome 128-135 on Windows 10/11) ─────────────

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
];

// ─── Viewport randomization pool ────────────────────────────────────

const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Per-site browser profile resolution ────────────────────────────

function resolveUserDataDir(site) {
  if (!site) return join(BROWSER_BASE, "user-data");
  const siteDir = join(BROWSER_BASE, site);
  // One-time migration: if per-site dir doesn't exist but old user-data does, copy it
  if (!existsSync(siteDir)) {
    const fallback = join(BROWSER_BASE, "user-data");
    if (existsSync(fallback)) {
      try {
        cpSync(fallback, siteDir, { recursive: true });
      } catch {
        // If copy fails (locked files etc), just create empty
        mkdirSync(siteDir, { recursive: true });
      }
    } else {
      mkdirSync(siteDir, { recursive: true });
    }
  }
  return siteDir;
}

// ─── Main browser launcher ──────────────────────────────────────────

/**
 * Launch a persistent browser context that preserves cookies/localStorage.
 * @param {object} opts
 * @param {boolean} opts.headless - Run headless (default true)
 * @param {string} opts.site - Site name for per-site profile (linkedin, indeed, etc.)
 * @param {string} opts.userDataDir - Override user data dir (ignores site)
 * @param {object} opts.viewport - Override viewport {width, height}
 * @param {string} opts.proxy - Proxy server URL (e.g., "socks5://127.0.0.1:1080")
 * @returns {{ context: BrowserContext, page: Page }}
 */
/**
 * Human-readable label for Lucy's Playwright-driven browser choice.
 * @param {string} engine
 */
export function formatBrowserLabel(engine) {
  if (engine === "brave") return "Playwright + Brave";
  if (engine === "chrome") return "Playwright + Chrome";
  if (engine === "msedge") return "Playwright + Edge";
  return "Playwright Chromium";
}

export function resolveBraveExecutable() {
  if (process.env.BRAVE_BROWSER_PATH && existsSync(process.env.BRAVE_BROWSER_PATH)) {
    return process.env.BRAVE_BROWSER_PATH;
  }
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    local ? join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") : null,
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const TUNNEL_HOST_RE = /(?:^|\.)dolonia\.cloud$/i;
const CF_HEAVY_ATS = new Set(["glassdoor", "indeed", "workday"]);

export function detectATS(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes("linkedin.com/jobs") || lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("indeed.com")) return "indeed";
  if (lower.includes("myworkdayjobs.com") || lower.includes("workday.com")) return "workday";
  if (lower.includes("boards.greenhouse.io") || lower.includes("greenhouse.io")) return "greenhouse";
  if (lower.includes("jobs.lever.co") || lower.includes("lever.co")) return "lever";
  if (lower.includes("icims.com")) return "icims";
  if (lower.includes("glassdoor.com")) return "glassdoor";
  if (lower.includes("ziprecruiter.com")) return "ziprecruiter";
  return "unknown";
}

export function isLikelyTunnelHost(url) {
  try {
    return TUNNEL_HOST_RE.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function siteForEngine(ats, engine) {
  const site = ats || "apply";
  if (!engine || engine === "chromium") return site;
  return `${site}-${engine}`;
}

/**
 * Pick Playwright engine + per-site profile for job apply flows.
 */
export function resolveJobBrowserPlan({ url, browserMode, headless, ats } = {}) {
  const mode = String(browserMode || process.env.LUCY_BROWSER_MODE || "auto").toLowerCase();
  const detected = ats || detectATS(url);
  if (mode === "chrome") {
    return { engine: "chrome", site: siteForEngine(detected, "chrome"), needsCloudflarePass: true, reason: "mode-chrome" };
  }
  if (mode === "msedge" || mode === "edge") {
    return { engine: "msedge", site: siteForEngine(detected, "msedge"), needsCloudflarePass: true, reason: "mode-msedge" };
  }
  if (mode === "playwright" || mode === "chromium") {
    return { engine: "chromium", site: detected, reason: "mode-playwright" };
  }
  if (headless) {
    return { engine: "chromium", site: detected, reason: "headless-pipeline" };
  }
  if (isLikelyTunnelHost(url) || CF_HEAVY_ATS.has(detected)) {
    return {
      engine: "chrome",
      site: siteForEngine(detected, "chrome"),
      needsCloudflarePass: true,
      reason: "cf-heavy-ats",
    };
  }
  return { engine: "chromium", site: detected, reason: "auto-default" };
}

export async function detectCloudflareChallenge(page) {
  try {
    const title = await page.title();
    const body = await page.evaluate(() => (document.body?.innerText || "").slice(0, 2500));
    const hay = `${title}\n${body}`;
    const blocked = /\b(?:additional verification required|just a moment|checking your browser|verify you are human|attention required|cf-browser-verification|challenge-platform|error 1020|error 1015)\b/i.test(hay);
    const rayId = hay.match(/\bRay ID[:\s]*([a-f0-9]{16})\b/i)?.[1] || null;
    return { blocked, rayId, url: page.url() };
  } catch {
    return { blocked: false, rayId: null, url: null };
  }
}

function isPlaywrightOnlyMode(browserMode) {
  const mode = String(browserMode || "").toLowerCase();
  return mode === "playwright" || mode === "chromium";
}

async function _openJobSession({ headless, browserMode, engine, site, url }) {
  const session = await getPersistentBrowser({
    headless,
    site,
    browserMode: engine === "chromium"
      ? (isPlaywrightOnlyMode(browserMode) ? "playwright" : browserMode || "auto")
      : engine,
    preferChrome: engine === "chrome",
    preferMsedge: engine === "msedge",
    needsCloudflarePass: engine !== "chromium",
    channel: engine === "msedge" ? "msedge" : undefined,
  });
  const page = session.page || session.context.pages()[0] || (await session.context.newPage());
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
  }
  const cloudflareChallenge = url ? await detectCloudflareChallenge(page) : { blocked: false };
  return {
    ...session,
    page,
    cloudflareChallenge,
    browserEngine: session.browserEngine || engine,
    ats: site,
  };
}

/**
 * Launch a persistent stealth browser for job apply; retry Chrome/Edge on CF blocks.
 */
export async function launchJobBrowser({ url, headless = false, browserMode } = {}) {
  const mode = String(browserMode || process.env.LUCY_BROWSER_MODE || "auto").toLowerCase();
  const plan = resolveJobBrowserPlan({ url, browserMode: mode, headless });
  let session = await _openJobSession({
    headless,
    browserMode: mode,
    engine: plan.engine,
    site: plan.site,
    url,
  });
  let browserSwitched = false;

  if (session.cloudflareChallenge?.blocked && !isPlaywrightOnlyMode(mode) && session.browserEngine === "chromium") {
    await closeBrowser(session.context, { key: session.contextKey });
    for (const engine of ["chrome", "msedge"]) {
      browserSwitched = true;
      session = await _openJobSession({
        headless,
        browserMode: engine,
        engine,
        site: siteForEngine(detectATS(url), engine),
        url,
      });
      session.cloudflareChallenge = {
        ...session.cloudflareChallenge,
        retriedWith: engine,
      };
      if (!session.cloudflareChallenge.blocked) break;
      await closeBrowser(session.context, { key: session.contextKey });
    }
  }

  console.error(
    `[browser-helpers] job browser: ${formatBrowserLabel(session.browserEngine)} (${plan.reason})`
  );
  return { ...session, browserSwitched, browserMode: mode };
}

/**
 * Pick which browser Playwright should drive.
 * All paths use Playwright — engine picks bundled Chromium vs system Chrome/Edge.
 * Modes: auto | playwright | chromium | chrome | msedge | edge
 * @returns {{ channel: string|null, engine: 'chromium'|'chrome'|'msedge', reason: string }}
 */
export function resolveBrowserChannel(opts = {}) {
  const mode = String(opts.browserMode || process.env.LUCY_BROWSER_MODE || "auto").toLowerCase();
  const headless = opts.headless !== false;
  const chromeChannel = opts.channel || process.env.LUCY_BROWSER_CHANNEL || "chrome";

  if (headless) {
    return { channel: null, engine: "chromium", reason: "headless-playwright" };
  }
  if (mode === "playwright" || mode === "chromium") {
    return { channel: null, engine: "chromium", reason: "mode-playwright" };
  }
  if (mode === "chrome") {
    return { channel: chromeChannel, engine: "chrome", reason: "mode-chrome" };
  }
  if (mode === "msedge" || mode === "edge") {
    return { channel: "msedge", engine: "msedge", reason: "mode-msedge" };
  }
  if (mode === "brave") {
    return { channel: null, engine: "brave", executablePath: resolveBraveExecutable(), reason: "mode-brave" };
  }
  if (opts.channel === "msedge" || opts.preferMsedge) {
    return { channel: "msedge", engine: "msedge", reason: "cloudflare-msedge" };
  }
  if (opts.needsCloudflarePass || opts.preferChrome) {
    return {
      channel: chromeChannel,
      engine: "chrome",
      reason: opts.needsCloudflarePass ? "cloudflare-chrome" : "prefer-chrome",
    };
  }
  return { channel: null, engine: "chromium", reason: "general-playwright" };
}

export function makeContextKey(opts = {}) {
  const site = opts.site || "user-data";
  const headless = opts.headless !== false;
  const plan = resolveBrowserChannel(opts);
  return `${site}:${headless ? "headless" : "headed"}:${plan.engine}`;
}

function _contextKey(opts = {}) {
  return makeContextKey(opts);
}

async function _withBrowserLock(key, fn) {
  const prev = _contextWaiters.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  _contextWaiters.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_contextWaiters.get(key) === gate) _contextWaiters.delete(key);
  }
}

export async function getPersistentBrowser(opts = {}) {
  const headless = opts.headless !== false;
  const key = _contextKey(opts);

  return _withBrowserLock(key, async () => {
    const existing = _openContexts.get(key);
    if (existing) {
      try {
        if (existing.pages().length >= 0) {
          const page = existing.pages()[0] || (await existing.newPage());
          const plan = resolveBrowserChannel(opts);
          return { context: existing, page, reused: true, browserEngine: plan.engine, contextKey: key };
        }
      } catch {
        _openContexts.delete(key);
      }
    }

    const userDataDir = opts.userDataDir || resolveUserDataDir(opts.site);
    const viewport = opts.viewport || randomPick(VIEWPORT_POOL);
    const userAgent = randomPick(UA_POOL);

    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true });
    }

    const launchOpts = {
      headless,
      viewport,
      userAgent,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      bypassCSP: true,
      locale: "en-US",
      timezoneId: "America/Chicago",
    };

    if (opts.proxy) {
      launchOpts.proxy = { server: opts.proxy };
    }

    const plan = resolveBrowserChannel(opts);
    let context = null;
    if (plan.executablePath) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          executablePath: plan.executablePath,
        });
        console.error(`[browser-helpers] Brave (${plan.executablePath}) — ${plan.reason}`);
      } catch (err) {
        if (opts.browserMode === "brave") throw err;
        console.error(`[browser-helpers] Brave unavailable (${err?.message || err}); falling back to Playwright Chromium`);
      }
    }
    if (!context && plan.channel) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, { ...launchOpts, channel: plan.channel });
        console.error(`[browser-helpers] ${plan.engine} (${plan.channel}) — ${plan.reason}`);
      } catch (err) {
        if (opts.browserMode === "chrome" || opts.browserMode === "msedge" || opts.browserMode === "edge") throw err;
        console.error(`[browser-helpers] ${plan.channel} unavailable (${err?.message || err}); falling back to Playwright Chromium`);
      }
    }
    if (!context) {
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && !context; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
          context = await chromium.launchPersistentContext(userDataDir, launchOpts);
          console.error(`[browser-helpers] bundled Chromium — ${plan.reason}`);
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message || err);
          if (!/closed|profile|existing browser session|EBUSY|lock/i.test(msg) || attempt >= 2) {
            throw err;
          }
          console.error(`[browser-helpers] launch retry ${attempt + 1}: ${msg.slice(0, 120)}`);
        }
      }
      if (!context) throw lastErr || new Error("Could not launch browser");
    }
    _openContexts.set(key, context);

    const { applyStealthPatches } = await import(
      toURL(join(__dirname, "stealth-patches.mjs"))
    );
    await applyStealthPatches(context);

    if (!headless) {
      await injectVisibleCursor(context);
    }

    let page = context.pages().find((p) => !p.isClosed()) || null;
    if (!page) {
      try {
        page = await context.newPage();
      } catch (err) {
        _openContexts.delete(key);
        try { await context.close(); } catch {}
        throw err;
      }
    }
    return { context, page, reused: false, browserEngine: plan.engine, contextKey: key };
  });
}

const DENIZEN_ASSET_BASE = process.env.DENIZEN_BASE_URL || process.env.DENIZEN_URL || "http://127.0.0.1:8080";
const LUCY_SPRITE_URL = process.env.LUCY_CURSOR_SPRITE_URL || `${DENIZEN_ASSET_BASE}/assets/Lucy.png`;
const LUCY_BROWSER_SPRITE = process.env.LUCY_BROWSER_SPRITE !== "0";

function _dirFromDelta(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  if (Math.abs(dy) > 0.5) return dy < 0 ? "up" : "down";
  return "down";
}

/** Playwright mouse moves don't fire DOM mousemove — sync the sprite after each move. */
export async function syncLucySprite(page, x, y, opts = {}) {
  if (!page) return;
  try {
    await page.evaluate(({ px, py, moving, dir }) => {
      if (typeof window.__lucySetPointer === "function") {
        window.__lucySetPointer(px, py, { moving: !!moving, dir: dir || "down" });
      }
    }, {
      px: x,
      py: y,
      moving: opts.moving === true,
      dir: opts.dir || "down",
    });
  } catch {}
}

/** Move Playwright mouse and update Lucy's on-page sprite (replaces invisible OS cursor). */
export async function lucyMouseMove(page, x, y, opts = {}) {
  const steps = Math.max(6, opts.steps ?? 18);
  let cx = x;
  let cy = y;
  try {
    ({ x: cx, y: cy } = await page.evaluate(() => ({
      x: window.__lucyLastX ?? Math.round(window.innerWidth / 2),
      y: window.__lucyLastY ?? Math.round(window.innerHeight / 2),
    })));
  } catch (_) {}

  const dir = _dirFromDelta(x - cx, y - cy);
  await syncLucySprite(page, cx, cy, { moving: true, dir });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = cx + (x - cx) * t;
    const my = cy + (y - cy) * t;
    await page.mouse.move(mx, my);
    await syncLucySprite(page, mx, my, { moving: true, dir });
    await page.waitForTimeout(14 + Math.floor(Math.random() * 10));
  }

  try {
    await page.waitForTimeout(90);
    await syncLucySprite(page, x, y, { moving: false, dir });
  } catch (_) {}
}

/**
 * Inject Lucy's pixel sprite (or fallback pointer) into headed browser pages.
 * Hides the OS cursor; automation calls syncLucySprite / lucyMouseMove.
 * @param {import('playwright-core').BrowserContext} context
 */
export async function injectVisibleCursor(context, label = "Lucy") {
  const payload = { spriteUrl: LUCY_SPRITE_URL, label, useSprite: LUCY_BROWSER_SPRITE };
  await context.addInitScript((cfg) => {
    if (window.__lucyCursorInstalled) return;
    window.__lucyCursorInstalled = true;

    const install = () => {
      if (!document.body || document.getElementById("__lucy_sprite") || document.getElementById("__lucy_cursor")) {
        return;
      }

      const hide = document.createElement("style");
      hide.id = "__lucy_hide_cursor";
      hide.textContent = "html,body,*{cursor:none!important}";
      (document.head || document.documentElement).appendChild(hide);

      const FW = 32;
      const FH = 48;
      const SHEET_W = 128;
      const SHEET_H = 192;
      let frame = 0;
      let animTimer = null;
      let facing = "down";
      let lastX = null;
      let lastY = null;
      let idleTimer = null;

      const ripple = (x, y) => {
        const r = document.createElement("div");
        r.style.cssText =
          "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #ff66b3;" +
          `border-radius:50%;width:8px;height:8px;left:${x - 4}px;top:${y - 4}px;opacity:1;transition:all .35s ease-out`;
        document.body.appendChild(r);
        requestAnimationFrame(() => {
          r.style.width = "30px";
          r.style.height = "30px";
          r.style.left = `${x - 15}px`;
          r.style.top = `${y - 15}px`;
          r.style.opacity = "0";
        });
        setTimeout(() => r.remove(), 400);
      };

      if (cfg.useSprite) {
        const sprite = document.createElement("div");
        sprite.id = "__lucy_sprite";
        sprite.title = cfg.label || "Lucy";
        sprite.style.cssText =
          `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:${FW}px;height:${FH}px;` +
          `background-image:url('${cfg.spriteUrl}');background-repeat:no-repeat;background-size:${SHEET_W}px ${SHEET_H}px;` +
          "image-rendering:pixelated;transform:translate(-100px,-100px);will-change:transform;" +
          "filter:drop-shadow(0 2px 2px rgba(0,0,0,.45))";
        const rowForDir = (dir) => (dir === "left" ? 1 : dir === "right" ? 2 : dir === "up" ? 3 : 0);
        const setFrame = (f, dir = facing) => {
          const row = rowForDir(dir);
          sprite.style.backgroundPosition = `-${(f % 4) * FW}px -${row * FH}px`;
        };
        const stopWalk = () => {
          if (animTimer) {
            clearInterval(animTimer);
            animTimer = null;
          }
          setFrame(0, facing);
        };
        const startWalk = () => {
          if (animTimer) return;
          animTimer = setInterval(() => {
            frame += 1;
            setFrame(frame, facing);
          }, 95);
        };
        window.__lucySetPointer = (x, y, opts = {}) => {
          window.__lucyLastX = x;
          window.__lucyLastY = y;
          if (opts.dir) facing = opts.dir;
          sprite.style.transform = `translate(${x - FW / 2}px, ${y - FH + 8}px)`;
          if (opts.moving) {
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
            startWalk();
          } else {
            stopWalk();
          }
        };
        (document.body || document.documentElement).appendChild(sprite);
      } else {
        const cur = document.createElement("div");
        cur.id = "__lucy_cursor";
        cur.innerHTML =
          '<svg width="22" height="30" viewBox="0 0 22 30" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">' +
          '<path d="M2 2 L2 22 L7 17 L11 26 L14 25 L10 16 L17 16 Z" fill="#fff" stroke="#1a1a2e" stroke-width="1.5"/></svg>' +
          `<span style="position:absolute;left:20px;top:14px;background:#ff66b3;color:#fff;font:11px/1.4 sans-serif;padding:1px 6px;border-radius:8px;white-space:nowrap">${cfg.label}</span>`;
        cur.style.cssText =
          "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform";
        window.__lucySetPointer = (x, y) => {
          cur.style.transform = `translate(${x}px,${y}px)`;
        };
        (document.body || document.documentElement).appendChild(cur);
      }

      window.addEventListener("mousedown", (e) => ripple(e.clientX, e.clientY), true);
      window.addEventListener("mousemove", (e) => {
        if (typeof window.__lucySetPointer !== "function") return;
        const x = e.clientX;
        const y = e.clientY;
        let dir = facing;
        if (lastX != null && lastY != null) {
          const dx = x - lastX;
          const dy = y - lastY;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? "left" : "right";
            else dir = dy < 0 ? "up" : "down";
            facing = dir;
          }
        }
        lastX = x;
        lastY = y;
        const moving = e.movementX !== 0 || e.movementY !== 0;
        window.__lucySetPointer(x, y, { moving, dir });
        if (moving) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            idleTimer = null;
            window.__lucySetPointer(x, y, { moving: false, dir });
          }, 140);
        }
      }, true);
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
    else install();
  }, payload);

}


/**
 * Navigate to a URL with random delay and networkidle wait.
 */
export async function safeNavigate(page, url, opts = {}) {
  const minDelay = opts.minDelay ?? 2000;
  const maxDelay = opts.maxDelay ?? 6000;
  const delay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
  await new Promise((r) => setTimeout(r, delay));
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
}

/**
 * Capture a screenshot and save it to the canvas dir for inline preview.
 * @returns {{ filePath: string, canvasUrl: string, previewUrl: string }}
 */
export async function captureScreenshot(page, name) {
  const canvasDir = resolve(CANVAS_DIR);
  if (!existsSync(canvasDir)) {
    mkdirSync(canvasDir, { recursive: true });
  }
  const filename = name.endsWith(".png") ? name : `${name}.png`;
  const filePath = join(canvasDir, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  const canvasUrl = `/__openclaw__/canvas/${filename}`;
  let previewUrl = canvasUrl;
  try {
    const pngBytes = readFileSync(filePath);
    previewUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
  } catch {}
  return { filePath, canvasUrl, previewUrl };
}

/**
 * Close the browser context gracefully.
 */
export async function closeBrowser(context, opts = {}) {
  if (!context) return;
  const key = opts.key || [..._openContexts.entries()].find(([, ctx]) => ctx === context)?.[0];
  try {
    await context.close();
  } catch {
    // Already closed
  }
  if (key) _openContexts.delete(key);
}

/** Close every open Lucy browser context (all engines/sites). */
export async function closeAllLucyBrowsers() {
  signalLucyBrowserClose();
  const contexts = [..._openContexts.values()];
  _openContexts.clear();
  for (const ctx of contexts) {
    try { await ctx.close(); } catch {}
  }
}

// ─── CLI test ────────────────────────────────────────────────────

if (process.argv[2] === "--test") {
  console.log("Launching persistent browser (visible) with stealth patches...");
  const { context, page } = await getPersistentBrowser({ headless: false });
  await page.goto("https://bot.sannysoft.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  const { filePath } = await captureScreenshot(page, "browser-stealth-test");
  console.log(JSON.stringify({ success: true, title: await page.title(), screenshot: filePath }));
  await new Promise((r) => setTimeout(r, 5000));
  await closeBrowser(context);
  console.log("Browser closed.");
}
