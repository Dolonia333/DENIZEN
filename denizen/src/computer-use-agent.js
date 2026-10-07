'use strict';
/**
 * Computer Use Agent
 *
 * Gives Lucy the ability to control a real browser — take screenshots,
 * click, type, scroll — using Claude's computer-use API (or Kimi / LM Studio
 * vision function-calling), in the same general style as Muse / Grok
 * computer-use bots.
 *
 * Flow:
 *   1. Launch a VISIBLE stealth browser via shared browser-helpers (Playwright Chromium/Chrome/Edge).
 *   2. Mirror frames into the CEO browser-mirror panel (heartbeat + live JPEG/PNG).
 *   3. Loop: screenshot → vision model (computer_use tool) → execute action.
 *   4. Broadcast progress events back to Denizen WS so Lucy animates.
 *   5. Leave browser open briefly after finishing so the CEO can review.
 *
 * taskMode:
 *   - 'general'   — arbitrary browser tasks (chat / skill / API)
 *   - 'job-apply' — form-fill only; never Submit/Apply (legacy job path)
 *
 * Requires:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * API key: ANTHROPIC_API_KEY env var (same one used for Claude NPC brains).
 */

const https = require('https');
const fs    = require('node:fs');
const path  = require('node:path');
const { pathToFileURL } = require('node:url');

const jellyPaths = require('../jelly/paths');
const BROWSER_HELPERS = jellyPaths.browserHelpersPath();
const APPLY_LINGER_MS = Number(process.env.LUCY_APPLY_LINGER_MS || 4 * 60 * 1000);

let _browserHelpers = null;
async function _loadBrowserHelpers() {
  if (!_browserHelpers) {
    _browserHelpers = import(pathToFileURL(BROWSER_HELPERS).href);
  }
  return _browserHelpers;
}

const VIEWPORT_W  = 1280;
const VIEWPORT_H  = 800;
const MAX_STEPS   = 50;       // safety cap
const STEP_DELAY  = 600;      // ms between action → screenshot cycles

// Default provider preference order — first one with a key/config wins.
// openai (gpt-4o) lets ChatGPT's model be the eyes inside the Denizen loop.
const PROVIDER_PREFERENCE = ['anthropic', 'openai', 'kimi', 'lmstudio'];

// ── HTTP helper ───────────────────────────────────────────────────────────

function _httpPost(opts, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ ...opts, 'Content-Length': Buffer.byteLength(data) }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Bad JSON: ' + raw.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Anthropic API (native computer_use tool) ─────────────────────────────

function _postAnthropic(apiKey, messages, systemPrompt) {
  return _httpPost({
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'computer-use-2024-10-22',
      'x-api-key': apiKey,
    },
  }, {
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    tools: [{
      type: 'computer_20241022',
      name: 'computer',
      display_width_px: VIEWPORT_W,
      display_height_px: VIEWPORT_H,
    }],
    messages,
  });
}

// Parse Anthropic response → { text, actions[], done }
function _parseAnthropic(response) {
  if (response.error) return { error: response.error?.message || JSON.stringify(response.error) };
  const content = response.content || [];
  const text = content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  const actions = content
    .filter(b => b.type === 'tool_use' && b.name === 'computer')
    .map(b => ({ ...b.input, _tool_use_id: b.id }));
  return { text, actions, done: response.stop_reason === 'end_turn', rawContent: content };
}

// Build next Anthropic user message (tool_result with screenshot)
function _anthropicNextMsg(screenshotB64, lastActions) {
  if (!lastActions?.length) {
    return {
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotB64 } }],
    };
  }
  return {
    role: 'user',
    content: lastActions.map(a => ({
      type: 'tool_result',
      tool_use_id: a._tool_use_id,
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotB64 } }],
    })),
  };
}

// ── Kimi K2 (OpenAI-compatible, function calling + vision) ───────────────
// Kimi K2 doesn't have a native computer-use tool, so we define the same
// actions as standard JSON functions and parse the tool_calls response.

