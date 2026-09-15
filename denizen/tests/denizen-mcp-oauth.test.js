'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const oauth = require('../src/denizen-mcp-oauth');

const BASE = 'https://office.example.com';

// Minimal mock res that captures the response.
function mockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = { ...this.headers, ...(headers || {}) }; },
    end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true; },
  };
  return res;
}

// Minimal mock req that streams an optional body.
function mockReq(method, url, { headers = {}, body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  process.nextTick(() => {
    if (body != null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

const deps = {
  getPublicBaseUrl: () => BASE,
  // Pretend any session resolves to an org.
  guardVisitorFeature: async (_req, sessionId) => {
    if (sessionId === 'bad') throw new Error('session invalid');
    return { orgId: 'org-1' };
  },
  createMcpToken: async ({ npcKey }) => ({ token: `tok-${npcKey}-secret`, mcp_url: `${BASE}/mcp/npc/${npcKey}` }),
};

async function call(method, url, opts, overrideDeps) {
  const req = mockReq(method, url, opts);
  const res = mockRes();
  const handled = await oauth.handleOAuthRoute(req, res, new URL(url, BASE).pathname, { ...deps, ...(overrideDeps || {}) });
  let json = null;
  try { json = JSON.parse(res.body); } catch (_) { /* html */ }
  return { handled, res, json };
}

const approveBody = {
  session_id: 'sess-good',
  npc: 'joshi',
  redirect_uri: 'https://chatgpt.com/cb',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  resource: `${BASE}/mcp/npc/joshi`,
};

describe('denizen-mcp-oauth', () => {
  it('serves authorization-server metadata', async () => {
    const { handled, res, json } = await call('GET', '/.well-known/oauth-authorization-server');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(json.authorization_endpoint, `${BASE}/mcp/oauth/authorize`);
    assert.equal(json.token_endpoint, `${BASE}/mcp/oauth/token`);
    assert.deepEqual(json.code_challenge_methods_supported, ['S256']);
  });

  it('serves protected-resource metadata with npc suffix', async () => {
    const { json } = await call('GET', '/.well-known/oauth-protected-resource/mcp/npc/lucy');
    assert.equal(json.resource, `${BASE}/mcp/npc/lucy`);
    assert.deepEqual(json.authorization_servers, [BASE]);
  });

  it('registers a dynamic client', async () => {
    const { res, json } = await call('POST', '/mcp/oauth/register', {
      headers: { 'content-type': 'application/json' },
      body: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
    });
    assert.equal(res.statusCode, 201);
    assert.match(json.client_id, /^dz-/);
    assert.equal(json.token_endpoint_auth_method, 'none');
  });

  it('rejects authorize without PKCE S256', async () => {
    const { res, json } = await call('GET', '/mcp/oauth/authorize?response_type=code&redirect_uri=https://x/cb');
    assert.equal(res.statusCode, 400);
    assert.equal(json.error, 'invalid_request');
  });

  it('serves a consent page for a valid authorize request', async () => {
    const url = `/mcp/oauth/authorize?response_type=code&client_id=dz-x&redirect_uri=${encodeURIComponent('https://claude.ai/cb')}`
      + `&code_challenge=abc&code_challenge_method=S256&state=s1&resource=${encodeURIComponent(`${BASE}/mcp/npc/lucy`)}`;
    const { res } = await call('GET', url);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'] || res.headers['content-type'], /text\/html/);
    assert.match(res.body, /Connect/);
    assert.match(res.body, /Lucy/); // npc label from resource
  });

  it('full PKCE flow: approve → token returns the minted gateway token', async () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'https://claude.ai/cb';

    // Approve (browser-side consent, session-authenticated)
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: {
        session_id: 'sess-good', session_token: 't', npc: 'lucy',
        client_id: 'dz-x', redirect_uri: redirectUri, code_challenge: challenge,
        code_challenge_method: 'S256', state: 's1', resource: `${BASE}/mcp/npc/lucy`,
      },
    });
    assert.equal(approve.res.statusCode, 200, approve.res.body);
    const redir = new URL(approve.json.redirect);
    const code = redir.searchParams.get('code');
    assert.ok(code, 'auth code issued');
    assert.equal(redir.searchParams.get('state'), 's1');

    // Token exchange with correct verifier
    const tok = await call('POST', '/mcp/oauth/token', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${code}&code_verifier=${verifier}&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=dz-x`,
    });
    assert.equal(tok.res.statusCode, 200, tok.res.body);
    assert.equal(tok.json.token_type, 'Bearer');
    assert.equal(tok.json.access_token, 'tok-lucy-secret'); // the gateway-minted token
  });

  it('rejects token exchange with a wrong PKCE verifier', async () => {
    const challenge = crypto.createHash('sha256').update('real-verifier').digest('base64url');
    const redirectUri = 'https://claude.ai/cb';
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: { session_id: 'sess-good', npc: 'bob', redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', resource: `${BASE}/mcp/npc/bob` },
    });
    const code = new URL(approve.json.redirect).searchParams.get('code');
    const tok = await call('POST', '/mcp/oauth/token', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${code}&code_verifier=WRONG&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });
    assert.equal(tok.res.statusCode, 400);
    assert.equal(tok.json.error, 'invalid_grant');
  });

  it('denies approve for an invalid session', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: { session_id: 'bad', npc: 'lucy', redirect_uri: 'https://x/cb', code_challenge: 'c', resource: `${BASE}/mcp/npc/lucy` },
    });
    assert.equal(approve.res.statusCode, 403);
    assert.equal(approve.json.error, 'access_denied');
  });

  it('builds a WWW-Authenticate header pointing at resource metadata', () => {
    const h = oauth.wwwAuthenticate(BASE, 'lucy');
    assert.match(h, /resource_metadata="https:\/\/office\.example\.com\/\.well-known\/oauth-protected-resource\/mcp\/npc\/lucy"/);
  });

  it('consent page surfaces error_description from approve failures', async () => {
    const url = `/mcp/oauth/authorize?response_type=code&client_id=dz-x&redirect_uri=${encodeURIComponent('https://chatgpt.com/cb')}`
      + `&code_challenge=abc&code_challenge_method=S256&state=s1&resource=${encodeURIComponent(`${BASE}/mcp/npc/joshi`)}`;
    const { res } = await call('GET', url);
    assert.match(res.body, /error_description/);
    assert.match(res.body, /data\.error_description\|\|data\.error/);
  });

  it('approve rejects when session has no org and no default org', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      guardVisitorFeature: async () => ({ orgId: null }),
      getDefaultOrgId: () => null,
    });
    assert.equal(approve.res.statusCode, 400);
    assert.equal(approve.json.error, 'invalid_request');
    assert.match(approve.json.error_description, /no organization/i);
  });

  it('approve falls back to getDefaultOrgId when session orgId is missing', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      guardVisitorFeature: async () => ({ orgId: null }),
      getDefaultOrgId: () => 'org-fallback',
      createMcpToken: async ({ orgId, npcKey }) => {
        assert.equal(orgId, 'org-fallback');
        return { token: `tok-${npcKey}`, mcp_url: `${BASE}/mcp/npc/${npcKey}` };
      },
    });
    assert.equal(approve.res.statusCode, 200, approve.res.body);
    assert.ok(approve.json.redirect);
  });

  it('approve maps demo-org mint failures to a clear access_denied', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      createMcpToken: async () => { throw new Error('demo org cannot create mcp tokens'); },
    });
    assert.equal(approve.res.statusCode, 403);
    assert.equal(approve.json.error, 'access_denied');
    assert.match(approve.json.error_description, /Demo offices cannot connect/i);
  });

  it('approve maps protected-NPC mint failures to access_denied', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      createMcpToken: async () => { throw new Error('NPC is protected'); },
    });
    assert.equal(approve.res.statusCode, 403);
    assert.equal(approve.json.error, 'access_denied');
    assert.match(approve.json.error_description, /joshi.*protected/i);
  });

  it('approve maps missing-org mint failures to invalid_request', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      createMcpToken: async () => { throw new Error('missing org_id required'); },
    });
    assert.equal(approve.res.statusCode, 400);
    assert.equal(approve.json.error, 'invalid_request');
    assert.match(approve.json.error_description, /team office/i);
  });

  it('approve returns server_error with description when mint returns no token', async () => {
    const approve = await call('POST', '/mcp/oauth/approve', {
      headers: { 'content-type': 'application/json' },
      body: approveBody,
    }, {
      createMcpToken: async () => ({ mcp_url: `${BASE}/mcp/npc/joshi` }),
    });
    assert.equal(approve.res.statusCode, 500);
    assert.equal(approve.json.error, 'server_error');
    assert.match(approve.json.error_description, /no access token/i);
  });
});
