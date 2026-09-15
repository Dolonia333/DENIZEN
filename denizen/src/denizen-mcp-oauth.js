'use strict';

/**
 * OAuth 2.1 front door for the per-NPC MCP gateway.
 *
 * Lets a user connect their AI *subscription* (Claude.ai, ChatGPT, Cursor, …) by
 * pasting a single MCP URL and clicking "Connect" — no bearer-token copy/paste.
 * Implements the MCP authorization handshake:
 *   - RFC 9728 protected-resource metadata  (/.well-known/oauth-protected-resource)
 *   - RFC 8414 authorization-server metadata (/.well-known/oauth-authorization-server)
 *   - RFC 7591 dynamic client registration   (POST /mcp/oauth/register)
 *   - PKCE authorize + consent               (GET  /mcp/oauth/authorize, POST /mcp/oauth/approve)
 *   - authorization_code → access_token       (POST /mcp/oauth/token)
 *
 * The issued access_token is just a per-NPC gateway token minted via the existing
 * createMcpToken(), so the gateway's bearer validation works unchanged.
 */

const crypto = require('node:crypto');
const npcRoster = require('./npc-roster');

const CODE_TTL_MS = 5 * 60 * 1000;       // auth code lives 5 min
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const _clients = new Map();              // client_id -> { redirect_uris, name, created }
const _codes = new Map();                // code -> { accessToken, npcKey, codeChallenge, redirectUri, clientId, expires }

function normalizeApproveNpcKey(raw) {
  return npcRoster.canonicalizeNpcKey(raw);
}

function unknownNpcDescription(npcKey) {
  const suggestion = npcRoster.suggestNpcKey(npcKey);
  if (suggestion && suggestion !== npcKey) {
    return `Teammate "${npcKey}" is not a known office NPC. Did you mean "${suggestion}"? Update the ChatGPT connector URL to /mcp/npc/${suggestion} and try Allow again.`;
  }
  return `Teammate "${npcKey}" is not a known office NPC. Use a Connect AI link from Denizen (e.g. /mcp/npc/josh), then try Allow again.`;
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of _codes) if (v.expires < now) _codes.delete(k);
  for (const [k, v] of _clients) if (now - v.created > CLIENT_TTL_MS) _clients.delete(k);
}