const KIMI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'computer_action',
      description: 'Perform an action on the visible browser screen. Always take a screenshot first to see the current state.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['screenshot', 'left_click', 'double_click', 'right_click',
                   'mouse_move', 'type', 'key', 'scroll'],
            description: 'The action to take on the browser',
          },
          coordinate: {
            type: 'array', items: { type: 'number' },
            description: '[x, y] pixel coordinates (required for click/scroll/move)',
          },
          text: { type: 'string', description: 'Text to type, or key name (Enter, Tab, Escape, etc.)' },
          scroll_direction: { type: 'string', enum: ['up', 'down'] },
          scroll_amount:    { type: 'number', description: 'Scroll units (default 3)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description: 'Call this when all form fields are filled and the task is complete.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_blocked',
      description: 'Call this if you cannot continue (captcha, login wall, etc.).',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
      },
    },
  },
];

// Shared OpenAI-compatible POST — used by Kimi, LM Studio, and any future
// provider that speaks the OpenAI chat-completions API.
function _postOpenAICompat(apiKey, messages, systemPrompt, { baseUrl, model, http = false, sampling = null } = {}) {
  const url = new URL('/v1/chat/completions', baseUrl);
  const isHttp = http || url.protocol === 'http:';
  const transport = isHttp ? require('http') : https;
  const port = isHttp ? (Number(url.port) || 80) : (Number(url.port) || 443);

  const body = JSON.stringify({
    model,
    max_tokens: 1024,
    ...(sampling && typeof sampling === 'object' ? sampling : {}),
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools: KIMI_TOOLS,
    tool_choice: 'auto',
  });

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (apiKey || 'lm-studio'),
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Bad JSON: ' + raw.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Convenience wrappers
function _postKimi(apiKey, messages, systemPrompt, baseUrl = 'https://api.moonshot.cn') {
  return _postOpenAICompat(apiKey, messages, systemPrompt, { baseUrl, model: 'kimi-k2' });
}

async function _postLmStudio(messages, systemPrompt, { baseUrl = 'http://localhost:1234', model } = {}) {
  // Harness parity (A+ plan P0.1): host URL, model tier, and sampling are
  // resolved by the harness — this module keeps its own POST only because
  // the harness gate doesn't speak OpenAI tool-calls yet. No tier or
  // sampling decision is made locally anymore.
  let resolvedBase = baseUrl;
  let resolvedModel = model;
  let sampling = null;
  try {
    const { getActiveHarness } = require('./denizen-harness');
    const h = getActiveHarness?.();
    if (h) {
      const runtime = await h.probeInference({ timeoutMs: 2500 }).catch(() => null);
      if (runtime?.url) resolvedBase = runtime.url;
      // Computer-use plans multi-step tool sequences — heavy-tier work.
      const m = h.resolveTier('heavy', runtime);
      if (m) resolvedModel = model || m;
      sampling = h.modules?.inference?.samplingFor?.({ kind: 'code' }) || null;
    }
  } catch (_) { /* harness not constructed yet — env fallback below */ }
  return _postOpenAICompat(
    process.env.LM_STUDIO_API_KEY || 'lm-studio',
    messages, systemPrompt,
    {
      baseUrl: resolvedBase,
      model: resolvedModel || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
      http: true,
      sampling,
    }
  );
}

// Parse Kimi response → { text, actions[], done }
function _parseKimi(response) {
  if (response.error) return { error: response.error?.message || JSON.stringify(response.error) };
  const choice = response.choices?.[0];
  if (!choice) return { error: 'No choices in response' };
  const msg = choice.message || {};
  // Reasoning models (Ministral, Qwen3, DeepSeek-R1) put chain-of-thought in
  // reasoning_content and leave content empty — fall back so we always get text
  const text = msg.content || msg.reasoning_content || '';
  const toolCalls = msg.tool_calls || [];
  const actions = [];
  let done = false;

  for (const tc of toolCalls) {
    let args;
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) { args = {}; }
    if (tc.function?.name === 'computer_action') {
      actions.push({ ...args, _tool_call_id: tc.id, _tool_name: 'computer_action' });
    } else if (tc.function?.name === 'task_done') {
      done = true;
    } else if (tc.function?.name === 'task_blocked') {
      return { text: 'TASK_BLOCKED: ' + (args.reason || 'unknown'), actions: [], done: true };
    }
  }

  if (!toolCalls.length && choice.finish_reason === 'stop') done = true;
  if (/TASK_COMPLETE|task_done/i.test(text)) done = true;

  return { text, actions, done, rawMsg: msg, toolCalls };
}

