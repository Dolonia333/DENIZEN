'use strict';

const { URL } = require('node:url');
const studioStore = require('./denizen-business-studio-store');
const e3 = require('./denizen-business-studio-e3-template');
const progress = require('./denizen-business-studio-progress');
const funding = require('./denizen-business-studio-funding');
const founderPack = require('./denizen-business-studio-founder-pack');
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
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function verifyStudioSession(req, sessionId, body, verifyVisitorSession) {
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

function findAdvisor(state, access) {
  const email = String(access?.session?.email || access?.user?.email || '').toLowerCase();
  if (!email) return null;
  return (state.advisors || []).find((a) => String(a.email || '').toLowerCase() === email) || null;
}

function viewerState(state, access) {
  const advisor = findAdvisor(state, access);
  const role = String(advisor?.role || '').toLowerCase();
  if (role === 'investor' || role === 'viewer') {
    return { state: studioStore.filterStateForInvestor(state, advisor), advisor, role };
  }
  if (role === 'mentor' || role === 'advisor') {
    return { state: studioStore.filterStateForAdvisor(state, advisor), advisor, role };
  }
  return { state, advisor, role: role || 'member' };
}

function isAdvisorRole(role) {
  const r = String(role || '').toLowerCase();
  return r === 'mentor' || r === 'advisor' || r === 'investor' || r === 'viewer';
}

function isFounderCapable(access, advisor) {
  if (advisor && isAdvisorRole(advisor.role)) return false;
  // Members / owners / admins without an advisor role can mutate founder workspace.
  return true;
}

async function loadOrgState(orgId) {
  if (!orgId || !denizenDb.enabled) {
    return { state: studioStore.emptyState(), updated_at: null, mode: 'local' };
  }
  const row = await studioStore.getWorkspace(orgId);
  return {
    state: row?.state || studioStore.emptyState(),
    updated_at: row?.updated_at || null,
    mode: 'cloud',
  };
}

async function persistOrgState(orgId, state, identityId) {
  if (!orgId || !denizenDb.enabled) {
    const err = new Error('Database not configured — use local storage');
    err.code = 'UNAVAILABLE';
    throw err;
  }
  return studioStore.upsertWorkspace(orgId, state, identityId);
}

function mountBusinessStudioRoutes({ verifyVisitorSession, readJsonBody } = {}) {
  return async function handleBusinessStudioRoutes(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (!path.startsWith('/api/business-studio')) {
      return false;
    }

    try {
      if (path === '/api/business-studio/health' && req.method === 'GET') {
        json(res, 200, {
          ok: true,
          service: 'denizen-business-studio',
          routes: [
            'GET /api/business-studio/health',
            'GET|PUT /api/business-studio/workspace',
            'GET /api/business-studio/templates',
            'POST /api/business-studio/programs/apply-template',
            'POST /api/business-studio/apply-founder-pack',
            'GET /api/business-studio/progress',
            'GET /api/business-studio/explain',
            'POST /api/business-studio/advisors',
            'POST /api/business-studio/recommendations',
            'POST /api/business-studio/recommendations/respond',
            'POST /api/business-studio/comments',
            'GET /api/business-studio/funding',
            'PUT /api/business-studio/funding',
          ],
        });
        return true;
      }

      if (path === '/api/business-studio/templates' && req.method === 'GET') {
        json(res, 200, { ok: true, templates: e3.listProgramTemplates() });
        return true;
      }

      if (path === '/api/business-studio/workspace' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
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
            state: studioStore.emptyState(),
            updated_at: null,
            schema_version: studioStore.SCHEMA_VERSION,
          });
          return true;
        }
        const row = await studioStore.getWorkspace(orgId);
        let state = row?.state || studioStore.emptyState();
        const viewed = viewerState(state, access);
        state = viewed.state;
        json(res, 200, {
          ok: true,
          mode: 'cloud',
          org_id: orgId,
          state,
          updated_at: row?.updated_at || null,
          schema_version: row?.schema_version || studioStore.SCHEMA_VERSION,
          viewer: {
            role: viewed.role || 'member',
            email: actorFromAccess(access).email,
            displayName: actorFromAccess(access).displayName,
          },
        });
        return true;
      }

      if (path === '/api/business-studio/workspace' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured — use local storage' });
          return true;
        }
        const existing = await studioStore.getWorkspace(orgId);
        const existingState = existing?.state || studioStore.emptyState();
        const maybeAdvisor = findAdvisor(existingState, access);
        if (isAdvisorRole(maybeAdvisor?.role)) {
          json(res, 403, { ok: false, error: 'Advisors cannot overwrite the founder workspace' });
          return true;
        }
        const actor = actorFromAccess(access);
        const result = await studioStore.upsertWorkspace(orgId, body.state, actor.identityId, {
          ifUpdatedAt: body.ifUpdatedAt || body.if_updated_at || null,
        });
        if (result?.conflict) {
          json(res, 409, { ok: false, conflict: true, ...result });
          return true;
        }
        json(res, 200, { ok: true, ...result });
        return true;
      }

      if (path === '/api/business-studio/programs/apply-template' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        const loaded = await loadOrgState(orgId);
        const maybeAdvisor = findAdvisor(loaded.state, access);
        if (!isFounderCapable(access, maybeAdvisor)) {
          json(res, 403, { ok: false, error: 'Advisors cannot apply program templates' });
          return true;
        }
        const templateId = String(body.templateId || body.template_id || 'i2e-e3-pave').trim();
        const bundle = e3.applyProgramTemplate(templateId, {
          businessName: body.businessName || body.business_name,
          founderName: body.founderName || body.founder_name || actorFromAccess(access).displayName,
          cohort: body.cohort,
          advisor: body.advisor,
          startDate: body.startDate || body.start_date,
          endDate: body.endDate || body.end_date,
        });

        if (orgId && denizenDb.enabled && body.persist) {
          const state = loaded.state;
          state.business = state.business || {
            id: `biz_${Date.now().toString(36)}`,
            name: body.businessName || 'My Business',
            founderName: body.founderName || actorFromAccess(access).displayName || 'Founder',
          };
          state.programs = [...(state.programs || []).filter((p) => p.templateId !== templateId), bundle.program];
          state.milestones = [...(state.milestones || []), ...bundle.milestones];
          state.tasks = [...(state.tasks || []), ...bundle.tasks];
          state.assumptions = [...(state.assumptions || []), ...bundle.assumptions];
          state.experiments = [...(state.experiments || []), ...bundle.experiments];
          state.goals = [...(state.goals || []), ...bundle.goals];
          state.metrics = [...(state.metrics || []), ...bundle.metrics];
          if (!(state.strategyNodes || []).length) {
            state.strategyNodes = bundle.strategyNodes;
            state.strategyEdges = bundle.strategyEdges;
          }
          state.activity = [
            {
              id: uid('act'),
              type: 'program_template_applied',
              message: `Applied program template ${bundle.templateName}`,
              at: new Date().toISOString(),
            },
            ...(state.activity || []),
          ].slice(0, 200);
          const saved = await persistOrgState(orgId, state, actorFromAccess(access).identityId);
          json(res, 200, { ok: true, bundle, workspace: saved });
          return true;
        }

        json(res, 200, { ok: true, bundle });
        return true;
      }

      if (path === '/api/business-studio/apply-founder-pack' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        const loaded = await loadOrgState(orgId);
        const maybeAdvisor = findAdvisor(loaded.state, access);
        if (!isFounderCapable(access, maybeAdvisor)) {
          json(res, 403, { ok: false, error: 'Advisors cannot apply the founder pack' });
          return true;
        }
        let result;
        try {
          result = founderPack.applyFounderPack(loaded.state, {
            businessName: body.businessName || body.business_name,
            founderName: body.founderName || body.founder_name,
            fillLeanCanvas: body.fillLeanCanvas !== false && body.fill_lean_canvas !== false,
            fillPave: body.fillPave !== false && body.fill_pave !== false,
            fillMoat: body.fillMoat !== false && body.fill_moat !== false,
            fillEvidence: body.fillEvidence !== false && body.fill_evidence !== false,
          });
        } catch (err) {
          json(res, 400, { ok: false, error: err?.message || String(err) });
          return true;
        }
        if (orgId && denizenDb.enabled && body.persist !== false) {
          const saved = await persistOrgState(orgId, result.state, actorFromAccess(access).identityId);
          json(res, 200, {
            ok: true,
            business: result.business,
            program_id: result.programId,
            lean_canvas_boxes: result.leanFilled,
            pave_fields: result.paveFilled,
            workspace: saved,
          });
          return true;
        }
        json(res, 200, {
          ok: true,
          mode: 'local',
          business: result.business,
          program_id: result.programId,
          lean_canvas_boxes: result.leanFilled,
          pave_fields: result.paveFilled,
          state: result.state,
        });
        return true;
      }

      if (path === '/api/business-studio/progress' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        const loaded = await loadOrgState(orgId);
        const viewed = viewerState(loaded.state, access);
        json(res, 200, {
          ok: true,
          health: progress.businessHealth(viewed.state),
          viewer_role: viewed.role,
        });
        return true;
      }

      if (path === '/api/business-studio/explain' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        const loaded = await loadOrgState(orgId);
        const viewed = viewerState(loaded.state, access);
        const subject = url.searchParams.get('subject') || 'program';
        json(res, 200, {
          ok: true,
          explanation: progress.explainStatus(viewed.state, subject),
          viewer_role: viewed.role,
        });
        return true;
      }

      // Founder invites an advisor (server-side ACL seed)
      if (path === '/api/business-studio/advisors' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const loaded = await loadOrgState(orgId);
        const maybeAdvisor = findAdvisor(loaded.state, access);
        if (!isFounderCapable(access, maybeAdvisor)) {
          json(res, 403, { ok: false, error: 'Advisors cannot invite other advisors' });
          return true;
        }
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        const role = String(body.role || 'mentor').trim().toLowerCase() || 'mentor';
        if (!email || !name) {
          json(res, 400, { ok: false, error: 'name and email required' });
          return true;
        }
        const state = loaded.state;
        const existing = (state.advisors || []).find((a) => String(a.email || '').toLowerCase() === email);
        if (existing) {
          existing.name = name;
          existing.role = role;
          if (body.share && typeof body.share === 'object') {
            existing.share = { ...existing.share, ...body.share };
          }
        } else {
          state.advisors = [
            {
              id: uid('adv'),
              name,
              email,
              role,
              share: {
                ...(state.config?.mentorShareDefaults || {}),
                ...(body.share && typeof body.share === 'object' ? body.share : {}),
              },
              invitedAt: new Date().toISOString(),
            },
            ...(state.advisors || []),
          ];
        }
        state.activity = [
          { id: uid('act'), type: 'advisor_invited', message: `Invited ${name} as ${role}`, at: new Date().toISOString() },
          ...(state.activity || []),
        ].slice(0, 200);
        const saved = await persistOrgState(orgId, state, actorFromAccess(access).identityId);
        json(res, 200, { ok: true, advisors: saved.state.advisors, updated_at: saved.updated_at });
        return true;
      }

      // Mentor/advisor adds a recommendation (does NOT create a founder task)
      if (path === '/api/business-studio/recommendations' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const loaded = await loadOrgState(orgId);
        const actor = actorFromAccess(access);
        const advisor = findAdvisor(loaded.state, access);
        const title = String(body.title || '').trim();
        const recBody = String(body.body || body.text || '').trim();
        if (!title) {
          json(res, 400, { ok: false, error: 'title required' });
          return true;
        }
        // Founders can also draft recommendations; mentors must be invited.
        if (advisor && String(advisor.role).toLowerCase() === 'viewer') {
          json(res, 403, { ok: false, error: 'Viewers cannot leave recommendations' });
          return true;
        }
        if (!advisor && !isFounderCapable(access, advisor)) {
          json(res, 403, { ok: false, error: 'Not authorized' });
          return true;
        }
        const rec = {
          id: uid('rec'),
          title,
          body: recBody,
          advisorName: advisor?.name || actor.displayName || 'Advisor',
          advisorEmail: advisor?.email || actor.email || '',
          status: 'pending',
          toRole: 'founder',
          targetType: body.targetType || body.target_type || null,
          targetId: body.targetId || body.target_id || null,
          createdAt: new Date().toISOString(),
        };
        const state = loaded.state;
        state.recommendations = [rec, ...(state.recommendations || [])];
        state.notifications = [
          {
            id: uid('notif'),
            type: 'mentor_recommendation',
            title: `Recommendation: ${title}`,
            recommendationId: rec.id,
            at: rec.createdAt,
            read: false,
          },
          ...(state.notifications || []),
        ].slice(0, 100);
        const saved = await persistOrgState(orgId, state, actor.identityId);
        json(res, 200, { ok: true, recommendation: rec, updated_at: saved.updated_at });
        return true;
      }

      // Founder accepts / declines — only then may a task be created
      if (path === '/api/business-studio/recommendations/respond' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const loaded = await loadOrgState(orgId);
        const maybeAdvisor = findAdvisor(loaded.state, access);
        if (!isFounderCapable(access, maybeAdvisor)) {
          json(res, 403, { ok: false, error: 'Only founders can accept or decline recommendations' });
          return true;
        }
        const recId = String(body.id || body.recommendation_id || '').trim();
        const decision = String(body.decision || body.status || '').trim().toLowerCase();
        if (!recId || !['accepted', 'declined', 'accept', 'decline'].includes(decision)) {
          json(res, 400, { ok: false, error: 'id and decision (accepted|declined) required' });
          return true;
        }
        const state = loaded.state;
        const rec = (state.recommendations || []).find((r) => r.id === recId);
        if (!rec) {
          json(res, 404, { ok: false, error: 'Recommendation not found' });
          return true;
        }
        const accepted = decision === 'accepted' || decision === 'accept';
        rec.status = accepted ? 'accepted' : 'declined';
        rec.respondedAt = new Date().toISOString();
        let task = null;
        if (accepted) {
          task = {
            id: uid('task'),
            title: rec.title,
            notes: rec.body || '',
            status: 'todo',
            priority: 'medium',
            source: 'mentor_recommendation',
            recommendationId: rec.id,
            createdAt: new Date().toISOString(),
          };
          state.tasks = [task, ...(state.tasks || [])];
        }
        state.activity = [
          {
            id: uid('act'),
            type: accepted ? 'recommendation_accepted' : 'recommendation_declined',
            message: `${accepted ? 'Accepted' : 'Declined'} mentor recommendation: ${rec.title}`,
            at: new Date().toISOString(),
          },
          ...(state.activity || []),
        ].slice(0, 200);
        const saved = await persistOrgState(orgId, state, actorFromAccess(access).identityId);
        json(res, 200, {
          ok: true,
          recommendation: rec,
          task,
          updated_at: saved.updated_at,
        });
        return true;
      }

      // Mentors / founders can comment on shared objects
      if (path === '/api/business-studio/comments' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const loaded = await loadOrgState(orgId);
        const actor = actorFromAccess(access);
        const advisor = findAdvisor(loaded.state, access);
        if (advisor && String(advisor.role).toLowerCase() === 'viewer') {
          json(res, 403, { ok: false, error: 'Viewers cannot comment' });
          return true;
        }
        const text = String(body.text || body.body || '').trim();
        const targetType = String(body.targetType || body.target_type || '').trim();
        const targetId = String(body.targetId || body.target_id || '').trim();
        if (!text || !targetType || !targetId) {
          json(res, 400, { ok: false, error: 'text, targetType, and targetId required' });
          return true;
        }
        const comment = {
          id: uid('cmt'),
          text,
          targetType,
          targetId,
          authorName: advisor?.name || actor.displayName || 'Member',
          authorEmail: advisor?.email || actor.email || '',
          authorRole: advisor?.role || 'member',
          visibility: body.visibility === 'private' ? 'private' : 'shared',
          resolved: false,
          createdAt: new Date().toISOString(),
        };
        const state = loaded.state;
        state.comments = [comment, ...(state.comments || [])];
        const saved = await persistOrgState(orgId, state, actor.identityId);
        json(res, 200, { ok: true, comment, updated_at: saved.updated_at });
        return true;
      }

      if (path === '/api/business-studio/funding' && req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        const loaded = await loadOrgState(orgId);
        const viewed = viewerState(loaded.state, access);
        json(res, 200, {
          ok: true,
          readiness: funding.evaluateFundingReadiness(viewed.state),
          marketSizing: funding.calculateMarketSizing(viewed.state.funding?.marketSizing || {}),
          moat: funding.evaluateMoat(viewed.state),
          discovery: funding.discoveryPatterns(viewed.state),
          dataRoom: funding.evaluateDataRoom(viewed.state),
          capital: funding.capitalPathwayBrief(viewed.state),
          capitalPlan: viewed.state.funding?.capitalPlan || funding.emptyFundingState().capitalPlan,
          viewer_role: viewed.role,
        });
        return true;
      }

      if (path === '/api/business-studio/funding' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyStudioSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgId(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const loaded = await loadOrgState(orgId);
        const maybeAdvisor = findAdvisor(loaded.state, access);
        if (!isFounderCapable(access, maybeAdvisor)) {
          json(res, 403, { ok: false, error: 'Advisors cannot overwrite funding workspace' });
          return true;
        }
        const state = loaded.state;
        state.funding = {
          ...funding.emptyFundingState(),
          ...(state.funding || {}),
          ...(body.funding || {}),
        };
        if (body.marketSizing) {
          state.funding.marketSizing = {
            ...state.funding.marketSizing,
            ...body.marketSizing,
            calculated: funding.calculateMarketSizing({
              ...state.funding.marketSizing,
              ...body.marketSizing,
            }),
          };
        }
        if (body.moat) {
          state.funding.moat = { ...state.funding.moat, ...body.moat };
        }
        if (body.capitalPlan) {
          state.funding.capitalPlan = { ...state.funding.capitalPlan, ...body.capitalPlan };
        }
        const saved = await persistOrgState(orgId, state, actorFromAccess(access).identityId);
        json(res, 200, {
          ok: true,
          funding: saved.state.funding,
          readiness: funding.evaluateFundingReadiness(saved.state),
          updated_at: saved.updated_at,
        });
        return true;
      }

      json(res, 404, { ok: false, error: 'Business Studio route not found', path });
      return true;
    } catch (err) {
      const code = err.code || 'ERROR';
      const status = code === 'BAD_INPUT' ? 400
        : code === 'NOT_FOUND' ? 404
          : code === 'DENIED' ? 403
            : code === 'UNAVAILABLE' ? 503
              : 500;
      json(res, status, { ok: false, error: err.message || String(err), code });
      return true;
    }
  };
}

module.exports = {
  mountBusinessStudioRoutes,
  // Exported for unit tests
  isAdvisorRole,
  findAdvisor,
  isFounderCapable,
  viewerState,
};
