'use strict';
/**
 * Computer Use Agent
 *
 * Gives Lucy the ability to control a real browser — take screenshots,
 * click, type, scroll — using Claude's computer-use API, exactly the
 * same way Claude Code works.
 *
 * Flow:
 *   1. Launch a VISIBLE Chromium window (user can watch Lucy work).
 *   2. Loop: screenshot → Claude API (computer_use tool) → execute action.
 *   3. Broadcast progress events back to Denizen WS so Lucy animates.
 *   4. Leave browser open for 30s after finishing so user can review.
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

const VIEWPORT_W  = 1280;
const VIEWPORT_H  = 800;
const MAX_STEPS   = 50;       // safety cap
const STEP_DELAY  = 600;      // ms between action → screenshot cycles

// Default provider preference order — first one with a key/config wins
const PROVIDER_PREFERENCE = ['anthropic', 'kimi', 'lmstudio'];

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
function _postOpenAICompat(apiKey, messages, systemPrompt, { baseUrl, model, http = false } = {}) {
  const url = new URL('/v1/chat/completions', baseUrl);
  const isHttp = http || url.protocol === 'http:';
  const transport = isHttp ? require('http') : https;
  const port = isHttp ? (Number(url.port) || 80) : (Number(url.port) || 443);

  const body = JSON.stringify({
    model,
    max_tokens: 1024,
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

function _postLmStudio(messages, systemPrompt, { baseUrl = 'http://localhost:1234', model } = {}) {
  return _postOpenAICompat(
    process.env.LM_STUDIO_API_KEY || 'lm-studio',
    messages, systemPrompt,
    { baseUrl, model: model || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning', http: true }
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

// ── main entry point ──────────────────────────────────────────────────────

/**
 * Run a browser automation task with full Claude computer-use loop.
 *
 * @param {object} opts
 *   @param {string}   opts.instruction  Natural language task description
 *   @param {string}   [opts.url]        Starting URL to navigate to
 *   @param {object}   [opts.profile]    User profile for form data
 *   @param {function} [opts.broadcast]  fn(wsMsg) to push events to the game
 *   @param {string}   [opts.provider]   'anthropic' | 'kimi' (auto-detects if omitted)
 *   @param {string}   [opts.apiKey]     Override API key
 * @returns {Promise<{ok:boolean, steps:number, provider:string, error?:string}>}
 */

// Read all provider credentials from ~/.openclaw/openclaw.json + env
function _loadProviders() {
  const out = { anthropic: null, kimi: null, lmstudio: null };

  // Env vars
  if (process.env.ANTHROPIC_API_KEY) out.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
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

  // openclaw.json (overrides env if set)
  try {
    const cfgPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', 'openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const p = cfg?.models?.providers || {};
    if (p.anthropic?.apiKey) out.anthropic = { apiKey: p.anthropic.apiKey };
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

async function runBrowserTask({ instruction, url, profile, broadcast, provider, apiKey } = {}) {
  // Pick provider
  const providers = _loadProviders();
  if (apiKey) {
    // Explicit key override — respect explicit provider or guess from preference
    if (provider === 'kimi') providers.kimi = { ...(providers.kimi || {}), apiKey };
    else                     providers.anthropic = { apiKey };
  }

  let chosenProvider = provider;
  if (!chosenProvider) {
    // Auto-select: first in preference list that has a key
    chosenProvider = PROVIDER_PREFERENCE.find(p => providers[p]?.apiKey) || null;
  }

  if (!chosenProvider || !providers[chosenProvider]?.apiKey) {
    return {
      ok: false,
      error: 'No API key found for computer-use. Add anthropic.apiKey or moonshot.apiKey to ~/.openclaw/openclaw.json',
    };
  }

  const providerCfg = providers[chosenProvider];
  console.log(`[ComputerUseAgent] Using provider: ${chosenProvider}`);

  // Playwright check
  let playwright;
  try {
    playwright = require('playwright');
  } catch (_) {
    return { ok: false, error: 'playwright not installed. Run: npm install playwright && npx playwright install chromium' };
  }

  const emit = (msg) => { try { if (typeof broadcast === 'function') broadcast(msg); } catch (_) {} };

  emit({ type: 'computer_use_status', status: 'starting', provider: chosenProvider, message: 'Lucy is opening a browser...' });
  console.log('[ComputerUseAgent] Starting task:', instruction.slice(0, 80));

  let browser, page;
  try {
    browser = await playwright.chromium.launch({
      headless: false,
      args: ['--window-size=1280,900', '--window-position=100,50'],
    });
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
    page = await ctx.newPage();
  } catch (err) {
    return { ok: false, error: 'Browser launch failed: ' + (err?.message || err) };
  }

  if (url) {
    try {
      emit({ type: 'computer_use_status', status: 'navigating', message: `Opening ${url}` });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
    } catch (err) {
      await browser.close();
      return { ok: false, error: 'Navigation failed: ' + (err?.message || err) };
    }
  }

  // ── system prompt (same for both providers) ───────────────────────────
  const profileLines = profile ? [
    'Fill every form field using this profile:',
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

  const systemPrompt = [
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
    '- If you hit a captcha or login wall, call task_blocked with the reason.',
  ].filter(Boolean).join('\n');

  // ── conversation loop ─────────────────────────────────────────────────
  const messages = [];
  let lastActions = [];  // track last round's actions for tool_result attachment
  let steps = 0;
  let done = false;
  let result = { ok: true, steps: 0, provider: chosenProvider };

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
  } catch (_) {}

  // Leave browser open for 60 seconds so the user can review, then close
  setTimeout(async () => {
    try { await browser.close(); } catch (_) {}
  }, 60000);

  return result;
}

module.exports = { runBrowserTask };