// Build next Kimi user message (tool results with screenshot)
function _kimiNextMsg(screenshotB64, lastToolCalls) {
  const imageContent = [
    { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
    { type: 'text', text: 'Current browser state (screenshot above). Continue filling the form.' },
  ];

  if (!lastToolCalls?.length) {
    return { role: 'user', content: imageContent };
  }

  // Return tool results for each call, then a fresh screenshot message
  const toolResults = lastToolCalls.map(tc => ({
    role: 'tool',
    tool_call_id: tc._tool_call_id,
    content: 'Action executed. New screenshot will follow.',
  }));

  return [
    ...toolResults,
    { role: 'user', content: imageContent },
  ];
}

// ── action executor ───────────────────────────────────────────────────────

const KEY_MAP = {
  'Return': 'Enter', 'BackSpace': 'Backspace', 'Delete': 'Delete',
  'Tab': 'Tab', 'Escape': 'Escape', 'super': 'Meta',
  'ctrl+a': 'Control+a', 'ctrl+c': 'Control+c', 'ctrl+v': 'Control+v',
};

async function _execute(page, input) {
  const action = input.action;
  const [x, y] = input.coordinate || [0, 0];

  switch (action) {
    case 'screenshot':
      break; // handled at top of loop
    case 'left_click':
      await page.mouse.click(x, y);
      break;
    case 'double_click':
      await page.mouse.dblclick(x, y);
      break;
    case 'right_click':
      await page.mouse.click(x, y, { button: 'right' });
      break;
    case 'middle_click':
      await page.mouse.click(x, y, { button: 'middle' });
      break;
    case 'mouse_move':
      await page.mouse.move(x, y);
      break;
    case 'left_click_drag':
      await page.mouse.move(x, y);
      await page.mouse.down();
      if (input.end_coordinate) {
        await page.mouse.move(input.end_coordinate[0], input.end_coordinate[1]);
      }
      await page.mouse.up();
      break;
    case 'type':
      if (input.text) await page.keyboard.type(String(input.text), { delay: 30 });
      break;
    case 'key':
      if (input.text) {
        const mapped = KEY_MAP[input.text] || input.text;
        await page.keyboard.press(mapped);
      }
      break;
    case 'scroll': {
      const dir = input.scroll_direction === 'up' ? -1 : 1;
      const amt = (input.scroll_amount || 3) * 120;
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, dir * amt);
      break;
    }
    default:
      console.warn('[ComputerUseAgent] Unknown action:', action);
  }
}

// ── prompts ───────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a computer-use run.
 * @param {{ instruction: string, profile?: object|null, taskMode?: string }} opts
 */
