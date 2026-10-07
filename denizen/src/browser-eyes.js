'use strict';
/**
 * browser-eyes.js — ChatGPT / MCP "you are the eyes" browser control.
 *
 * Exposes screenshot + act over Lucy's live Playwright mirror session so an
 * external model (ChatGPT Custom GPT, Claude MCP) can drive the loop itself
 * instead of Denizen's computer-use vision provider.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jellyPaths = require('../jelly/paths');
const { normalizeNpcKey, getNpcBrowserPaths } = require('./npc-browser-paths');

const FRAME_TOKENS = new Map(); // token -> { npcKey, path, exp }
const TOKEN_TTL_MS = 90_000;
const MAX_JPEG_BYTES = 220_000;

let _deps = {
  writeBrowserInput: null,
  isBrowserLive: null,
  openBrowser: null,
  getPublicBaseUrl: null,
  readMirrorState: null,
};

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function _cleanupTokens() {
  const now = Date.now();
  for (const [tok, meta] of FRAME_TOKENS) {
    if (!meta?.exp || meta.exp < now) FRAME_TOKENS.delete(tok);
  }
}

function _latestFramePath(npcKey) {
  const key = normalizeNpcKey(npcKey || 'lucy');
  const paths = getNpcBrowserPaths(key);
  const candidates = [
    paths.streamFile,
    paths.frameFile,
    path.join(jellyPaths.canvasDir(), `${key}-mirror-live.jpg`),
    path.join(jellyPaths.canvasDir(), `${key}-mirror-live.png`),
  ];
  let best = null;
  let bestMtime = 0;
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (st.mtimeMs > bestMtime && st.size > 80) {
        bestMtime = st.mtimeMs;
        best = { path: p, mtimeMs: st.mtimeMs, format: p.endsWith('.png') ? 'png' : 'jpeg' };
      }
    } catch (_) {}
  }
  return best;
}

function _readMirrorState(npcKey) {
  if (typeof _deps.readMirrorState === 'function') {
    try { return _deps.readMirrorState(npcKey) || {}; } catch (_) { return {}; }
  }
  const paths = getNpcBrowserPaths(normalizeNpcKey(npcKey || 'lucy'));
  try {
    if (fs.existsSync(paths.stateFile)) {
      return JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function _isLive(npcKey) {
  if (typeof _deps.isBrowserLive === 'function') {
    try { return !!_deps.isBrowserLive(npcKey); } catch (_) {}
  }
  const frame = _latestFramePath(npcKey);
  if (!frame) return false;
  return Date.now() - frame.mtimeMs < 8000;
}

function mintFrameToken(npcKey, framePath) {
  _cleanupTokens();
  const token = crypto.randomBytes(18).toString('hex');
  FRAME_TOKENS.set(token, {
    npcKey: normalizeNpcKey(npcKey || 'lucy'),
    path: framePath,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

function resolveFrameToken(token) {
  _cleanupTokens();
  const meta = FRAME_TOKENS.get(String(token || ''));
  if (!meta) return null;
  if (meta.exp < Date.now()) {
    FRAME_TOKENS.delete(token);
    return null;
  }
  return meta;
}

function _compressFrame(buf, format) {
  // Prefer JPEG under size cap for ChatGPT Action payloads.
  if (format === 'jpeg' && buf.length <= MAX_JPEG_BYTES) {
    return { buf, mime: 'image/jpeg' };
  }
  if (format === 'jpeg') {
    // Already jpeg but large — still return (ChatGPT may truncate); caller can use URL.
    return { buf, mime: 'image/jpeg' };
  }
  return { buf, mime: 'image/png' };
}

/**
 * Capture current mirror frame for ChatGPT / MCP eyes loop.
 */