function send(res, status, obj, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...(extraHeaders || {}),
  });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) { raw = raw.slice(0, limit); req.destroy(); }
    });
    req.on('end', () => {
      const ct = String(req.headers['content-type'] || '');
      try {
        if (ct.includes('application/json')) return resolve(JSON.parse(raw || '{}'));
        // default: x-www-form-urlencoded
        const out = {};
        new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
        return resolve(out);
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function verifyPkce(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
  // constant-time compare
  const a = Buffer.from(hash);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function npcKeyFromResource(resource) {
  const m = String(resource || '').match(/\/mcp\/npc\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}

function authServerMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/mcp/oauth/authorize`,
    token_endpoint: `${base}/mcp/oauth/token`,
    registration_endpoint: `${base}/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  };
}

function protectedResourceMetadata(base, resource) {
  return {
    resource: resource || `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  };
}

/** Header value for a gateway 401 so MCP clients can discover this auth server. */
function wwwAuthenticate(base, npcKey) {
  const rs = npcKey
    ? `${base}/.well-known/oauth-protected-resource/mcp/npc/${encodeURIComponent(npcKey)}`
    : `${base}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${rs}"`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function consentPage({ npcKey, clientName, params }) {
  const npcLabel = npcKey
    ? (npcRoster.entries.find((e) => e.folder === npcKey)?.display
      || (npcKey.charAt(0).toUpperCase() + npcKey.slice(1)))
    : 'your NPC';
  const p = JSON.stringify(params);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect to Denizen</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at 30% 10%,#0b1220,#020617 60%);
    font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#e2eaf8}
  .card{background:linear-gradient(145deg,#0d1422,#121b2e);border:1px solid #1c2640;
    border-radius:18px;padding:32px;width:420px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#f0b429,#d97706);
    display:flex;align-items:center;justify-content:center;font-weight:900;color:#080d18;font-size:22px}
  h1{font-size:19px;margin:18px 0 6px}
  p{color:#7a92b8;font-size:13.5px;line-height:1.5;margin:6px 0}
  .npc{display:flex;align-items:center;gap:10px;background:#0b1220;border:1px solid #1c2640;
    border-radius:12px;padding:12px 14px;margin:16px 0}
  .npc b{color:#fff}
  .scopes{font-size:12.5px;color:#7a92b8;margin:14px 0;padding-left:18px}
  .scopes li{margin:4px 0}
  .row{display:flex;gap:10px;margin-top:22px}
  button{flex:1;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;border:none}
  .allow{background:linear-gradient(135deg,#f0b429,#d97706);color:#080d18}
  .deny{background:#1c2640;color:#93a4c4;border:1px solid #243358}
  .err{color:#fca5a5;font-size:13px;margin-top:14px;display:none}
  a{color:#93c5fd}
  .muted{font-size:11px;color:#3d5278;margin-top:18px}
</style></head><body>
<div class="card">
  <div class="logo">D</div>
  <h1>Connect ${esc(clientName)} to Denizen</h1>
  <p>An AI client wants to sync with your in-world teammate.</p>
  <div class="npc"><span style="font-size:22px">🤖</span><div>Teammate NPC<br><b>${esc(npcLabel)}</b></div></div>
  <ul class="scopes">
    <li>Read the NPC's status, memories &amp; work feed</li>
    <li>Add memories and log activity for the NPC</li>
  </ul>
  <div id="needauth" style="display:none">
    <p class="err" style="display:block">You're not signed in to Denizen in this browser.
    <a href="/" target="_blank">Open Denizen</a>, sign in, then reload this page.</p>
  </div>
  <div id="consent">
    <div class="row">
      <button class="deny" onclick="decide(false)">Deny</button>
      <button class="allow" id="allowBtn" onclick="decide(true)">Allow</button>
    </div>
  </div>
  <div class="err" id="err"></div>
  <div class="muted">You can revoke this anytime in Denizen settings.</div>
</div>
<script>
  const PARAMS = ${p};
  function readSession(){ try{ return JSON.parse(localStorage.getItem('denizen-visitor-session')||'{}'); }catch(e){ return {}; } }
  const sess = readSession();
  if(!sess.session_id){ document.getElementById('needauth').style.display='block'; document.getElementById('consent').style.display='none'; }
  function fail(redir){ if(PARAMS.redirect_uri){ const u=new URL(PARAMS.redirect_uri); u.searchParams.set('error','access_denied'); if(PARAMS.state)u.searchParams.set('state',PARAMS.state); location.href=u.toString(); } else { document.getElementById('err').textContent='Cancelled.'; document.getElementById('err').style.display='block'; } }
  async function decide(allow){
    if(!allow) return fail();
    const btn=document.getElementById('allowBtn'); btn.textContent='Connecting…'; btn.disabled=true;
    try{
      const res=await fetch('/mcp/oauth/approve',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Id':sess.session_id||'','X-Session-Token':sess.session_token||''},
        body:JSON.stringify({ ...PARAMS, session_id:sess.session_id, session_token:sess.session_token })});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.redirect){
        const detail=data.error_description||data.error||('Approval failed ('+res.status+')');
        throw new Error(detail);
      }
      location.href=data.redirect;
    }catch(e){ const el=document.getElementById('err'); el.textContent=e.message||'Could not connect'; el.style.display='block'; btn.textContent='Allow'; btn.disabled=false; }
  }
</script>
</body></html>`;
}

/**
 * Route handler. deps: { getPublicBaseUrl, createMcpToken, guardVisitorFeature }
 * Returns true if it handled the request.
 */
async function handleOAuthRoute(req, res, urlPath, deps) {
  sweep();
  const base = String(deps.getPublicBaseUrl()).replace(/\/$/, '');

  // CORS preflight for the programmatic endpoints
  if (req.method === 'OPTIONS' && (urlPath.startsWith('/mcp/oauth/') || urlPath.startsWith('/.well-known/oauth'))) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Session-Id,X-Session-Token,mcp-protocol-version',
    });
    res.end();
    return true;
  }

  // --- Discovery: authorization server metadata ---
  if (req.method === 'GET' && urlPath === '/.well-known/oauth-authorization-server') {
    send(res, 200, authServerMetadata(base));
    return true;
  }

  // --- Discovery: protected resource metadata (with optional /mcp/npc/<key> suffix) ---
  if (req.method === 'GET' && urlPath.startsWith('/.well-known/oauth-protected-resource')) {
    const suffix = urlPath.replace('/.well-known/oauth-protected-resource', '');
    const resource = suffix ? `${base}${suffix}` : `${base}/mcp`;
    send(res, 200, protectedResourceMetadata(base, resource));
    return true;
  }

  // --- Dynamic client registration ---
  if (req.method === 'POST' && urlPath === '/mcp/oauth/register') {
    const body = await readBody(req);
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(Boolean) : [];
    const clientId = `dz-${crypto.randomBytes(16).toString('hex')}`;
    _clients.set(clientId, {
      redirect_uris: redirectUris,
      name: String(body.client_name || 'MCP Client').slice(0, 120),
      created: Date.now(),
    });
    send(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    return true;
  }

  // --- Authorize: serve consent page ---
  if (req.method === 'GET' && urlPath === '/mcp/oauth/authorize') {
    const u = new URL(req.url, base);
    const q = u.searchParams;
    const params = {
      response_type: q.get('response_type') || '',
      client_id: q.get('client_id') || '',
      redirect_uri: q.get('redirect_uri') || '',
      code_challenge: q.get('code_challenge') || '',
      code_challenge_method: q.get('code_challenge_method') || '',
      state: q.get('state') || '',
      resource: q.get('resource') || '',
      scope: q.get('scope') || 'mcp',
    };
    if (params.response_type !== 'code' || !params.redirect_uri) {
      return (send(res, 400, { error: 'invalid_request', error_description: 'response_type=code and redirect_uri required' }), true);
    }
    if (!params.code_challenge || params.code_challenge_method !== 'S256') {
      return (send(res, 400, { error: 'invalid_request', error_description: 'PKCE S256 required' }), true);
    }
    const npcKey = normalizeApproveNpcKey(
      npcKeyFromResource(params.resource) || (q.get('npc') || ''),
    );
    const client = _clients.get(params.client_id);
    const clientName = client?.name || 'an AI client';
    sendHtml(res, 200, consentPage({ npcKey, clientName, params: { ...params, npc: npcKey } }));
    return true;
  }

  // --- Approve: browser-side consent confirmed (session-authenticated) ---
  if (req.method === 'POST' && urlPath === '/mcp/oauth/approve') {
    const body = await readBody(req);
    const sessionId = body.session_id || req.headers['x-session-id'];
    const requestedKey = String(body.npc || npcKeyFromResource(body.resource) || '').toLowerCase().trim();
    const npcKey = normalizeApproveNpcKey(requestedKey);
    if (!sessionId || !npcKey) {
      return (send(res, 400, { error: 'invalid_request', error_description: 'session and npc required' }), true);
    }
    if (!body.code_challenge || !body.redirect_uri) {
      return (send(res, 400, { error: 'invalid_request', error_description: 'code_challenge and redirect_uri required' }), true);
    }
    let access;
    try {
      access = await deps.guardVisitorFeature(req, sessionId, 'mcp_connect', body);
    } catch (err) {
      return (send(res, 403, { error: 'access_denied', error_description: err?.message || 'session invalid' }), true);
    }
    const orgId = access?.orgId
      || (typeof deps.resolveOrgId === 'function' ? await deps.resolveOrgId(access, sessionId) : null)
      || (typeof deps.getDefaultOrgId === 'function' ? deps.getDefaultOrgId() : null)
      || null;
    if (!orgId) {
      return (send(res, 400, {
        error: 'invalid_request',
        error_description: 'Your Denizen session has no organization. Sign in with a team office code on denizen.dolonia.cloud, then click Allow again.',
      }), true);
    }
    let minted;
    try {
      minted = await deps.createMcpToken({ orgId, npcKey, sessionId, label: 'oauth' });
    } catch (err) {
      const msg = String(err?.message || 'token mint failed');
      console.error('[mcp-oauth] token mint failed', { npcKey, requestedKey, sessionId, orgId, err: msg });
      if (/demo org/i.test(msg)) {
        return (send(res, 403, {
          error: 'access_denied',
          error_description: 'Demo offices cannot connect ChatGPT or Claude. Join a team office, then try Allow again.',
        }), true);
      }
      if (/protected/i.test(msg)) {
        return (send(res, 403, {
          error: 'access_denied',
          error_description: `Teammate "${npcKey}" is protected and cannot be connected via MCP.`,
        }), true);
      }
      if (/database unavailable|missing org|org_id.*required/i.test(msg)) {
        return (send(res, 400, {
          error: 'invalid_request',
          error_description: 'Could not mint an MCP token for this session. Sign in to your team office and retry.',
        }), true);
      }
      // FK 23503 / "not present in table denizen_npcs" — usually a typo'd connector URL.
      if (/23503|denizen_npcs|is not present|unknown npc|not a known/i.test(msg)) {
        return (send(res, 400, {
          error: 'invalid_request',
          error_description: unknownNpcDescription(requestedKey || npcKey),
        }), true);
      }
      return (send(res, 500, { error: 'server_error', error_description: msg }), true);
    }
    if (!minted?.token) {
      return (send(res, 500, { error: 'server_error', error_description: 'token mint returned no access token' }), true);
    }
    const code = crypto.randomBytes(32).toString('base64url');
    _codes.set(code, {
      accessToken: minted.token,
      npcKey,
      codeChallenge: body.code_challenge,
      redirectUri: body.redirect_uri,
      clientId: body.client_id || null,
      expires: Date.now() + CODE_TTL_MS,
    });
    const redir = new URL(body.redirect_uri);
    redir.searchParams.set('code', code);
    if (body.state) redir.searchParams.set('state', body.state);
    send(res, 200, { redirect: redir.toString() });
    return true;
  }

  // --- Token: exchange auth code (PKCE) for the access token ---
  if (req.method === 'POST' && urlPath === '/mcp/oauth/token') {
    const body = await readBody(req);
    const grant = body.grant_type;
    if (grant !== 'authorization_code') {
      return (send(res, 400, { error: 'unsupported_grant_type' }), true);
    }
    const entry = _codes.get(body.code);
    if (!entry || entry.expires < Date.now()) {
      return (send(res, 400, { error: 'invalid_grant', error_description: 'code invalid or expired' }), true);
    }
    _codes.delete(body.code); // one-time use
    if (entry.redirectUri !== body.redirect_uri) {
      return (send(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' }), true);
    }
    if (!verifyPkce(body.code_verifier, entry.codeChallenge)) {
      return (send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' }), true);
    }
    send(res, 200, {
      access_token: entry.accessToken,
      token_type: 'Bearer',
      scope: 'mcp',
      // Gateway tokens are long-lived; no refresh needed, but advertise a window.
      expires_in: 60 * 60 * 24 * 365,
    });
    return true;
  }

  return false;
}

module.exports = {
  handleOAuthRoute,
  wwwAuthenticate,
  authServerMetadata,
  protectedResourceMetadata,
  npcKeyFromResource,
  verifyPkce,
};
