'use strict';

const n8nClient = require('./n8n-client');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('invalid JSON: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

function authorizeN8nRoute(req, body = {}, env = process.env) {
  const inboundSecret = String(env.EMAIL_INBOUND_SECRET || '').trim();
  const fleetToken = String(env.DENIZEN_FLEET_AGENT_TOKEN || '').trim();
  const gotInbound = String(body.secret || req.headers['x-denizen-secret'] || '').trim();
  const gotFleet = String(
    req.headers['x-fleet-agent-token']
    || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
    || body.fleetAgentToken
    || '',
  ).trim();

  if (inboundSecret && gotInbound === inboundSecret) return true;
  if (fleetToken && gotFleet === fleetToken) return true;
  if (!inboundSecret && !fleetToken) {
    // No secrets configured: allow ONLY a local operator (loopback with no
    // forwarding headers). Dev on localhost keeps working without env vars,
    // but an internet-exposed box with an incomplete .env no longer exposes
    // workflow create/activate (dossier G#4 — was fail-open).
    try {
      return require('./denizen-host-compute').isLocalOperatorRequest(req);
    } catch (_) {
      return false;
    }
  }
  return false;
}

function mountN8nRoutes() {
  return async function handleN8nRoutes(req, res, urlPath) {
    if (!urlPath.startsWith('/api/n8n')) return false;

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
        return true;
      }
    }

    if (!authorizeN8nRoute(req, body)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }

    try {
      if (urlPath === '/api/n8n/status' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          configured: n8nClient.isConfigured(),
          apiUrl: process.env.N8N_API_URL || 'http://127.0.0.1:5679/api/v1',
        });
        return true;
      }

      if (!n8nClient.isConfigured()) {
        sendJson(res, 503, { ok: false, error: 'N8N_API_URL / N8N_API_KEY not configured' });
        return true;
      }

      if (urlPath === '/api/n8n/workflows' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        const limit = Number(url.searchParams.get('limit') || 50);
        const activeParam = url.searchParams.get('active');
        const active = activeParam == null ? undefined : activeParam === 'true';
        const data = await n8nClient.listWorkflows({ limit, active });
        sendJson(res, 200, { ok: true, ...data });
        return true;
      }

      if (urlPath === '/api/n8n/workflows' && req.method === 'POST') {
        const created = await n8nClient.createWorkflow(body);
        sendJson(res, 201, { ok: true, workflow: created });
        return true;
      }

      const getMatch = urlPath.match(/^\/api\/n8n\/workflows\/([^/]+)$/);
      if (getMatch && req.method === 'GET') {
        const workflow = await n8nClient.getWorkflow(getMatch[1]);
        sendJson(res, 200, { ok: true, workflow });
        return true;
      }

      const activateMatch = urlPath.match(/^\/api\/n8n\/workflows\/([^/]+)\/activate$/);
      if (activateMatch && req.method === 'POST') {
        const active = body.active !== false;
        const result = await n8nClient.setWorkflowActive(activateMatch[1], active);
        sendJson(res, 200, { ok: true, active, result });
        return true;
      }

      sendJson(res, 404, { ok: false, error: 'n8n route not found' });
      return true;
    } catch (err) {
      sendJson(res, err.statusCode || 500, {
        ok: false,
        error: err.message || String(err),
        details: err.body || undefined,
      });
      return true;
    }
  };
}

module.exports = { mountN8nRoutes, authorizeN8nRoute };
