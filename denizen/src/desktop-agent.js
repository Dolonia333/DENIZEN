'use strict';
/**
 * Desktop Agent — gives Lucy (or any NPC) full PC control.
 *
 * Same loop as computer-use-agent but targets the whole desktop instead of
 * a browser window:
 *   1. Take a screenshot of the full screen
 *   2. Send it to the vision model (Ministral 14B by default) with the task
 *   3. Model decides: click, type, scroll, open app, read clipboard, or done
 *   4. Execute the action via nut-js (native mouse/keyboard/screen)
 *   5. Repeat until task_done or max steps
 *
 * Trigger via POST /api/desktop-task:
 *   { instruction, provider? }
 *
 * Or tell Lucy: "Open Spotify and play something chill"
 */

const fs   = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const DESKTOP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'desktop_action',
      description: 'Perform an action on the desktop',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['click', 'right_click', 'double_click', 'type', 'key', 'scroll', 'move', 'screenshot', 'open_app', 'read_clipboard', 'write_clipboard'],
            description: 'The action to perform',
          },
          x: { type: 'number', description: 'X coordinate for mouse actions' },
          y: { type: 'number', description: 'Y coordinate for mouse actions' },
          text: { type: 'string', description: 'Text to type or clipboard content' },
          key: { type: 'string', description: 'Key or key combo to press (e.g. "ctrl+c", "enter", "escape")' },
          app: { type: 'string', description: 'App name or exe path to open' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
          amount: { type: 'number', description: 'Scroll amount in lines' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description: 'Call when the task is fully complete',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_blocked',
      description: 'Call if the task cannot be completed',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
];

// ---------------------------------------------------------------------------
// nut-js wrapper (lazy-loaded so server starts even if nut-js has issues)
// ---------------------------------------------------------------------------

let _nut = null;
function _getNut() {
  if (!_nut) _nut = require('@nut-tree-fork/nut-js');
  return _nut;
}

async function takeScreenshot() {
  const { screen, FileType } = _getNut();
  const os = require('node:os');
  const tmpDir = os.tmpdir();
  const name = `denizen-screenshot-${Date.now()}`;
  // capture(name, fileType, directory) — saves PNG, returns file path
  await screen.capture(name, FileType.PNG, tmpDir);
  const filePath = path.join(tmpDir, `${name}.png`);
  const buf = fs.readFileSync(filePath);
  try { fs.unlinkSync(filePath); } catch (_) {}
  return buf;
}

async function executeAction(action) {
  const { mouse, keyboard, screen, clipboard, Key, Button } = _getNut();

  switch (action.action) {
    case 'click':
      await mouse.move([{ x: action.x, y: action.y }]);
      await mouse.click(Button.LEFT);
      break;

    case 'right_click':
      await mouse.move([{ x: action.x, y: action.y }]);
      await mouse.click(Button.RIGHT);
      break;

    case 'double_click':
      await mouse.move([{ x: action.x, y: action.y }]);
      await mouse.doubleClick(Button.LEFT);
      break;

    case 'move':
      await mouse.move([{ x: action.x, y: action.y }]);
      break;

    case 'type':
      await keyboard.type(action.text || '');
      break;

    case 'key': {
      const combo = String(action.key || '').toLowerCase();
      // Map common combos to nut-js Key constants
      const keyMap = {
        'enter': Key.Return, 'return': Key.Return,
        'escape': Key.Escape, 'esc': Key.Escape,
        'tab': Key.Tab,
        'space': Key.Space,
        'backspace': Key.Backspace,
        'delete': Key.Delete,
        'up': Key.Up, 'down': Key.Down, 'left': Key.Left, 'right': Key.Right,
        'home': Key.Home, 'end': Key.End,
        'pageup': Key.PageUp, 'pagedown': Key.PageDown,
        'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4,
        'f5': Key.F5, 'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8,
      };
      if (combo.includes('+')) {
        // Combo like ctrl+c, win+d, alt+tab
        const parts = combo.split('+');
        const modKeys = [];
        let mainKey = null;
        for (const p of parts) {
          if (p === 'ctrl' || p === 'control') modKeys.push(Key.LeftControl);
          else if (p === 'alt') modKeys.push(Key.LeftAlt);
          else if (p === 'shift') modKeys.push(Key.LeftShift);
          else if (p === 'win' || p === 'super' || p === 'meta') modKeys.push(Key.LeftSuper);
          else mainKey = keyMap[p] || Key[p.charAt(0).toUpperCase() + p.slice(1)];
        }
        if (mainKey) await keyboard.pressKey(...modKeys, mainKey);
        else await keyboard.pressKey(...modKeys);
      } else {
        const k = keyMap[combo] || Key[combo.charAt(0).toUpperCase() + combo.slice(1)];
        if (k) await keyboard.pressKey(k);
      }
      break;
    }

    case 'scroll': {
      if (action.x !== undefined && action.y !== undefined) {
        await mouse.move([{ x: action.x, y: action.y }]);
      }
      const amount = action.amount || 3;
      const dir = action.direction || 'down';
      if (dir === 'down') await mouse.scroll(0, -amount);
      else if (dir === 'up') await mouse.scroll(0, amount);
      else if (dir === 'right') await mouse.scroll(amount, 0);
      else if (dir === 'left') await mouse.scroll(-amount, 0);
      break;
    }

    case 'open_app': {
      // Use Windows start command to open apps by name or path
      const { exec } = require('node:child_process');
      let app = action.app || '';
      if (/^brave$/i.test(app.trim())) {
        const bravePath = resolveBravePath();
        if (!bravePath) return { error: 'Brave not installed' };
        app = bravePath;
      }
      await new Promise((res) => exec(`start "" "${app}"`, res));
      await new Promise(r => setTimeout(r, 1500)); // wait for app to open
      break;
    }

    case 'read_clipboard': {
      const text = await clipboard.getContent();
      return { clipboardText: text };
    }

    case 'write_clipboard':
      await clipboard.setContent(action.text || '');
      break;

    case 'screenshot':
      // Just take a new screenshot — handled in the loop
      break;
  }
  // Small delay after each action so the screen updates
  await new Promise(r => setTimeout(r, 300));
  return {};
}

// ---------------------------------------------------------------------------
// LM Studio vision API call (same as computer-use-agent)
// ---------------------------------------------------------------------------

async function _callVisionModel(messages, systemPrompt, { baseUrl, model, apiKey }) {
  // Harness parity (A+ plan P0.1): resolve host + model + sampling through
  // the harness so desktop-agent shares tier truth with everything else.
  // The local POST stays only for vision-message payloads (image parts).
  let sampling = { temperature: 0.2 };
  try {
    const { getActiveHarness } = require('./denizen-harness');
    const h = getActiveHarness?.();
    if (h) {
      const runtime = await h.probeInference({ timeoutMs: 2500 }).catch(() => null);
      if (runtime?.url) baseUrl = baseUrl || runtime.url;
      const m = h.resolveTier('heavy', runtime);
      if (m && !model) model = m;
      sampling = h.modules?.inference?.samplingFor?.({ kind: 'code', temperature: 0.2 }) || sampling;
    }
  } catch (_) { /* pre-harness boot — keep caller-provided config */ }
  return new Promise((resolve, reject) => {
    const oaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    // No tool_calls — Ministral's chat template can't handle alternating
    // tool results + user messages. Use plain text JSON output instead.
    const body = JSON.stringify({
      model,
      messages: oaiMessages,
      max_tokens: 300,
      ...sampling,
    });

    const url = new URL('/v1/chat/completions', baseUrl);
    const isHttp = url.protocol === 'http:';
    const lib = isHttp ? http : https;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttp ? 80 : 443),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${apiKey || 'lm-studio'}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Bad JSON from vision model: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('Vision model timeout')); });
    req.write(body);
    req.end();
  });
}