function browserScreenshot(npcKey, { includeBase64 = true, baseUrl = null } = {}) {
  const key = normalizeNpcKey(npcKey || 'lucy');
  const live = _isLive(key);
  const frame = _latestFramePath(key);
  const state = _readMirrorState(key);
  if (!frame) {
    return {
      ok: false,
      error: 'no_browser_frame',
      hint: 'Call browserOpen first (or ask Lucy to search) so a live Playwright session exists.',
      live: false,
      npc_key: key,
    };
  }

  let buf;
  try { buf = fs.readFileSync(frame.path); }
  catch (err) {
    return { ok: false, error: `read_frame_failed: ${err.message}`, npc_key: key };
  }
  const packed = _compressFrame(buf, frame.format);
  const token = mintFrameToken(key, frame.path);
  const publicBase = String(baseUrl || _deps.getPublicBaseUrl?.() || '').replace(/\/$/, '');
  const screenshotUrl = publicBase
    ? `${publicBase}/api/npc-sync/browser-frame?token=${token}`
    : `/api/npc-sync/browser-frame?token=${token}`;

  const out = {
    ok: true,
    npc_key: key,
    live,
    url: state.url || null,
    title: state.title || null,
    query: state.query || null,
    last_activity: state.lastActivity || null,
    viewport: {
      width: state.viewportWidth || 1280,
      height: state.viewportHeight || 800,
    },
    screenshot_url: screenshotUrl,
    screenshot_markdown: `![${key} browser](${screenshotUrl})`,
    frame_age_ms: Math.round(Date.now() - frame.mtimeMs),
    mime: packed.mime,
    hint: live
      ? 'YOU are the eyes. Prefer browserStep (act+verify). Look at screenshot_markdown / screenshot_jpeg_base64 before the next step.'
      : 'Frame may be stale — call browserBegin or ask Lucy to search again for a live session.',
  };
  if (includeBase64 && packed.buf.length <= MAX_JPEG_BYTES) {
    out.screenshot_jpeg_base64 = packed.buf.toString('base64');
  } else if (includeBase64) {
    out.screenshot_jpeg_base64 = null;
    out.screenshot_note = 'Frame too large for Action JSON — open screenshot_url or screenshot_markdown.';
  }
  return out;
}

/**
 * Perform one action on the live browser (click/type/key/scroll/navigate).
 */
