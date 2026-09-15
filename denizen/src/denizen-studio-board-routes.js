'use strict';

const { URL } = require('node:url');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const denizenDb = require('./denizen-db');
const sessionCookie = require('./visitor-session-cookie');
const visitorAccess = require('./visitor-access');

function sessionIdFrom(req, body, url) {
  return String(
    body.session_id
    || body.sessionId
    || url.searchParams.get('session_id')
    || req.headers['x-session-id']
    || sessionCookie.sessionIdFromCookies(req)
    || '',
  ).trim() || null;
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function verifyBoardSession(req, sessionId, body, verifyVisitorSession) {
  if (!sessionId) {
    const err = new Error('session_id required');
    err.code = 'BAD_INPUT';
    throw err;
  }
  if (typeof verifyVisitorSession === 'function') {
    await verifyVisitorSession(req, sessionId, body || {});
  }
  const access = await visitorAccess.resolveSessionAccess(sessionId);
  if (!access?.session) {
    const err = new Error('session not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (access.isDemo || String(access.tier || '').toLowerCase() === 'demo') {
    const err = new Error('Studio Board requires a team office session (not demo)');
    err.code = 'DENIED';
    throw err;
  }
  return access;
}

async function resolveOrgId(access) {
  return access?.orgId
    || access?.session?.org_id
    || denizenDb.orgId
    || null;
}

function mountStudioBoardRoutes({ verifyVisitorSession, readJsonBody } = {}) {
  return async function handleStudioBoardRoutes(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (!path.startsWith('/api/studio-board')) {
      return false;
    }

    try {
      if (path === '/api/studio-board/workspace' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured' });
          return true;
        }
        const row = await boardStore.getWorkspace(orgId);
        const state = row?.state || boardStore.emptyState();
        json(res, 200, {
          ok: true,
          org_id: orgId,
          org_slug: access.orgSlug || null,
          schema_version: row?.schema_version || boardStore.SCHEMA_VERSION,
          updated_at: row?.updated_at || null,
          updated_by: row?.updated_by || null,
          state,
          working_set: boardMutations.buildWorkingSet(state),
        });
        return true;
      }

      if (path === '/api/studio-board/workspace' && req.method === 'PUT') {
        const body = await readJsonBody(req, 2 * 1024 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured' });
          return true;
        }
        const state = boardStore.sanitizeState(body.state || body);
        const identityId = access.session?.identity_id || null;
        const ifUpdatedAt = body.if_updated_at || body.ifUpdatedAt || null;
        const saved = await boardStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt });
        if (saved?.conflict) {
          json(res, 409, {
            ok: false,
            error: 'Board was updated by a teammate — reloading latest copy',
            code: 'CONFLICT',
            org_id: orgId,
            state: saved.state,
            updated_at: saved.updated_at,
            schema_version: saved.schema_version,
          });
          return true;
        }
        json(res, 200, {
          ok: true,
          org_id: orgId,
          schema_version: saved?.schema_version || boardStore.SCHEMA_VERSION,
          updated_at: saved?.updated_at || new Date().toISOString(),
        });
        return true;
      }

      if (path === '/api/studio-board/working-set' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await boardStore.getWorkspace(orgId);
        json(res, 200, {
          ok: true,
          ...boardMutations.buildWorkingSet(row?.state || boardStore.emptyState()),
        });
        return true;
      }

      json(res, 404, { ok: false, error: 'Studio Board route not found', path });
      return true;
    } catch (err) {
      const status = err?.code === 'DENIED' || err?.code === 'BAD_INPUT' ? 401
        : err?.code === 'NOT_FOUND' ? 404
          : 500;
      json(res, status, { ok: false, error: err?.message || String(err), code: err?.code || null });
      return true;
    }
  };
}

module.exports = { mountStudioBoardRoutes };