function _parseResponse(raw) {
  if (raw.error) return { error: raw.error?.message || JSON.stringify(raw.error) };
  const choice = raw.choices?.[0];
  if (!choice) return { error: 'No choices in response' };
  const msg = choice.message || {};
  // Reasoning models put output in reasoning_content — fall back
  const text = (msg.content || msg.reasoning_content || '').trim();

  // Extract JSON action from text output
  let action = null;
  const jsonMatch = text.match(/\{[^{}]*\}/);
  if (jsonMatch) {
    try { action = JSON.parse(jsonMatch[0]); } catch (_) {}
  }

  if (!action) {
    // No JSON found — model is confused, mark done to avoid infinite loop
    console.warn('[DesktopAgent] No JSON action found in response:', text.slice(0, 120));
    return { text, actions: [], done: true };
  }

  if (action.action === 'done') return { text: action.summary || 'Done', actions: [], done: true };
  if (action.action === 'blocked') return { text: 'BLOCKED: ' + (action.reason || 'unknown'), actions: [], done: true };

  return { text, actions: [action], done: false, rawMsg: msg };
}

// ---------------------------------------------------------------------------
// Main desktop task runner
// ---------------------------------------------------------------------------

async function runDesktopTask({ instruction, broadcast, provider, apiKey, npcName } = {}) {
  const agentName = String(npcName || 'Lucy');
  const formTask = /\b(?:fill|form|application|apply|type for me|enter for me)\b/i.test(String(instruction || ''));
  let cfg = {};
  try { cfg = require('../jelly/config-provider').getConfig(); } catch (_) {}

  const lmCfg = {
    baseUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
    model: process.env.LM_STUDIO_VISION_MODEL || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
    apiKey: process.env.LM_STUDIO_API_KEY || cfg?.models?.providers?.lmstudio?.apiKey || 'lm-studio',
  };

  const systemPrompt = [
    'You are a desktop automation agent with full control of this Windows PC.',
    'You can see the screen via screenshots and control the mouse, keyboard, and apps.',
    'Each turn you must output EXACTLY ONE JSON action on a single line, like:',
    '{"action":"click","x":100,"y":200}',
    '{"action":"type","text":"hello"}',
    '{"action":"key","key":"ctrl+c"}',
    '{"action":"scroll","x":500,"y":400,"direction":"down","amount":3}',
    '{"action":"open_app","app":"Wireshark"}',
    '{"action":"open_app","app":"Zenmap"}',
    '{"action":"read_clipboard"}',
    '{"action":"done","summary":"what you accomplished including key findings"}',
    '{"action":"blocked","reason":"why you cannot proceed"}',
    'Valid actions: click, right_click, double_click, type, key, scroll, move, open_app, read_clipboard, write_clipboard, done, blocked',
    'Be precise with pixel coordinates from the screenshot. Output ONLY the JSON, nothing else.',
    '',
    'WIRESHARK tips:',
    '- After opening, double-click the active interface (Ethernet or Wi-Fi — the one with activity bars)',
    '- To stop capture: click the red square stop button in the toolbar',
    '- To apply a display filter: click the filter bar at the top, type the filter, press Enter',
    '- To read packet summary: look at the Packet List pane (top section) for IPs, protocols, info',
    '- After reading, call done with a summary of suspicious IPs, ports, protocols you saw',
    '',
    'ZENMAP tips:',
    '- Target field is the text box next to "Target:" label at the top',
    '- Profile dropdown is next to "Profile:" label — select "Quick scan"',
    '- Scan button is the large button to the right of the profile dropdown',
    '- Results appear in the "Nmap Output" tab at the bottom — look for open ports and host status',
    '- After reading results, call done with a summary of hosts found and open ports',
    '',
    'Do NOT open banking, private files, or sensitive apps unless explicitly asked.',
    'If an app is not installed, call blocked immediately rather than searching for it.',
    '',
    'BROWSER / FORM FILL (Brave, Chrome, job sites, gov forms):',
    '- Click into each visible field, type the value, Tab to next field.',
    '- Scroll down if fields are below the fold.',
    '- NEVER click final Submit / Send / Pay / Place order unless the CEO explicitly said "submit" or "send it".',
    '- When all fields are filled, call done with a summary of what you entered and what still needs CEO review.',
  ].join('\n');

  const MAX_STEPS = 50; // bumped for Wireshark/Zenmap which need more steps than simple tasks
  let steps = 0;

  // Check global abort flag — set require('./desktop-agent')._abortAll = true to kill tasks
  if (_abortFlag) {
    console.log('[DesktopAgent] Aborted before start (abort flag set)');
    return { ok: false, steps: 0, error: 'aborted' };
  }
  const messages = [];

  const _broadcast = (type, data) => {
    if (!broadcast) return;
    try { broadcast({ type, ...data }); } catch (_) {}
  };

  _broadcast('desktop_task_status', { status: 'starting', message: `${agentName} is starting: ${instruction}`, npcName: agentName });

  try {
    // Initial screenshot
    let screenshotBuf = await takeScreenshot();
    let screenshotB64 = screenshotBuf.toString('base64');

    _broadcast('desktop_task_screenshot', { screenshot: screenshotB64 });

    // First message — task + screenshot
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Task: ${instruction}\n\nHere is the current state of the screen. What do you do first?` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
      ],
    });

    while (steps < MAX_STEPS && !_abortFlag) {
      steps++;
      console.log(`[DesktopAgent] Step ${steps}/${MAX_STEPS}`);

      const raw = await _callVisionModel(messages, systemPrompt, lmCfg);
      const parsed = _parseResponse(raw);

      if (parsed.error) {
        console.error('[DesktopAgent] Model error:', parsed.error);
        _broadcast('desktop_task_status', { status: 'error', message: parsed.error });
        return { ok: false, steps, error: parsed.error };
      }

      // Add assistant response to history
      messages.push({ role: 'assistant', content: parsed.text || '' });

      if (parsed.done) {
        const summary = parsed.text || 'Task complete.';
        console.log('[DesktopAgent] Task complete:', summary);
        _broadcast('desktop_task_status', { status: 'done', message: `${agentName} finished: ${summary}`, steps, npcName: agentName });
        return { ok: true, steps, summary };
      }

      // Execute the action
      for (const action of parsed.actions) {
        console.log(`[DesktopAgent] Action: ${action.action}`, action.x !== undefined ? `(${action.x}, ${action.y})` : action.text ? `"${String(action.text).slice(0,30)}"` : '');
        _broadcast('desktop_task_action', { action: action.action, x: action.x, y: action.y, text: action.text });
        try {
          const result = await executeAction(action);
          if (result?.clipboardText) {
            _broadcast('desktop_task_action', { action: 'clipboard_read', text: result.clipboardText });
          }
        } catch (err) {
          console.error('[DesktopAgent] Action error:', err?.message);
        }
      }

      // Take new screenshot and send as next user message
      await new Promise(r => setTimeout(r, 600));
      screenshotBuf = await takeScreenshot();
      screenshotB64 = screenshotBuf.toString('base64');
      _broadcast('desktop_task_screenshot', { screenshot: screenshotB64 });

      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Screen updated. What is your next action? Output only JSON.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
        ],
      });

      // Keep context lean — only last 6 messages + system
      if (messages.length > 12) messages.splice(0, messages.length - 12);
    }

    _broadcast('desktop_task_status', { status: 'error', message: 'Max steps reached' });
    return { ok: false, steps, error: 'Max steps reached' };

  } catch (err) {
    console.error('[DesktopAgent] Fatal error:', err?.message || err);
    _broadcast('desktop_task_status', { status: 'error', message: err?.message || String(err) });
    return { ok: false, steps, error: err?.message || String(err) };
  }
}

// Set module.exports._abortAll = true to stop any in-flight task immediately.
let _abortFlag = false;

/** Resolve Brave Browser executable on Windows. */
function resolveBravePath() {
  if (process.env.BRAVE_BROWSER_PATH && fs.existsSync(process.env.BRAVE_BROWSER_PATH)) {
    return process.env.BRAVE_BROWSER_PATH;
  }
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    local ? path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : null,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Open the CEO's real Brave browser (their profile, cookies, logins).
 * @param {string} [url]
 */
async function openBraveBrowser(url) {
  const brave = resolveBravePath();
  if (!brave) {
    return { ok: false, error: 'Brave not found. Set BRAVE_BROWSER_PATH in denizen/.env' };
  }
  const { exec } = require('node:child_process');
  const target = url ? `"${brave}" "${url}"` : `"${brave}"`;
  await new Promise((res, rej) => {
    exec(`start "" ${target}`, { windowsHide: true }, (err) => (err ? rej(err) : res()));
  });
  await new Promise((r) => setTimeout(r, 1500));
  return { ok: true, path: brave, url: url || null };
}

/**
 * Read-only: one screenshot + vision describe (no mouse/keyboard).
 */
async function runObserveOnly({ instruction, broadcast, npcName } = {}) {
  let cfg = {};
  try { cfg = require('../jelly/config-provider').getConfig(); } catch (_) {}

  const lmCfg = {
    baseUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
    model: process.env.LM_STUDIO_VISION_MODEL || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
    apiKey: process.env.LM_STUDIO_API_KEY || cfg?.models?.providers?.lmstudio?.apiKey || 'lm-studio',
  };

  const systemPrompt = [
    'You are a read-only screen observer for an AI assistant.',
    'Describe what is on the CEO\'s screen: active app, browser (Brave/Chrome/etc), URL bar, page title,',
    'visible text they typed, forms, buttons, errors, and anything they asked about.',
    'Do NOT suggest clicks or typing unless the CEO explicitly asked you to act.',
    'Output EXACTLY ONE JSON object:',
    '{"action":"done","summary":"2-4 sentences describing the screen","topics":["up to 3 nouns worth researching"],"searchQuery":"one web search phrase to learn more about something unclear on screen"}',
    'If nothing useful is visible, still describe what you can see.',
  ].join('\n');

  const _broadcast = (type, data) => {
    if (!broadcast) return;
    try { broadcast({ type, ...data, npcName: npcName || 'Lucy' }); } catch (_) {}
  };

  try {
    const screenshotBuf = await takeScreenshot();
    const screenshotB64 = screenshotBuf.toString('base64');
    _broadcast('desktop_task_screenshot', { screenshot: screenshotB64 });

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: `CEO request: ${instruction}\n\nDescribe this screen read-only.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
      ],
    }];

    const raw = await _callVisionModel(messages, systemPrompt, lmCfg);
    const parsed = _parseResponse(raw);
    if (parsed.error) {
      return { ok: false, error: parsed.error, screenshotB64 };
    }

    let summary = parsed.text || '';
    let topics = [];
    let searchQuery = '';
    try {
      const jsonMatch = (parsed.text || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const obj = JSON.parse(jsonMatch[0]);
        summary = obj.summary || summary;
        topics = Array.isArray(obj.topics) ? obj.topics : [];
        searchQuery = obj.searchQuery || '';
      }
    } catch (_) {}

    if (!summary && parsed.done) summary = 'Screen captured — vision model returned no summary.';

    return { ok: true, summary, topics, searchQuery, screenshotB64 };
  } catch (err) {
    return { ok: false, error: err.message || String(err), screenshotB64: null };
  }
}

