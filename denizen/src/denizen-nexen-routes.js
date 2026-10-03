'use strict';

const { URL } = require('node:url');
const nexenStore = require('./denizen-nexen-store');
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

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function verifyNexenSession(req, sessionId, body, verifyVisitorSession) {
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
    email: access?.session?.email || access?.user?.email || null,
    displayName: access?.session?.display_name || access?.user?.display_name || null,
    tier: access?.tier || access?.session?.tier || null,
  };
}

function hubSummary(state, mode, orgId) {
  const tasks = state.tasks || [];
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed');
  const urgent = open.filter((t) => t.priority === 'urgent' || t.priority === 'high');
  const planned = (state.requests || []).filter((r) => r.status === 'planned');
  return {
    ok: true,
    service: 'denizen-nexen',
    mode,
    org_id: orgId,
    status: {
      online: true,
      open_tasks: open.length,
      urgent_tasks: urgent.length,
      planned_requests: planned.length,
      activity: (state.activity || []).length,
    },
    brief: mode === 'local'
      ? 'NEXEN is running on DENIZEN in local mode. Cloud workspace persistence needs your org database.'
      : 'NEXEN Command Center is live on your DENIZEN org workspace.',
    focus: {
      title: state.config?.focusTitle || 'Your next move',
      detail: state.config?.focusDetail || '',
      urgent: urgent.slice(0, 5),
    },
    workspaces: state.config?.workspaces || nexenStore.emptyState().config.workspaces,
    requests: (state.requests || []).slice(0, 40),
    tasks: tasks.slice(0, 80),
    activity: (state.activity || []).slice(0, 30),
    updated_at: null,
  };
}

