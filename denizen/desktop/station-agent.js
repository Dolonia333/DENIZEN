'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const RUN_TIMEOUT_MS = 60_000;
const ALLOWED_COMMANDS = new Set(['node', 'python', 'python3', 'bash', 'sh']);

let captureScreenFn = null;
let nutModule = null;

function setCaptureScreen(fn) {
  captureScreenFn = typeof fn === 'function' ? fn : null;
}

function getNut() {
  if (nutModule === false) return null;
  if (nutModule) return nutModule;
  try {
    nutModule = require('@nut-tree-fork/nut-js');
    return nutModule;
  } catch (_) {
    nutModule = false;
    return null;
  }
}

function allowedRoots() {
  const home = os.homedir();
  return [
    home,
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
  ].map((p) => path.resolve(p));
}

function resolveAllowedPath(rawPath) {
  const target = path.resolve(String(rawPath || '').trim());
  if (!target) throw new Error('path required');
  const roots = allowedRoots();
  const ok = roots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
  if (!ok) {
    throw new Error('Path is outside allowed folders (home, Documents, Desktop, Downloads)');
  }
  return target;
}

async function captureScreenPng() {
  if (!captureScreenFn) {
    throw new Error('Screen capture is not available on this station');
  }
  const buf = await captureScreenFn();
  if (!Buffer.isBuffer(buf) || !buf.length) {
    throw new Error('Screen capture returned empty image');
  }
  return buf;
}

async function executeLocalAction(action = {}) {
  const nut = getNut();
  if (!nut) {
    if (action.action === 'open_app') {
      const { shell } = require('electron');
      await shell.openPath(String(action.app || ''));
      return { ok: true };
    }
    throw new Error('Mouse/keyboard control requires nut-js on this station');
  }

  const { mouse, keyboard, clipboard, Key, Button } = nut;
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
      if (combo.includes('+')) {
        const parts = combo.split('+').map((p) => p.trim());
        const keys = parts.map((p) => Key[p.toUpperCase()] || Key[p] || p);
        await keyboard.pressKey(...keys);
        await keyboard.releaseKey(...keys);
      } else {
        const key = Key[combo.toUpperCase()] || Key[combo] || combo;
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
      }
      break;
    }
    case 'scroll':
      await mouse.move([{ x: action.x || 0, y: action.y || 0 }]);
      await mouse.scrollDown(action.amount || 3);
      break;
    case 'open_app': {
      const { shell } = require('electron');
      await shell.openPath(String(action.app || ''));
      break;
    }
    case 'read_clipboard':
      return { clipboardText: await clipboard.getContent() };
    case 'write_clipboard':
      await clipboard.setContent(action.text || '');
      break;
    default:
      break;
  }
  return { ok: true };
}

async function callVision(desktopApi, setup, body) {
  const data = await desktopApi(
    setup.serverUrl,
    '/api/desktop/station/vision',
    {
      session_id: setup.sessionId,
      install_id: setup.desktopInstallId,
      ...body,
    },
    setup,
  );
  return data;
}

async function runScreenObserve(task, { desktopApi, setup, onProgress }) {
  const screenshotBuf = await captureScreenPng();
  const screenshotB64 = screenshotBuf.toString('base64');
  if (typeof onProgress === 'function') {
    onProgress({ type: 'screenshot', screenshot: screenshotB64 });
  }

  const data = await callVision(desktopApi, setup, {
    mode: 'observe',
    instruction: task.instruction,
    screenshot: screenshotB64,
    npcName: task.npc_name,
  });

  if (!data?.ok) {
    return {
      ok: false,
      error: data?.error || 'Vision failed',
      screenshot: screenshotB64,
    };
  }

  return {
    ok: true,
    summary: data.summary,
    topics: data.topics || [],
    searchQuery: data.searchQuery || '',
    screenshot: screenshotB64,
    screenshotB64,
  };
}