function getLmVisionConfig() {
  let cfg = {};
  try { cfg = require('../jelly/config-provider').getConfig(); } catch (_) {}
  return {
    baseUrl: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
    model: process.env.LM_STUDIO_VISION_MODEL || process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
    apiKey: process.env.LM_STUDIO_API_KEY || cfg?.models?.providers?.lmstudio?.apiKey || 'lm-studio',
  };
}

function getDesktopSystemPrompt() {
  return [
    'You are a desktop automation agent with full control of this PC.',
    'You can see the screen via screenshots and control the mouse, keyboard, and apps.',
    'Each turn you must output EXACTLY ONE JSON action on a single line, like:',
    '{"action":"click","x":100,"y":200}',
    '{"action":"type","text":"hello"}',
    '{"action":"key","key":"ctrl+c"}',
    '{"action":"scroll","x":500,"y":400,"direction":"down","amount":3}',
    '{"action":"open_app","app":"Wireshark"}',
    '{"action":"read_clipboard"}',
    '{"action":"done","summary":"what you accomplished including key findings"}',
    '{"action":"blocked","reason":"why you cannot proceed"}',
    'Valid actions: click, right_click, double_click, type, key, scroll, move, open_app, read_clipboard, write_clipboard, done, blocked',
    'Be precise with pixel coordinates from the screenshot. Output ONLY the JSON, nothing else.',
    'Do NOT open banking, private files, or sensitive apps unless explicitly asked.',
    'If an app is not installed, call blocked immediately rather than searching for it.',
    'NEVER click final Submit / Send / Pay unless the CEO explicitly said "submit" or "send it".',
  ].join('\n');
}