function mountNexenRoutes({ verifyVisitorSession, readJsonBody } = {}) {
  return async function handleNexenRoutes(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (!path.startsWith('/api/nexen')) {
      return false;
    }

    try {
      if (path === '/api/nexen/health' && req.method === 'GET') {
        json(res, 200, {
          ok: true,
          service: 'denizen-nexen',
          routes: [
            'GET /api/nexen/health',
            'GET /api/nexen/hub',
            'GET|PUT /api/nexen/workspace',
            'POST /api/nexen/request',
            'POST /api/nexen/tasks',
            'PATCH /api/nexen/tasks/:id',
          ],
        });
        return true;
      }

      if (path === '/api/nexen/hub' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        // Hub is readable with or without session — richer when signed in.
        let mode = 'anonymous';
        let orgId = null;
        let state = nexenStore.emptyState();
        let updatedAt = null;
        if (sessionId) {
          try {
            const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
            orgId = await resolveOrgId(access);
            if (orgId && denizenDb.enabled) {
              const row = await nexenStore.getWorkspace(orgId);
              state = row?.state || nexenStore.emptyState();
              updatedAt = row?.updated_at || null;
              mode = 'cloud';
            } else {
              mode = denizenDb.enabled ? 'cloud-empty' : 'local';
            }
          } catch (_) {
            mode = 'anonymous';
          }
        } else if (!denizenDb.enabled) {
          mode = 'local';
        }
        const summary = hubSummary(state, mode, orgId);
        summary.updated_at = updatedAt;
        json(res, 200, summary);
        return true;
      }

      if (path === '/api/nexen/workspace' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 200, {
            ok: true,
            mode: 'local',
            org_id: orgId,
            state: nexenStore.emptyState(),
            updated_at: null,
            schema_version: nexenStore.SCHEMA_VERSION,
          });
          return true;
        }
        const row = await nexenStore.getWorkspace(orgId);
        json(res, 200, {
          ok: true,
          mode: 'cloud',
          org_id: orgId,
          state: row?.state || nexenStore.emptyState(),
          updated_at: row?.updated_at || null,
          schema_version: row?.schema_version || nexenStore.SCHEMA_VERSION,
          viewer: actorFromAccess(access),
        });
        return true;
      }

      if (path === '/api/nexen/workspace' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured — use local storage' });
          return true;
        }
        const actor = actorFromAccess(access);
        const result = await nexenStore.upsertWorkspace(orgId, body.state, actor.identityId, {
          ifUpdatedAt: body.if_updated_at || body.ifUpdatedAt || null,
        });
        if (result?.conflict) {
          json(res, 409, { ok: false, conflict: true, ...result });
          return true;
        }
        json(res, 200, {
          ok: true,
          org_id: orgId,
          state: nexenStore.sanitizeState(result?.state || body.state),
          updated_at: result?.updated_at || null,
          schema_version: result?.schema_version || nexenStore.SCHEMA_VERSION,
        });
        return true;
      }

      if (path === '/api/nexen/request' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const text = String(body.text || '').trim();
        if (!text) {
          json(res, 400, { ok: false, error: 'text required' });
          return true;
        }
        const actor = actorFromAccess(access);
        const request = {
          id: uid('req'),
          text: text.slice(0, 4000),
          status: 'planned',
          created_at: new Date().toISOString(),
          created_by: actor.identityId || actor.email || null,
        };

        if (!denizenDb.enabled) {
          json(res, 200, {
            ok: true,
            mode: 'local',
            id: request.id,
            status: 'planned',
            message: 'Saved locally in this response only. Connect the org database to persist.',
            request,
          });
          return true;
        }

        const patched = await nexenStore.patchWorkspace(orgId, (state) => {
          state.requests = [request, ...(state.requests || [])].slice(0, 200);
          state.activity = [{
            id: uid('act'),
            type: 'request_saved',
            text: request.text.slice(0, 160),
            at: request.created_at,
          }, ...(state.activity || [])].slice(0, 200);
          return request;
        }, actor.identityId);

        if (!patched.ok) {
          json(res, patched.conflict ? 409 : 503, { ok: false, ...patched });
          return true;
        }
        json(res, 200, {
          ok: true,
          mode: 'cloud',
          id: request.id,
          status: 'planned',
          message: 'Saved as a planned request on your DENIZEN NEXEN workspace.',
          request,
          state: patched.state,
          updated_at: patched.updated_at,
        });
        return true;
      }

      if (path === '/api/nexen/tasks' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const title = String(body.title || '').trim();
        if (!title) {
          json(res, 400, { ok: false, error: 'title required' });
          return true;
        }
        const actor = actorFromAccess(access);
        const task = {
          id: uid('task'),
          title: title.slice(0, 240),
          status: String(body.status || 'open'),
          priority: String(body.priority || 'normal'),
          notes: String(body.notes || '').slice(0, 4000),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (!denizenDb.enabled) {
          json(res, 200, { ok: true, mode: 'local', task });
          return true;
        }
        const patched = await nexenStore.patchWorkspace(orgId, (state) => {
          state.tasks = [task, ...(state.tasks || [])].slice(0, 300);
          state.activity = [{
            id: uid('act'),
            type: 'task_created',
            text: task.title,
            at: task.created_at,
          }, ...(state.activity || [])].slice(0, 200);
          return task;
        }, actor.identityId);
        if (!patched.ok) {
          json(res, patched.conflict ? 409 : 503, { ok: false, ...patched });
          return true;
        }
        json(res, 200, { ok: true, mode: 'cloud', task, state: patched.state, updated_at: patched.updated_at });
        return true;
      }

      const taskPatch = path.match(/^\/api\/nexen\/tasks\/([^/]+)$/);
      if (taskPatch && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyNexenSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured' });
          return true;
        }
        const taskId = decodeURIComponent(taskPatch[1]);
        const actor = actorFromAccess(access);
        const patched = await nexenStore.patchWorkspace(orgId, (state) => {
          const idx = (state.tasks || []).findIndex((t) => t.id === taskId);
          if (idx < 0) return false;
          const prev = state.tasks[idx];
          state.tasks[idx] = {
            ...prev,
            title: body.title != null ? String(body.title).slice(0, 240) : prev.title,
            status: body.status != null ? String(body.status) : prev.status,
            priority: body.priority != null ? String(body.priority) : prev.priority,
            notes: body.notes != null ? String(body.notes).slice(0, 4000) : prev.notes,
            updated_at: new Date().toISOString(),
          };
          state.activity = [{
            id: uid('act'),
            type: 'task_updated',
            text: state.tasks[idx].title,
            at: state.tasks[idx].updated_at,
          }, ...(state.activity || [])].slice(0, 200);
          return state.tasks[idx];
        }, actor.identityId, { abortError: 'task not found' });
        if (!patched.ok) {
          json(res, patched.conflict ? 409 : (patched.error === 'task not found' ? 404 : 503), { ok: false, ...patched });
          return true;
        }
        json(res, 200, { ok: true, task: patched.result, state: patched.state, updated_at: patched.updated_at });
        return true;
      }

      json(res, 404, { ok: false, error: 'Not found' });
      return true;
    } catch (err) {
      const code = err?.code;
      const status = code === 'BAD_INPUT' ? 400
        : code === 'NOT_FOUND' ? 404
          : code === 'FORBIDDEN' || /session/i.test(String(err?.message || '')) ? 401
            : 500;
      json(res, status, { ok: false, error: err?.message || String(err) });
      return true;
    }
  };
}

module.exports = {
  mountNexenRoutes,
  hubSummary,
};