async function runDesktopAgent(task, { desktopApi, setup, onProgress }) {
  const messages = [];
  const MAX_STEPS = 40;
  let steps = 0;

  let screenshotBuf = await captureScreenPng();
  let screenshotB64 = screenshotBuf.toString('base64');
  if (typeof onProgress === 'function') {
    onProgress({ type: 'screenshot', screenshot: screenshotB64 });
  }

  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Task: ${task.instruction}\n\nHere is the current state of the screen. What do you do first?`,
      },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
    ],
  });

  while (steps < MAX_STEPS) {
    steps += 1;
    const data = await callVision(desktopApi, setup, {
      mode: 'desktop',
      instruction: task.instruction,
      messages,
      npcName: task.npc_name,
    });

    const parsed = data?.parsed || {};
    if (parsed.error) {
      return { ok: false, error: parsed.error, steps };
    }

    messages.push({ role: 'assistant', content: parsed.text || '' });

    if (parsed.done) {
      return {
        ok: true,
        summary: parsed.text || 'Task complete.',
        steps,
      };
    }

    for (const action of parsed.actions || []) {
      if (typeof onProgress === 'function') {
        onProgress({ type: 'action', action });
      }
      if (action.action === 'done') {
        return { ok: true, summary: action.summary || parsed.text || 'Done.', steps };
      }
      if (action.action === 'blocked') {
        return { ok: false, error: action.reason || 'blocked', steps };
      }
      try {
        await executeLocalAction(action);
      } catch (err) {
        console.warn('[station-agent] action failed:', err?.message || err);
      }
    }

    await new Promise((r) => setTimeout(r, 600));
    screenshotBuf = await captureScreenPng();
    screenshotB64 = screenshotBuf.toString('base64');
    if (typeof onProgress === 'function') {
      onProgress({ type: 'screenshot', screenshot: screenshotB64 });
    }

    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Screen updated. What is your next action? Output only JSON.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotB64}` } },
      ],
    });

    if (messages.length > 12) messages.splice(0, messages.length - 12);
  }

  return { ok: false, error: 'Max steps reached', steps };
}

async function runFileRead(task) {
  const filePath = resolveAllowedPath(task.payload?.path || task.instruction);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > MAX_READ_BYTES) throw new Error(`File too large (max ${MAX_READ_BYTES} bytes)`);
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    ok: true,
    summary: `Read ${filePath} (${content.length} chars)`,
    output: content,
    path: filePath,
  };
}

async function runFileWrite(task) {
  const filePath = resolveAllowedPath(task.payload?.path || task.instruction);
  const content = String(task.payload?.content ?? '');
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error(`Content too large (max ${MAX_WRITE_BYTES} bytes)`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return {
    ok: true,
    summary: `Wrote ${content.length} chars to ${filePath}`,
    path: filePath,
  };
}

async function runCode(task) {
  const command = String(task.payload?.command || task.instruction || '').trim();
  const base = path.basename(command).toLowerCase();
  if (!ALLOWED_COMMANDS.has(base) && !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }
  const args = Array.isArray(task.payload?.args) ? task.payload.args.map(String) : [];
  const cwd = task.payload?.cwd ? resolveAllowedPath(task.payload.cwd) : os.homedir();
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return {
    ok: true,
    summary: output.slice(0, 500) || 'Command finished with no output',
    output,
  };
}

async function runLocalWebSearch(task) {
  const query = String(task.payload?.query || task.instruction || '').trim();
  if (!query) return { ok: false, error: 'query required', summary: 'No search query.' };

  const denizenRoot = path.resolve(__dirname, '..');
  const script = path.join(denizenRoot, 'jelly', 'vendor', 'skills', 'web-search', 'web-search.mjs');
  if (!fs.existsSync(script)) {
    return { ok: false, error: 'web-search.mjs missing', summary: 'Browser search script not installed on this station.' };
  }

  const lingerMs = Number(process.env.LUCY_SEARCH_LINGER_MS || 120_000);
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    script,
    '--query', query,
    '--headless', 'false',
    '--linger-ms', String(lingerMs),
  ], {
    cwd: path.dirname(script),
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: false,
  });

  let parsed = null;
  try {
    const line = stdout.trim().split('\n').filter(Boolean).pop();
    parsed = line ? JSON.parse(line) : null;
  } catch (_) {}

  const summary = parsed?.summary || parsed?.error || stderr.slice(0, 300) || stdout.slice(0, 300) || 'Browser search finished.';
  return {
    ok: parsed?.success !== false,
    summary,
    output: summary,
    query,
    parsed,
  };
}

async function executeTask(task, ctx) {
  const caps = ctx?.setup?.capabilities || {};
  const kindCap = {
    screen_observe: 'screen_access',
    desktop_agent: 'screen_access',
    web_search: 'screen_access',
    file_read: 'read_files',
    file_write: 'write_files',
    run_code: 'run_code',
  };
  const required = kindCap[task.kind];
  if (required && !caps[required]) {
    return {
      ok: false,
      error: 'capability_off',
      summary: `${required.replace(/_/g, ' ')} is disabled in station settings.`,
    };
  }
  switch (task.kind) {
    case 'screen_observe':
      return runScreenObserve(task, ctx);
    case 'desktop_agent':
      return runDesktopAgent(task, ctx);
    case 'web_search':
      return runLocalWebSearch(task);
    case 'file_read':
      return runFileRead(task);
    case 'file_write':
      return runFileWrite(task);
    case 'run_code':
      return runCode(task);
    default:
      return { ok: false, error: `Unknown task kind: ${task.kind}` };
  }
}

module.exports = {
  setCaptureScreen,
  executeTask,
  captureScreenPng,
  resolveAllowedPath,
  allowedRoots,
  runLocalWebSearch,
};