function buildSystemPrompt({ instruction, profile = null, taskMode = 'general' } = {}) {
  const mode = String(taskMode || 'general').toLowerCase() === 'job-apply' ? 'job-apply' : 'general';
  const profileLines = profile ? [
    'Applicant profile (use when filling forms):',
    `  Full Name:  ${profile.name || ''}`,
    `  Email:      ${profile.email || '(leave blank if empty)'}`,
    `  Phone:      ${profile.phone || '(leave blank if empty)'}`,
    `  Location:   ${profile.location || ''}`,
    `  LinkedIn:   ${profile.linkedin || ''}`,
    `  GitHub:     ${profile.github || ''}`,
    `  Portfolio:  ${profile.portfolio || ''}`,
    `  Job Title:  ${profile.title || ''}`,
    `  Summary:    ${profile.summary || ''}`,
    `  Skills:     ${(profile.skills || []).slice(0, 10).join(', ')}`,
    `  Years exp:  ${profile.autofillDefaults?.yearsExperience || '3+'}`,
    `  Work auth:  ${profile.autofillDefaults?.workAuthorization || 'US Citizen'}`,
    `  Sponsorship:${profile.autofillDefaults?.requiresSponsorship ? 'Yes' : 'No'}`,
    `  Remote:     ${profile.autofillDefaults?.remotePreference || 'remote'}`,
  ].join('\n') : '';

  if (mode === 'job-apply') {
    return [
      'You are Lucy, an AI secretary controlling a real web browser.',
      `Task: ${instruction}`,
      '',
      profileLines,
      '',
      'Rules:',
      '- Always start with a screenshot to see the current page.',
      '- Scroll down to find all form fields.',
      '- Fill every field you can using the profile above.',
      '- For cover letter / "Why do you want to work here?" fields, write 2-3 sentences.',
      '- Do NOT click Submit or Apply — fill everything, then signal task_done.',
      '- If you hit Cloudflare "Additional Verification Required", Turnstile, or a captcha, call task_blocked — tell the CEO to complete it in the browser window.',
      '- Type slowly and scroll naturally — bot-like speed gets blocked.',
    ].filter(Boolean).join('\n');
  }

  return [
    'You are Lucy, Denizen\'s browser computer-use agent — same class of capability as Muse / Grok computer-use bots.',
    'You control a real headed Playwright browser the CEO can watch in the live browser mirror.',
    `Task: ${instruction}`,
    '',
    profileLines,
    '',
    'Rules:',
    '- Always start with a screenshot to see the current page.',
    '- Complete the task end-to-end: navigate, click, type, scroll, extract what you need.',
    '- Prefer staying on the web page the CEO asked about; do not open unrelated sites.',
    '- When filling forms, use the profile above if present; otherwise ask via task_blocked if required data is missing.',
    '- Do NOT submit payments, purchases, or irreversible destructive actions unless the task explicitly says to.',
    '- Job applications: do NOT click Submit/Apply unless the task explicitly says to submit.',
    '- If you hit Cloudflare Turnstile, captcha, or a login wall you cannot pass, call task_blocked with a clear reason.',
    '- When finished, call task_done with a short summary of what you did and what the CEO should know.',
    '- Type at a natural pace; avoid bot-like bursts that trigger anti-automation.',
  ].filter(Boolean).join('\n');
}

// ── main entry point ──────────────────────────────────────────────────────

/**
 * Run a browser automation task with full Claude computer-use loop.
 *
 * @param {object} opts
 *   @param {string}   opts.instruction  Natural language task description
 *   @param {string}   [opts.url]        Starting URL to navigate to
 *   @param {object}   [opts.profile]    User profile for form data
 *   @param {function} [opts.broadcast]  fn(wsMsg) to push events to the game
 *   @param {string}   [opts.provider]   'anthropic' | 'kimi' | 'lmstudio' (auto-detects if omitted)
 *   @param {string}   [opts.apiKey]     Override API key
 *   @param {string}   [opts.taskMode]   'general' | 'job-apply' (default general)
 *   @param {boolean}  [opts.mirror]     Feed live frames to browser mirror (default true)
 * @returns {Promise<{ok:boolean, steps:number, provider:string, error?:string}>}
 */

