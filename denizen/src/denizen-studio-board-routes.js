'use strict';

const { URL } = require('node:url');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const boardPresence = require('./denizen-studio-board-presence');
const boardAcl = require('./denizen-studio-board-acl');
const boardActivity = require('./denizen-studio-board-activity');
const boardAutomations = require('./denizen-studio-board-automations');
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

function actorFromAccess(access) {
  return {
    identityId: access?.session?.identity_id || null,
    identity_id: access?.session?.identity_id || null,
    email: access?.session?.email || access?.user?.email || null,
    displayName: access?.session?.display_name || access?.user?.display_name || null,
    enforceAcl: true,
  };
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
        let row = await boardStore.getWorkspace(orgId);
        let state = row?.state || boardStore.emptyState();
        // Seed owner + migrate config on read (lazy)
        if (state.config) {
          boardStore.migrateConfig(state.config);
          boardAcl.seedOwnerIfEmpty(state.config, actorFromAccess(access));
        }
        boardAutomations.sweepDuePassed(state, 'Automation');
        const actor = actorFromAccess(access);
        json(res, 200, {
          ok: true,
          org_id: orgId,
          org_slug: access.orgSlug || null,
          schema_version: row?.schema_version || boardStore.SCHEMA_VERSION,
          updated_at: row?.updated_at || null,
          updated_by: row?.updated_by || null,
          state,
          activity: boardActivity.listActivity(state),
          is_admin: boardAcl.isAdmin(state.config, actor),
          is_owner: boardAcl.isOwner(state.config, actor),
          presence: boardPresence.list(orgId),
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
        boardAcl.seedOwnerIfEmpty(state.config || (state.config = {}), actorFromAccess(access));
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
            activity: boardActivity.listActivity(saved.state),
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

      // Entity patch — task
      const taskPatch = path.match(/^\/api\/studio-board\/tasks\/([^/]+)$/);
      if (taskPatch && req.method === 'PATCH') {
        const body = await readJsonBody(req, 512 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const taskId = decodeURIComponent(taskPatch[1]);
        const result = await boardMutations.patchTaskEntity(
          orgId,
          taskId,
          body.patch || body,
          access.session?.identity_id || null,
          actorFromAccess(access),
        );
        if (result?.code === 'CONFLICT') {
          json(res, 409, result);
          return true;
        }
        json(res, result.ok ? 200 : 400, result);
        return true;
      }

      if (path === '/api/studio-board/presence' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        json(res, 200, { ok: true, presence: boardPresence.list(orgId) });
        return true;
      }

      if (path === '/api/studio-board/presence' && req.method === 'POST') {
        const body = await readJsonBody(req, 64 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const presence = boardPresence.heartbeat(orgId, {
          ...body,
          identityId: access.session?.identity_id,
          sessionId,
          displayName: body.display_name
            || body.displayName
            || access.session?.display_name
            || access.user?.display_name
            || 'Teammate',
        });
        json(res, 200, { ok: true, presence });
        return true;
      }

      if (path === '/api/studio-board/activity' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyBoardSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const result = await boardMutations.listOrgActivity(orgId, {
          limit: Number(url.searchParams.get('limit')) || 50,
        });
        json(res, 200, result);
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
        const state = row?.state || boardStore.emptyState();
        boardAutomations.sweepDuePassed(state, 'Automation');
        json(res, 200, {
          ok: true,
          ...boardMutations.buildWorkingSet(state),
        });
        return true;
      }

      json(res, 404, { ok: false, error: 'Studio Board route not found', path });
      return true;
    } catch (err) {
      const status = err?.code === 'DENIED' || err?.code === 'BAD_INPUT' ? 401
        : err?.code === 'FORBIDDEN' ? 403
          : err?.code === 'NOT_FOUND' ? 404
            : 500;
      json(res, status, { ok: false, error: err?.message || String(err), code: err?.code || null });
      return true;
    }
  };
}

module.exports = { mountStudioBoardRoutes };
