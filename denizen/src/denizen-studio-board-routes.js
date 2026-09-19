'use strict';

const { URL } = require('node:url');
const boardStore = require('./denizen-studio-board-store');
const boardMutations = require('./denizen-studio-board-mutations');
const boardPresence = require('./denizen-studio-board-presence');
const boardAcl = require('./denizen-studio-board-acl');
const boardActivity = require('./denizen-studio-board-activity');
const boardAutomations = require('./denizen-studio-board-automations');
const boardRoster = require('./denizen-studio-board-roster');
const workspaceAccess = require('./denizen-workspace-access');
const denizenDb = require('./denizen-db');
const sessionCookie = require('./visitor-session-cookie');
const visitorAccess = require('./visitor-access');
const teamAuth = require('./denizen-team-auth');

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

/** Never fall back to denizenDb.orgId for browser sessions. */
async function resolveOrgId(access) {
  return access?.orgId
    || access?.session?.org_id
    || null;
}

async function actorFromAccess(access, sessionId) {
  let role = null;
  try {
    const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
      isCeoPrincipal: !!access?.session?.metadata?.is_ceo_principal,
    });
    role = approval.role || null;
  } catch (_) { /* optional */ }
  return {
    identityId: access?.session?.identity_id || null,
    identity_id: access?.session?.identity_id || null,
    email: access?.session?.email || access?.user?.email || null,
    displayName: access?.session?.display_name || access?.user?.display_name || null,
    user: access?.session?.display_name || access?.user?.display_name || null,
    role: role || 'member',
    enforceAcl: true,
  };
}

