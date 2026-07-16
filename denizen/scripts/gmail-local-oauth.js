#!/usr/bin/env node
'use strict';
/**
 * Local Gmail OAuth for Denizen (compose + readonly for CRM inbound).
 *
 * Prerequisites:
 *   1. Google Cloud project → OAuth client type "Desktop app"
 *   2. Enable Gmail API
 *   3. Put client id/secret in env or data/gmail-oauth-client.json:
 *        { "client_id": "...", "client_secret": "...", "redirect_uri": "http://127.0.0.1:8765/oauth2callback" }
 *
 * Usage:
 *   node scripts/gmail-local-oauth.js
 *   node scripts/gmail-local-oauth.js --upload-nas
 *
 * Saves: data/gmail-oauth.json
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.GMAIL_OAUTH_PORT || 8765);
const OAUTH_FILE = path.join(ROOT, 'data', 'gmail-oauth.json');
const CLIENT_FILE = path.join(ROOT, 'data', 'gmail-oauth-client.json');
const REDIRECT = process.env.GMAIL_OAUTH_REDIRECT || `http://127.0.0.1:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

function loadClient() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GMAIL_OAUTH_REDIRECT || REDIRECT,
    };
  }
  if (fs.existsSync(CLIENT_FILE)) {
    const j = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
    // support Google "installed" / "web" download shapes
    const block = j.installed || j.web || j;
    return {
      client_id: block.client_id || j.client_id,
      client_secret: block.client_secret || j.client_secret,
      redirect_uri: (block.redirect_uris && block.redirect_uris[0]) || j.redirect_uri || REDIRECT,
    };
  }
  return null;
}

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;max-width:640px;margin:48px auto;padding:24px}
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px}code{color:#7dd3fc}a{color:#38bdf8}</style>
</head><body><div class="box"><h1>${title}</h1>${body}</div></body></html>`;
}

function openBrowser(url) {
  const plat = process.platform;
  if (plat === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  else if (plat === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
  else spawnSync('xdg-open', [url], { stdio: 'ignore' });
}

async function exchangeCode(client, code) {
  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: client.redirect_uri || REDIRECT,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || `token ${res.status}`);
  return json;
}

function saveTokens(client, tokens) {
  const out = {
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: client.redirect_uri || REDIRECT,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope || SCOPES,
    token_type: tokens.token_type || 'Bearer',
    expiry_date: tokens.expiry_date
      || (tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null),
  };
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

function uploadNas() {
  const script = path.resolve(__dirname, '../../infra/upload-gmail-oauth-nas.py');
  if (!fs.existsSync(script)) {
    console.error('Missing', script);
    process.exit(1);
  }
  const py = process.platform === 'win32' ? 'py' : 'python3';
  const r = spawnSync(py, [script], { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') });
  process.exit(r.status ?? 1);
}

async function main() {
  const upload = process.argv.includes('--upload-nas');
  const client = loadClient();
  if (!client?.client_id || !client?.client_secret) {
    console.error(`
Missing Google OAuth client.

1) Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Desktop app
2) Enable Gmail API
3) Save as denizen/data/gmail-oauth-client.json:

{
  "client_id": "....apps.googleusercontent.com",
  "client_secret": "GOCSPX-...",
  "redirect_uri": "http://127.0.0.1:${PORT}/oauth2callback"
}

Or set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET env vars.
`);
    process.exit(1);
  }

  // Ensure redirect matches what we use
  client.redirect_uri = client.redirect_uri || REDIRECT;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', client.client_id);
  authUrl.searchParams.set('redirect_uri', client.redirect_uri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  let done = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(
        'Gmail OAuth for Denizen',
        `<p>Connect <strong>your</strong> Gmail (the inbox Angela emails).</p>
         <p><a href="${authUrl.toString()}">Authorize Gmail (readonly + send)</a></p>
         <p>Redirect: <code>${client.redirect_uri}</code></p>`,
      ));
      return;
    }
    if (url.pathname === '/oauth2callback') {
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(page('OAuth error', `<p>${err}</p>`));
        return;
      }
      try {
        const tokens = await exchangeCode(client, code);
        if (!tokens.refresh_token) {
          console.warn('No refresh_token — revoke app access in Google Account and retry with prompt=consent');
        }
        saveTokens(client, tokens);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page(
          'Gmail connected',
          `<p>Saved <code>data/gmail-oauth.json</code>.</p>
           <p>${upload ? 'Uploading to NAS… close this tab.' : 'Run with <code>--upload-nas</code> to push to the server.'}</p>`,
        ));
        done = true;
        setTimeout(() => {
          server.close();
          if (upload) uploadNas();
          else process.exit(0);
        }, 400);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(page('Token exchange failed', `<p>${e.message}</p>`));
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Gmail OAuth listening http://127.0.0.1:${PORT}`);
    console.log('Scopes:', SCOPES);
    openBrowser(`http://127.0.0.1:${PORT}/`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
