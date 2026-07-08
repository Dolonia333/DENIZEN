'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DENIZEN_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT) || 9876;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProc;
let browser;
let serverLog = '';

function startServer() {
  const envFile = path.join(DENIZEN_ROOT, '.env');
  const nodeArgs = fs.existsSync(envFile)
    ? ['--env-file', envFile, 'server.js']
    : ['server.js'];

  const childEnv = { ...process.env, PORT: String(PORT) };
  if (process.env.DENIZEN_DB_ENABLED != null) {
    childEnv.DENIZEN_DB_ENABLED = process.env.DENIZEN_DB_ENABLED;
  }

  serverProc = spawn(process.execPath, nodeArgs, {
    cwd: DENIZEN_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProc.stdout?.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverProc.stderr?.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
}

async function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc?.exitCode != null) {
      throw new Error(
        `Server exited with code ${serverProc.exitCode} before /api/health responded:\n${serverLog.slice(-4000)}`,
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}/api/health`);
}

function stopServer() {
  if (!serverProc || serverProc.killed) return;
  serverProc._stopping = true;
  serverProc.kill('SIGTERM');
  setTimeout(() => {
    if (serverProc && serverProc.exitCode == null) {
      serverProc.kill('SIGKILL');
    }
  }, 5000);
}

describe('visitor assistant E2E', () => {
  before(async () => {
    startServer();
    await waitForHealth();
  });

  after(async () => {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    stopServer();
  });

  it('loads DenizenVisitorSession and exercises visitor APIs', async () => {
    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await page.waitForFunction(
      () =>
        typeof globalThis.DenizenVisitorSession === 'object'
        && globalThis.DenizenVisitorSession != null,
      { timeout: 30_000 },
    );

    const sessionApi = await page.evaluate(() => {
      const sess = globalThis.DenizenVisitorSession;
      return {
        hasInit: typeof sess?.init === 'function',
        hasGetSessionId: typeof sess?.getSessionId === 'function',
      };
    });
    assert.ok(sessionApi.hasInit, 'DenizenVisitorSession.init is available');
    assert.ok(sessionApi.hasGetSessionId, 'DenizenVisitorSession.getSessionId is available');

    const sessionRes = await page.request.post(`${BASE_URL}/api/visitor/session`, {
      data: { display_name: 'TestUser' },
    });

    if (sessionRes.status() === 503) {
      console.log(
        '[e2e] Visitor DB unavailable (503) — skipping session/claim/assistant API chain',
      );
      const body = await sessionRes.json();
      assert.equal(body.ok, false);
      assert.ok(typeof body.error === 'string' && body.error.length > 0);
      await page.close();
      return;
    }

    assert.equal(sessionRes.status(), 200);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.ok, true);
    assert.ok(sessionBody.session?.id, 'session id returned');
    assert.equal(sessionBody.session.display_name, 'TestUser');

    const sessionId = sessionBody.session.id;

    const claimRes = await page.request.post(`${BASE_URL}/api/visitor/claim`, {
      data: { session_id: sessionId, npc_key: 'bob' },
    });
    assert.equal(claimRes.status(), 200);
    const claimBody = await claimRes.json();
    assert.equal(claimBody.ok, true);
    assert.equal(claimBody.assistant?.npc_key, 'bob');

    const assistantRes = await page.request.get(
      `${BASE_URL}/api/visitor/assistant?session_id=${encodeURIComponent(sessionId)}`,
    );
    assert.equal(assistantRes.status(), 200);
    const assistantBody = await assistantRes.json();
    assert.equal(assistantBody.ok, true);
    assert.equal(assistantBody.assistant?.npc_key, 'bob');

    await page.close();
  });
});