async function prepareBoardState(orgId, access, sessionId, requestedScope) {
  let row = await boardStore.getWorkspace(orgId);
  let state = row?.state || boardStore.emptyState();
  if (state.config) {
    boardStore.migrateConfig(state.config);
    boardAcl.seedOwnerIfEmpty(state.config, await actorFromAccess(access, sessionId));
  }
  boardAutomations.sweepDuePassed(state, 'Automation');

  const synced = await boardRoster.syncOrgRoster(state, orgId);
  state = synced.state;
  if (synced.changed) {
    const identityId = access.session?.identity_id || null;
    const saved = await boardStore.upsertWorkspace(orgId, state, identityId, {
      ifUpdatedAt: row?.updated_at || null,
    });
    if (!saved?.conflict) {
      row = saved || row;
      state = saved?.state || state;
    }
  }

  const actor = await actorFromAccess(access, sessionId);
  // Mine matches assignee against actor aliases. Tasks store assignee as person id
  // (p_xxx), so include the roster person's id/email/identity or Mine looks empty.
  try {
    const hint = actor.email || actor.identityId || actor.identity_id || actor.displayName || actor.user;
    const person = hint ? boardMutations.findPerson(state, hint) : null;
    if (person) {
      const extra = [person.id, person.name, person.email, person.identityId, person.identity_id]
        .filter(Boolean)
        .map(String);
      actor.aliases = [...new Set([...(actor.aliases || []), ...extra])];
    }
  } catch (_) { /* non-fatal */ }
  const scope = workspaceAccess.parseScope(requestedScope || 'own', {
    role: actor.role,
    defaultScope: 'own',
  });
  const filtered = boardMutations.filterStateForScope(state, actor, scope);
  return {
    row,
    fullState: state,
    state: filtered.state,
    scope: filtered.scope,
    actor,
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
        const requestedScope = url.searchParams.get('scope') || url.searchParams.get('access_scope') || 'own';
        const prepared = await prepareBoardState(orgId, access, sessionId, requestedScope);
        json(res, 200, {
          ok: true,
          org_id: orgId,
          org_slug: access.orgSlug || null,
          schema_version: prepared.row?.schema_version || boardStore.SCHEMA_VERSION,
          updated_at: prepared.row?.updated_at || null,
          updated_by: prepared.row?.updated_by || null,
          state: prepared.state,
          access_scope: prepared.scope,
          can_org_scope: workspaceAccess.isOrgWideRole(prepared.actor.role),
          activity: boardActivity.listActivity(prepared.state),
          is_admin: boardAcl.isAdmin(prepared.fullState.config, prepared.actor),
          is_owner: boardAcl.isOwner(prepared.fullState.config, prepared.actor),
          presence: boardPresence.list(orgId),
          working_set: boardMutations.buildWorkingSet(prepared.fullState, prepared.actor, prepared.scope),
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
        const actor = await actorFromAccess(access, sessionId);
        const requestedScope = body.scope || body.access_scope || 'own';
        const scope = workspaceAccess.parseScope(requestedScope, { role: actor.role, defaultScope: 'own' });
        let incoming = boardStore.sanitizeState(body.state || body);
        // Stamp new/unowned tasks from this save as private to actor
        incoming.tasks = (incoming.tasks || []).map((t) => {
          if (!t || typeof t !== 'object') return t;
          if (!workspaceAccess.recordHasOwnerStamp(t)) {
            return boardMutations.stampBoardRecord(t, actor);
          }
          return t;
        });
        incoming.events = (incoming.events || []).map((e) => {
          if (!e || typeof e !== 'object') return e;
          if (!workspaceAccess.recordHasOwnerStamp(e)) {
            return boardMutations.stampBoardRecord(e, actor);
          }
          return e;
        });

        const existing = await boardStore.getWorkspace(orgId);
        let state = incoming;
        if (scope !== 'org') {
          // Merge: keep others' private rows
          const full = existing?.state || boardStore.emptyState();
          const keepTasks = (full.tasks || []).filter((t) => {
            const mine = workspaceAccess.recordVisibleMine(
              t,
              workspaceAccess.buildActorAliases(actor, { fuzzyName: true }),
              ['ownerIdentityId', 'ownerId', 'createdBy', 'assignee'],
            );
            return !mine;
          });
          const keepEvents = (full.events || []).filter((e) => {
            const mine = workspaceAccess.recordVisibleMine(
              e,
              workspaceAccess.buildActorAliases(actor, { fuzzyName: true }),
              ['ownerIdentityId', 'ownerId', 'createdBy'],
            );
            return !mine;
          });
          const keepNotes = (full.notes || []).filter((n) => {
            const mine = workspaceAccess.recordVisibleMine(
              n,
              workspaceAccess.buildActorAliases(actor, { fuzzyName: true }),
              ['ownerIdentityId', 'from', 'createdBy'],
            );
            return !mine;
          });
          state = {
            ...full,
            ...incoming,
            people: incoming.people?.length ? incoming.people : full.people,
            config: incoming.config || full.config,
            tasks: [...keepTasks, ...(incoming.tasks || [])],
            events: [...keepEvents, ...(incoming.events || [])],
            notes: [...keepNotes, ...(incoming.notes || [])],
            activity: full.activity || [],
          };
          // Deduplicate by id preferring incoming
          const dedupe = (list) => {
            const map = new Map();
            for (const row of list || []) {
              if (row?.id == null) continue;
              map.set(String(row.id), row);
            }
            return [...map.values()];
          };
          state.tasks = dedupe(state.tasks);
          state.events = dedupe(state.events);
          state.notes = dedupe(state.notes);
        }

        const identityId = access.session?.identity_id || null;
        boardAcl.seedOwnerIfEmpty(state.config || (state.config = {}), actor);
        const ifUpdatedAt = body.if_updated_at || body.ifUpdatedAt || null;
        const saved = await boardStore.upsertWorkspace(orgId, state, identityId, { ifUpdatedAt });
        if (saved?.conflict) {
          json(res, 409, {
            ok: false,
            error: 'Board was updated by a teammate — reloading latest copy',
            code: 'CONFLICT',
            org_id: orgId,
            state: boardMutations.filterStateForScope(saved.state, actor, scope).state,
            updated_at: saved.updated_at,
            schema_version: saved.schema_version,
            activity: boardActivity.listActivity(saved.state),
            access_scope: scope,
          });
          return true;
        }
        json(res, 200, {
          ok: true,
          org_id: orgId,
          schema_version: saved?.schema_version || boardStore.SCHEMA_VERSION,
          updated_at: saved?.updated_at || new Date().toISOString(),
          access_scope: scope,
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
          await actorFromAccess(access, sessionId),
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
        const requestedScope = url.searchParams.get('scope') || 'own';
        const prepared = await prepareBoardState(orgId, access, sessionId, requestedScope);
        json(res, 200, {
          ok: true,
          access_scope: prepared.scope,
          ...boardMutations.buildWorkingSet(prepared.fullState, prepared.actor, prepared.scope),
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
