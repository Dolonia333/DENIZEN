#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DENIZEN_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(DENIZEN_ROOT, 'scripts');

const PHONE_APPS = [
  'home', 'profile', 'chat', 'settings', 'compute', 'mesh',
  'health', 'lm', 'approvals', 'browser', 'security',
  'voice', 'presence', 'listen',
];

const CRM_TABS = [
  'dashboard', 'contacts', 'sales', 'schedule', 'notes', 'packages', 'intake',
  'email-templates', 'automations', 'analytics', 'ai', 'portal', 'data-tools',
  'onboarding', 'settings',
];

function runScript(scriptRel, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS, scriptRel);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: DENIZEN_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${scriptRel} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (err) {
        reject(new Error(`Invalid JSON from ${scriptRel}: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

function imageContentFromFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(DENIZEN_ROOT, filePath);
  if (!fs.existsSync(abs)) return null;
  const data = fs.readFileSync(abs).toString('base64');
  return { type: 'image', data, mimeType: 'image/png' };
}

function resultWithScreenshot(json) {
  const content = [{ type: 'text', text: JSON.stringify(json, null, 2) }];
  const img = json.screenshot ? imageContentFromFile(json.screenshot) : null;
  if (img) content.push(img);
  return { content };
}

const server = new McpServer({
  name: 'denizen-ui-inspect',
  version: '1.1.0',
});

server.tool(
  'capture_denizen_phone_app',
  'Log in to Denizen, open the phone shell, capture a phone app screenshot and layout metrics.',
  {
    baseUrl: { type: 'string', description: 'Denizen server URL (defaults to DENIZEN_URL env)' },
    appId: {
      type: 'string',
      description: 'Phone app id',
      enum: PHONE_APPS,
    },
    viewport: {
      type: 'string',
      description: 'desktop, laptop (1366x768), or iphone',
      enum: ['desktop', 'laptop', 'iphone'],
    },
  },
  async ({ baseUrl, appId, viewport }) => {
    const url = String(baseUrl || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').trim();
    const app = String(appId || 'profile').trim();
    const vp = String(viewport || 'desktop').trim();
    const result = await runScript('denizen-ui-inspect.mjs', [url, app, vp]);
    return resultWithScreenshot(result);
  },
);

server.tool(
  'capture_crm_tab',
  'Log in to Denizen, open CRM, navigate to a sidebar tab, capture screenshot and blank-check metrics.',
  {
    baseUrl: { type: 'string', description: 'Denizen server URL (defaults to DENIZEN_URL env)' },
    tabId: {
      type: 'string',
      description: 'CRM sidebar tab id',
      enum: CRM_TABS,
    },
  },
  async ({ baseUrl, tabId }) => {
    const url = String(baseUrl || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').trim();
    const tab = String(tabId || 'dashboard').trim();
    const result = await runScript('capture-crm-tab.mjs', [url, tab]);
    return resultWithScreenshot(result);
  },
);

server.tool(
  'click_denizen_ui',
  'Log in to Denizen, optionally open a phone app, click a CSS selector, capture screenshot after click.',
  {
    baseUrl: { type: 'string', description: 'Denizen server URL' },
    selector: { type: 'string', description: 'CSS selector to click (required)' },
    appId: {
      type: 'string',
      description: 'Optional phone app to open first (home, profile, chat, …)',
    },
  },
  async ({ baseUrl, selector, appId }) => {
    const url = String(baseUrl || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').trim();
    const sel = String(selector || '').trim();
    if (!sel) throw new Error('selector is required');
    const args = [url, sel];
    if (appId) args.push(String(appId).trim());
    const result = await runScript('denizen-ui-click.mjs', args);
    return resultWithScreenshot(result);
  },
);

server.tool(
  'capture_desktop_screen',
  'Capture a PNG of the real laptop/desktop screen (nut-js). Read-only — no click.',
  {},
  async () => {
    const result = await runScript('capture-desktop-screen.cjs', []);
    return resultWithScreenshot(result);
  },
);

server.tool(
  'desktop_click',
  'Click, double-click, type, or press a key on the real desktop, then capture a follow-up screenshot.',
  {
    action: {
      type: 'string',
      description: 'click | double_click | type | key',
      enum: ['click', 'double_click', 'type', 'key'],
    },
    x: { type: 'number', description: 'X coordinate (click actions)' },
    y: { type: 'number', description: 'Y coordinate (click actions)' },
    text: { type: 'string', description: 'Text to type (type action)' },
    key: { type: 'string', description: 'Key or combo, e.g. enter, ctrl+c (key action)' },
  },
  async ({ action, x, y, text, key }) => {
    const act = String(action || 'click').trim();
    const payload = {};
    if (x != null) payload.x = x;
    if (y != null) payload.y = y;
    if (text) payload.text = text;
    if (key) payload.key = key;
    const result = await runScript('desktop-click.cjs', [act, JSON.stringify(payload)]);
    return resultWithScreenshot(result);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