// Read all provider credentials from ~/.openclaw/openclaw.json + env
function _loadProviders() {
  const out = { anthropic: null, openai: null, kimi: null, lmstudio: null };

  // Env vars
  if (process.env.ANTHROPIC_API_KEY) out.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.OPENAI_API_KEY) {
    out.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }
  if (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) {
    out.kimi = { apiKey: process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY };
  }
  // LM Studio is always available locally — no key needed, just needs a vision model loaded
  out.lmstudio = {
    baseUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
    model:   process.env.LM_STUDIO_VISION_MODEL || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
    apiKey:  process.env.LM_STUDIO_API_KEY || 'lm-studio',
    http: true,
  };

  // jelly.json (overrides env if set)
  try {
    const cfg = require('../jelly/config-provider').getConfig();
    const p = cfg?.models?.providers || {};
    if (p.anthropic?.apiKey) out.anthropic = { apiKey: p.anthropic.apiKey };
    if (p.openai?.apiKey) {
      out.openai = {
        apiKey: p.openai.apiKey,
        baseUrl: p.openai.baseUrl || 'https://api.openai.com',
        model: p.openai.visionModel || p.openai.model || 'gpt-4o',
      };
    }
    if (p.moonshot?.apiKey)  out.kimi = {
      apiKey: p.moonshot.apiKey,
      baseUrl: p.moonshot.baseUrl || 'https://api.moonshot.cn',
    };
    // Allow overriding LM Studio URL/model from openclaw.json too
    if (p.lmstudio?.baseUrl || p.lmstudio?.model) {
      out.lmstudio = {
        ...out.lmstudio,
        baseUrl: p.lmstudio.baseUrl || out.lmstudio.baseUrl,
        model:   p.lmstudio.visionModel || p.lmstudio.model || out.lmstudio.model,
        apiKey:  p.lmstudio.apiKey || out.lmstudio.apiKey,
      };
    }
  } catch (_) {}
  return out;
}