function getObserveSystemPrompt() {
  return [
    'You are a read-only screen observer for an AI assistant.',
    'Describe what is on the CEO\'s screen: active app, browser, URL bar, page title,',
    'visible text they typed, forms, buttons, errors, and anything they asked about.',
    'Do NOT suggest clicks or typing unless the CEO explicitly asked you to act.',
    'Output EXACTLY ONE JSON object:',
    '{"action":"done","summary":"2-4 sentences describing the screen","topics":["up to 3 nouns worth researching"],"searchQuery":"one web search phrase to learn more about something unclear on screen"}',
    'If nothing useful is visible, still describe what you can see.',
  ].join('\n');
}

async function describeScreenshotBuffer({ instruction, screenshotBuf, broadcast, npcName } = {}) {
  const lmCfg = getLmVisionConfig();
  const systemPrompt = getObserveSystemPrompt();
  const screenshotB64 = Buffer.isBuffer(screenshotBuf)
    ? screenshotBuf.toString('base64')
    : String(screenshotBuf || '');

  const _broadcast = (type, data) => {
    if (!broadcast) return;
    try { broadcast({ type, ...data, npcName: npcName || 'Lucy' }); } catch (_) {}
  };

  _broadcast('desktop_task_screenshot', { screenshot: screenshotB64 });

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: `CEO request: ${instruction}\n\nDescribe this screen read-only.` },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
    ],
  }];

  const raw = await _callVisionModel(messages, systemPrompt, lmCfg);
  const parsed = _parseResponse(raw);
  if (parsed.error) {
    return { ok: false, error: parsed.error, screenshotB64 };
  }

  let summary = parsed.text || '';
  let topics = [];
  let searchQuery = '';
  try {
    const jsonMatch = summary.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      summary = obj.summary || summary;
      topics = Array.isArray(obj.topics) ? obj.topics : [];
      searchQuery = obj.searchQuery || '';
    }
  } catch (_) {}

  if (!summary && parsed.done) summary = 'Screen captured — vision model returned no summary.';

  return { ok: true, summary, topics, searchQuery, screenshotB64 };
}

async function visionStep({ messages, systemPrompt, mode = 'desktop' } = {}) {
  const lmCfg = getLmVisionConfig();
  const prompt = systemPrompt || (mode === 'observe' ? getObserveSystemPrompt() : getDesktopSystemPrompt());
  const raw = await _callVisionModel(messages, prompt, lmCfg);
  return _parseResponse(raw);
}

module.exports = {
  runDesktopTask,
  runObserveOnly,
  describeScreenshotBuffer,
  visionStep,
  openBraveBrowser,
  resolveBravePath,
  takeScreenshot,
  executeAction,
  getLmVisionConfig,
  getDesktopSystemPrompt,
  getObserveSystemPrompt,
  callVisionModel: _callVisionModel,
  parseVisionResponse: _parseResponse,
  get _abortAll() { return _abortFlag; },
  set _abortAll(v) { _abortFlag = !!v; },
};
