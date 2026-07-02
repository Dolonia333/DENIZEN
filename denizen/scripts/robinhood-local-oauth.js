#!/usr/bin/env node
'use strict';
/**
 * One-shot Robinhood OAuth on localhost, then optional NAS upload.
 *
 * Robinhood's Trading MCP OAuth is built for IDE clients (Cursor, Claude, etc.).
 * Custom cloud redirect URLs often fail on Robinhood's consent screen.
 * Localhost registration + callback usually works; copy the token to NAS after.
 *
 * Usage:
 *   node scripts/robinhood-local-oauth.js
 *   node scripts/robinhood-local-oauth.js --upload-nas
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PORT = Number(process.env.ROBINHOOD_OAUTH_PORT || 8080);
const ROOT = path.resolve(__dirname, '..');
const OAUTH_FILE = path.join(ROOT, 'data', 'robinhood-oauth.json');

// Force localhost redirect for this flow.
delete process.env.DENIZEN_PUBLIC_URL;
delete process.env.DENIZEN_URL;
delete process.env.ROBINHOOD_REDIRECT_URI;
process.env.PORT = String(PORT);

const robinhoodMcp = require('../src/robinhood-mcp');

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;max-width:560px;margin:48px auto;padding:24px}
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px}a{color:#38bdf8}</style></head>
<body><div class="box"><h1>${title}</h1>${body}</div></body></html>`;
}

function resetOAuthFile() {
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE, '{}\n');
}

function uploadToNas() {
  const uploadScript = path.resolve(__dirname, '../../infra/upload-robinhood-oauth-nas.py');
  if (!fs.existsSync(uploadScript)) {
    console.error('Missing infra/upload-robinhood-oauth-nas.py');
    process.exit(1);
  }
  const py = process.platform === 'win32' ? 'py' : 'python3';
  const result = spawnSync(py, [uploadScript], { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') });
  process.exit(result.status ?? 1);
}

async function main() {
  const uploadNas = process.argv.includes('--upload-nas');
  resetOAuthFile();

  const redirectUri = robinhoodMcp.getRedirectUri();
  const connectUrl = `http://127.0.0.1:${PORT}/api/market/auth/connect`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/' || url.pathname === '/api/market/auth-status') {
      const authed = robinhoodMcp.isAuthenticated();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(
        authed ? 'Robinhood connected' : 'Robinhood local OAuth',
        authed
          ? `<p>Authenticated. Token saved to <code>data/robinhood-oauth.json</code>.</p>
             <p>${uploadNas ? 'Uploading to NAS…' : 'Run with <code>--upload-nas</code> to push token to your NAS.'}</p>`
          : `<p>Redirect URI: <code>${redirectUri}</code></p>
             <p><a href="/api/market/auth/connect">Connect Robinhood</a></p>
             <p>Use desktop browser. If Robinhood errors, your Agentic account may already be bound to Cursor — see docs/ROBINHOOD_LIVE.md.</p>`,
      ));
      if (authed && uploadNas) {
        setTimeout(() => {
          server.close();
          uploadToNas();
        }, 500);
      }
      return;
    }

    if (url.pathname === '/api/market/auth/connect' && req.method === 'GET') {
      try {
        const authUrl = await robinhoodMcp.buildAuthUrl();
        res.writeHead(302, { Location: authUrl });
        res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(page('Auth setup failed', `<p>${err.message}</p>`));
      }
      return;
    }

    if (url.pathname === '/api/market/auth/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(page('Robinhood auth failed', `<p>${error || 'No authorization code received'}</p>
          <p><a href="/api/market/auth/connect">Try again</a></p>`));
        return;
      }
      try {
        await robinhoodMcp.handleCallback(code, state);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Robinhood connected', `<p>Roki token saved locally.</p>
          <p><a href="/">Continue</a></p>`));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(page('Token exchange failed', `<p>${err.message}</p>
          <p><a href="/api/market/auth/connect">Try again</a></p>`));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('Robinhood local OAuth');
    console.log(`  redirect: ${redirectUri}`);
    console.log(`  open:     ${connectUrl}`);
    console.log('  Press Ctrl+C when done.');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