async function runBrowserTask({
  instruction,
  url,
  profile,
  broadcast,
  provider,
  apiKey,
  browserMode,
  taskMode = 'general',
  mirror = true,
} = {}) {
  // Pick provider
  const providers = _loadProviders();
  if (apiKey) {
    // Explicit key override — respect explicit provider or guess from preference
    if (provider === 'kimi') providers.kimi = { ...(providers.kimi || {}), apiKey };
    else if (provider === 'openai') {
      providers.openai = { ...(providers.openai || {}), apiKey, baseUrl: 'https://api.openai.com', model: 'gpt-4o' };
    } else {
      providers.anthropic = { apiKey };
    }
  }

  let chosenProvider = provider;
  if (!chosenProvider) {
    // Auto-select: first in preference list that has a key
    chosenProvider = PROVIDER_PREFERENCE.find(p => providers[p]?.apiKey) || null;
  }

  if (!chosenProvider || !providers[chosenProvider]?.apiKey) {
    return {
      ok: false,
      error: 'No API key found for computer-use. Add anthropic.apiKey or moonshot.apiKey to denizen/config/jelly.json',
    };
  }

  const providerCfg = providers[chosenProvider];
  const mode = String(taskMode || 'general').toLowerCase() === 'job-apply' ? 'job-apply' : 'general';
  console.log(`[ComputerUseAgent] Using provider: ${chosenProvider} mode=${mode}`);

  const emit = (msg) => { try { if (typeof broadcast === 'function') broadcast(msg); } catch (_) {} };

  emit({ type: 'computer_use_status', status: 'starting', provider: chosenProvider, message: 'Lucy is opening a browser...' });
  console.log('[ComputerUseAgent] Starting task:', String(instruction || '').slice(0, 80));

  let context, contextKey, page, browserEngine, cloudflareChallenge;
  let stopMirror = null;
  let helpers = null;
  try {
    helpers = await _loadBrowserHelpers();
    const { launchJobBrowser, formatBrowserLabel, closeBrowser } = helpers;
    const session = await launchJobBrowser({
      url: url || null,
      headless: false,
      browserMode: browserMode || process.env.LUCY_BROWSER_MODE || 'auto',
    });
    context = session.context;
    contextKey = session.contextKey;
    page = session.page;
    browserEngine = session.browserEngine;
    cloudflareChallenge = session.cloudflareChallenge;

    // Own the CEO browser-mirror slot so the dock panel shows this session live.
    try {
      global._activeBrowserNpc = 'lucy';
      global._lucyBrowserOpen = true;
      global._lucyLastBrowser = {
        label: formatBrowserLabel(browserEngine),
        url: url || null,
        query: String(instruction || '').slice(0, 120),
        engine: browserEngine,
        at: Date.now(),
        kind: 'computer-use',
      };
    } catch (_) {}

    if (mirror !== false && helpers.startMirrorStream) {
      try {
        helpers.writeMirrorState?.({
          status: 'computer-use',
          streaming: true,
          npcKey: 'lucy',
          query: String(instruction || '').slice(0, 160),
          url: url || null,
          browserEngine,
          lastActivity: 'Computer-use starting…',
        });
        helpers.appendMirrorActivity?.(`Computer-use: ${String(instruction || '').slice(0, 120)}`);
        stopMirror = helpers.startMirrorStream(() => page, { intervalMs: 200 });
        emit({ type: 'npc_browser_mirror', npcKey: 'lucy', open: true, streaming: true, status: 'computer-use', ts: Date.now() });
        emit({ type: 'lucy_browser_mirror', npcKey: 'lucy', open: true, streaming: true, status: 'computer-use', ts: Date.now() });
      } catch (mirrorErr) {
        console.warn('[ComputerUseAgent] Mirror stream failed:', mirrorErr?.message || mirrorErr);
      }
    }

    emit({
      type: 'computer_use_status',
      status: 'navigating',
      message: url
        ? `Opening ${url} (${formatBrowserLabel(browserEngine)})`
        : `Browser ready (${formatBrowserLabel(browserEngine)})`,
    });
    if (cloudflareChallenge?.blocked) {
      const ray = cloudflareChallenge.rayId ? ` Ray ID ${cloudflareChallenge.rayId}` : '';
      const msg = `Cloudflare is blocking this application page.${ray} Complete verification in Lucy's browser window, then ask her to retry.`;
      emit({ type: 'computer_use_status', status: 'blocked', message: msg });
      if (typeof stopMirror === 'function') {
        try { stopMirror(); } catch (_) {}
        stopMirror = null;
      }
      setTimeout(async () => {
        try { await closeBrowser(context, { key: contextKey }); } catch (_) {}
        try { global._lucyBrowserOpen = false; } catch (_) {}
      }, APPLY_LINGER_MS);
      return { ok: false, error: msg, browserEngine, cloudflareChallenge };
    }
  } catch (err) {
    return { ok: false, error: 'Browser launch failed: ' + (err?.message || err) };
  }

  const systemPrompt = buildSystemPrompt({ instruction, profile, taskMode: mode });

  // ── conversation loop ─────────────────────────────────────────────────
  const messages = [];
  let lastActions = [];  // track last round's actions for tool_result attachment
  let steps = 0;
  let done = false;
  let result = { ok: true, steps: 0, provider: chosenProvider, browserEngine, taskMode: mode };

  while (steps < MAX_STEPS && !done) {
    steps++;

    // Screenshot
    let screenshotB64;
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      screenshotB64 = buf.toString('base64');
      emit({ type: 'computer_use_screenshot', step: steps, data: screenshotB64 });
    } catch (err) {
      result = { ...result, ok: false, error: 'Screenshot failed: ' + err.message, steps };
      break;
    }

    // Build next message(s) depending on provider format
    if (chosenProvider === 'anthropic') {
      const nextMsg = _anthropicNextMsg(screenshotB64, lastActions.length ? lastActions : null);
      messages.push(nextMsg);
    } else {
      // OpenAI-compatible (Kimi / LM Studio): may return array
      const nextMsgs = _kimiNextMsg(screenshotB64, lastActions.length ? lastActions : null);
      if (Array.isArray(nextMsgs)) messages.push(...nextMsgs);
      else messages.push(nextMsgs);
    }

    // Call the provider
    let parsed;
    try {
      if (chosenProvider === 'anthropic') {
        const raw = await _postAnthropic(providerCfg.apiKey, messages, systemPrompt);
        parsed = _parseAnthropic(raw);
        if (!parsed.error) messages.push({ role: 'assistant', content: parsed.rawContent });
      } else if (chosenProvider === 'lmstudio') {
        const raw = await _postLmStudio(messages, systemPrompt, {
          baseUrl: providerCfg.baseUrl,
          model:   providerCfg.model,
        });
        parsed = _parseKimi(raw); // same OpenAI response shape
        if (!parsed.error && parsed.rawMsg) {
          messages.push({ role: 'assistant', ...parsed.rawMsg,
            content: parsed.rawMsg.content || '',
            tool_calls: parsed.toolCalls?.length ? parsed.toolCalls : undefined,
          });
        }
      } else if (chosenProvider === 'openai') {
        const raw = await _postOpenAICompat(
          providerCfg.apiKey,
          messages,
          systemPrompt,
          {
            baseUrl: providerCfg.baseUrl || 'https://api.openai.com',
            model: providerCfg.model || 'gpt-4o',
          },
        );
        parsed = _parseKimi(raw);
        if (!parsed.error && parsed.rawMsg) {
          messages.push({
            role: 'assistant',
            ...parsed.rawMsg,
            content: parsed.rawMsg.content || '',
            tool_calls: parsed.toolCalls?.length ? parsed.toolCalls : undefined,
          });
        }
      } else {
        // Kimi (and any other OpenAI-compat provider)
        const raw = await _postKimi(providerCfg.apiKey, messages, systemPrompt, providerCfg.baseUrl);
        parsed = _parseKimi(raw);
        if (!parsed.error && parsed.rawMsg) {
          messages.push({ role: 'assistant', ...parsed.rawMsg,
            content: parsed.rawMsg.content || '',
            tool_calls: parsed.toolCalls?.length ? parsed.toolCalls : undefined,
          });
        }
      }
    } catch (err) {
      emit({ type: 'computer_use_status', status: 'error', message: 'API error: ' + err.message });
      result = { ...result, ok: false, error: err.message, steps };
      break;
    }

    if (parsed.error) {
      emit({ type: 'computer_use_status', status: 'error', message: parsed.error });
      result = { ...result, ok: false, error: parsed.error, steps };
      break;
    }

    if (parsed.text) {
      console.log(`[ComputerUseAgent] [${chosenProvider}] step ${steps}: ${parsed.text.slice(0, 120)}`);
      emit({ type: 'computer_use_status', status: 'thinking', step: steps, message: parsed.text.slice(0, 120) });
      if (/TASK_COMPLETE/i.test(parsed.text)) { done = true; }
      if (/TASK_BLOCKED/i.test(parsed.text))  { done = true; result.ok = false; result.error = parsed.text; }
    }

    if (parsed.done) done = true;
    if (!parsed.actions?.length && !parsed.text) done = true;

    // Execute actions and track them for the next tool_result
    lastActions = [];
    for (const inp of (parsed.actions || [])) {
      const actionLabel = inp.action + (inp.text ? ': ' + String(inp.text).slice(0, 40) : '');
      console.log(`[ComputerUseAgent]  → ${actionLabel}`);
      emit({ type: 'computer_use_status', status: 'acting', step: steps, message: actionLabel });
      try {
        helpers?.appendMirrorActivity?.(actionLabel);
      } catch (_) {}
      try { await _execute(page, inp); } catch (err) {
        console.warn('[ComputerUseAgent] Action error:', err.message);
      }
      lastActions.push(inp);
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(STEP_DELAY);
  }

  result.steps = steps;
  emit({ type: 'computer_use_status', status: 'done', message: `Done in ${steps} steps`, steps });
  console.log('[ComputerUseAgent] Task complete:', steps, 'steps');

  // Take a final screenshot for the log
  try {
    const finalBuf = await page.screenshot({ type: 'png' });
    emit({ type: 'computer_use_final_screenshot', data: finalBuf.toString('base64'), steps });
    helpers?.appendMirrorActivity?.(`Computer-use done (${steps} steps)`);
    helpers?.writeMirrorState?.({
      status: result.ok ? 'open' : 'error',
      streaming: true,
      lastActivity: `Computer-use done (${steps} steps)`,
    });
  } catch (_) {}

  // Leave browser open so the CEO can review / complete CF challenges, then close
  setTimeout(async () => {
    if (typeof stopMirror === 'function') {
      try { stopMirror(); } catch (_) {}
    }
    try {
      const { closeBrowser } = helpers || await _loadBrowserHelpers();
      await closeBrowser(context, { key: contextKey });
    } catch (_) {}
    try {
      global._lucyBrowserOpen = false;
      helpers?.clearLiveHeartbeat?.();
    } catch (_) {}
  }, APPLY_LINGER_MS);

  return result;
}

module.exports = { runBrowserTask, buildSystemPrompt };