async function browserAct(npcKey, action = {}) {
  const key = normalizeNpcKey(npcKey || 'lucy');
  const type = String(action.type || action.action || '').toLowerCase();
  if (!type) return { ok: false, error: 'type required (click|type|key|scroll|navigate)' };

  if (type === 'navigate' || type === 'open') {
    const url = String(action.url || action.text || '').trim();
    if (!url) return { ok: false, error: 'navigate requires url' };
    if (typeof _deps.openBrowser !== 'function') {
      return { ok: false, error: 'openBrowser not configured' };
    }
    const opened = await _deps.openBrowser(key, { url, openOnly: !url });
    return {
      ok: !!opened?.ok,
      type: 'navigate',
      url,
      detail: opened?.summary || opened?.error || null,
      next: 'Call browserScreenshot after ~2s to see the page.',
    };
  }

  if (!_isLive(key)) {
    return {
      ok: false,
      error: 'browser_not_live',
      hint: 'Call browserOpen first so Lucy has a live Playwright window.',
    };
  }
  if (typeof _deps.writeBrowserInput !== 'function') {
    return { ok: false, error: 'writeBrowserInput not configured' };
  }

  const cmd = {
    id: `eyes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    x: Number(action.x),
    y: Number(action.y),
    deltaX: Number(action.deltaX) || 0,
    deltaY: Number(action.deltaY) || Number(action.amount) || 0,
    text: action.text != null ? String(action.text) : undefined,
    key: action.key != null ? String(action.key) : (action.text != null && type === 'key' ? String(action.text) : undefined),
  };

  if (type === 'click' && (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))) {
    return { ok: false, error: 'click requires x and y (viewport pixels from screenshot)' };
  }
  if (type === 'type' && !cmd.text) return { ok: false, error: 'type requires text' };
  if (type === 'key' && !(cmd.key || cmd.text)) return { ok: false, error: 'key requires key' };
  if (!['click', 'type', 'key', 'scroll'].includes(type)) {
    return { ok: false, error: `unsupported type: ${type}` };
  }

  const queued = _deps.writeBrowserInput(cmd);
  return {
    ok: !!queued,
    queued: !!queued,
    type,
    cmd_id: cmd.id,
    next: 'Wait ~0.5–1s then call browserScreenshot to verify.',
  };
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function browserOpen(npcKey, opts = {}) {
  const key = normalizeNpcKey(npcKey || 'lucy');
  if (typeof _deps.openBrowser !== 'function') {
    return { ok: false, error: 'openBrowser not configured' };
  }
  const url = opts.url ? String(opts.url).trim() : '';
  const query = opts.query ? String(opts.query).trim() : '';
  const opened = await _deps.openBrowser(key, {
    url: url || null,
    query: query || null,
    openOnly: !url && !query,
  });
  return {
    ok: !!opened?.ok,
    npc_key: key,
    url: url || null,
    query: query || null,
    summary: opened?.summary || opened?.error || null,
    next: 'Call browserBegin (open+first shot) or browserScreenshot, then browserStep for each action+verify. Do not claim done without a fresh screenshot.',
  };
}

/**
 * Start a verified eyes session: open browser, wait for a frame, return first screenshot.
 */
async function browserBegin(npcKey, opts = {}) {
  const opened = await browserOpen(npcKey, opts);
  if (!opened.ok) return opened;
  const waitMs = Math.min(Math.max(Number(opts.wait_ms) || 2500, 500), 8000);
  await _sleep(waitMs);
  const shot = browserScreenshot(npcKey, {
    includeBase64: opts.include_base64 !== false,
    baseUrl: opts.baseUrl || _deps.getPublicBaseUrl?.(),
  });
  return {
    ok: !!shot.ok,
    phase: 'begin',
    open: opened,
    screenshot: shot,
    workflow: EFFECTIVE_WORKFLOW,
    next: shot.ok
      ? 'Describe ONLY what you see in screenshot. Then browserStep for the next click/type. Never invent UI.'
      : 'Browser opened but no frame yet — wait 2s and call browserScreenshot.',
  };
}

/**
 * Atomic anti-hallucination step: act → wait → screenshot (verify).
 * ChatGPT should prefer this over bare browserAct.
 */
async function browserStep(npcKey, action = {}) {
  const key = normalizeNpcKey(npcKey || 'lucy');
  const before = browserScreenshot(key, {
    includeBase64: false,
    baseUrl: action.baseUrl || _deps.getPublicBaseUrl?.(),
  });
  const act = await browserAct(key, action);
  if (!act.ok) {
    return {
      ok: false,
      phase: 'step',
      action: act,
      before,
      error: act.error,
      hint: act.hint || 'Fix the action and retry browserStep.',
    };
  }
  const waitMs = Math.min(Math.max(Number(action.wait_ms) || 900, 300), 5000);
  await _sleep(waitMs);
  const after = browserScreenshot(key, {
    includeBase64: action.include_base64 !== false,
    baseUrl: action.baseUrl || _deps.getPublicBaseUrl?.(),
  });
  return {
    ok: !!after.ok,
    phase: 'step',
    action: act,
    before: {
      url: before.url,
      title: before.title,
      last_activity: before.last_activity,
      frame_age_ms: before.frame_age_ms,
    },
    after,
    verify: {
      must_describe_after: true,
      rule: 'Describe the AFTER screenshot. If the expected change is missing, correct with another browserStep — do not claim success.',
    },
    next: 'From the AFTER frame only: either browserStep again or stop and summarize what you verified.',
  };
}

/** Canonical no-API-key workflow for ChatGPT Plus + Denizen Connect AI. */
const EFFECTIVE_WORKFLOW = [
  '1. browserBegin { url or query } — opens Lucy\'s browser and returns the first real screenshot.',
  '2. Describe ONLY what that screenshot shows (URL, title, visible buttons/text). Never invent UI.',
  '3. browserStep { type, x, y | text | key } — performs ONE action and returns a fresh AFTER screenshot.',
  '4. Describe the AFTER screenshot. If wrong, browserStep to correct. If done, summarize verified facts.',
  '5. Human can watch the same feed in Denizen 🌐 (Watch / Drive / Point).',
  '6. Do NOT use runNpcSkill computer-use for web work when browserBegin/browserStep work — that path can hallucinate without your eyes.',
  '7. Local LM Studio vision is optional backup only; ChatGPT Plus remains the referee.',
].join(' ');

function chatgptEyesInstructions() {
  return [
    'WEB WORK (default — no API keys): YOU are the eyes and referee.',
    EFFECTIVE_WORKFLOW,
    'Prefer browserBegin + browserStep over browserAct alone (Step includes verify screenshot).',
    'Never say a click/type succeeded without describing the AFTER screenshot from browserStep.',
  ].join(' ');
}

function readFrameBytesForToken(token) {
  const meta = resolveFrameToken(token);
  if (!meta) return null;
  try {
    if (!fs.existsSync(meta.path)) return null;
    const buf = fs.readFileSync(meta.path);
    const mime = meta.path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { buf, mime, npcKey: meta.npcKey };
  } catch (_) {
    return null;
  }
}

module.exports = {
  configure,
  browserScreenshot,
  browserAct,
  browserOpen,
  browserBegin,
  browserStep,
  EFFECTIVE_WORKFLOW,
  chatgptEyesInstructions,
  mintFrameToken,
  resolveFrameToken,
  readFrameBytesForToken,
  _latestFramePath,
  _isLive,
};
