'use strict';

const { URL } = require('node:url');
const crmStore = require('./denizen-crm-store');
const crmSpine = require('./denizen-crm-spine');
const crmAssist = require('./denizen-crm-assist');
const { intakeQualifiedHandoff } = require('./denizen-crm-handoffs');
const { sendCrmEmail } = require('./denizen-crm-email');
const mailPolicy = require('./denizen-mail-policy');
const { enrollContact } = require('./denizen-crm-sequences');
const crmPortal = require('./denizen-crm-portal');
const { submitPublicIntake } = require('./denizen-crm-intake-public');
const { handleResendWebhook } = require('./denizen-crm-resend-webhook');
const crmStripe = require('./denizen-crm-stripe');
const crmCalendar = require('./denizen-crm-calendar');
const { inviteTeamMember } = require('./denizen-crm-team-invite');
const crmSetupWizard = require('./denizen-crm-setup-wizard');
const crmSam = require('./denizen-crm-sam');
const samGov = require('./denizen-sam-gov');
const denizenDb = require('./denizen-db');
const denizenVisitor = require('./denizen-visitor');
const sessionAuth = require('./visitor-session-auth');
const visitorAccess = require('./visitor-access');
const sessionCookie = require('./visitor-session-cookie');
const teamAuth = require('./denizen-team-auth');
const crmAccess = require('./denizen-crm-access');
const agencyBridge = require('./denizen-agency-bridge');

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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readRawBody(req, limitBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function crmPublicBase() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

function isDemoAccess(access) {
  return !!access?.isDemo
    || String(access?.tier || '').toLowerCase() === 'demo'
    || String(access?.orgSlug || '').toLowerCase() === 'acme';
}

function isLegacyCeoLabel(name) {
  return /^dolonia$/i.test(String(name || '').trim());
}

function isGuestLabel(name) {
  return /^guest$/i.test(String(name || '').trim());
}

function isDemoPlaceholderName(name) {
  const n = String(name || '').trim();
  return !n || isLegacyCeoLabel(n) || isGuestLabel(n);
}

function isCeoAccess(access, principal) {
  if (isDemoAccess(access)) return false;
  const meta = access.session?.metadata && typeof access.session.metadata === 'object'
    ? access.session.metadata
    : {};
  return !!principal?.ceo
    || String(access.tier || meta.tier || '').toLowerCase() === 'ceo'
    || meta.is_ceo_principal === true
    || meta.access_method === 'ceo';
}

function resolveCrmVisitorProfile(access, identityRow, sessionDisplayName, { principal } = {}) {
  const isDemo = isDemoAccess(access);
  const isCeo = isCeoAccess(access, principal);
  const username = identityRow?.username || null;
  const sessionName = String(sessionDisplayName || '').trim();

  if (isCeo) {
    let displayName = sessionName;
    if (!displayName || isGuestLabel(displayName)) {
      const idName = String(identityRow?.display_name || '').trim();
      displayName = idName && !isGuestLabel(idName) ? idName : 'Dolonia';
    }
    return { displayName: displayName || 'Dolonia', username, isDemo: false, isCeo: true };
  }

  if (isDemo) {
    let displayName = isDemoPlaceholderName(sessionName) ? null : sessionName;
    const idRaw = String(identityRow?.display_name || '').trim();
    if (!displayName && idRaw && !isDemoPlaceholderName(idRaw)) displayName = idRaw;
    if (!displayName) displayName = username || null;
    if (!displayName) {
      const meta = access.session?.metadata && typeof access.session.metadata === 'object'
        ? access.session.metadata
        : {};
      const email = identityRow?.email || meta.email || null;
      if (email && String(email).includes('@')) displayName = String(email).split('@')[0];
    }
    return {
      displayName: displayName || username || 'Demo user',
      username,
      isDemo: true,
      isCeo: false,
    };
  }

  let displayName = sessionName || identityRow?.display_name || username || null;
  if (isGuestLabel(displayName) || isLegacyCeoLabel(displayName)) {
    displayName = identityRow?.display_name || username || null;
  }
  if (isGuestLabel(displayName)) displayName = username || null;
  return {
    displayName: displayName || username || 'Team member',
    username,
    isDemo: false,
    isCeo: false,
  };
}

async function verifyCrmSession(req, sessionId, body, verifyVisitorSession) {
  try {
    return await verifyVisitorSession(req, sessionId, body);
  } catch (err) {
    if (err?.code !== 'DENIED') throw err;
    let access = null;
    try {
      access = await visitorAccess.resolveSessionAccess(sessionId);
    } catch (_) { /* fall through */ }
    if (access && isDemoAccess(access)) return access;
    const grant = String(req.headers['x-denizen-ceo-grant'] || '').trim();
    if (!grant || !sessionAuth.verifyCeoGrant(grant)) throw err;
    return access || visitorAccess.resolveSessionAccess(sessionId);
  }
}

function resolveOrgId(access) {
  let orgId = access.orgId || access.session?.org_id;
  if (!orgId && access.session?.metadata?.is_ceo_principal && denizenDb.orgId) {
    orgId = denizenDb.orgId;
  }
  return orgId;
}

async function resolveOrgIdAsync(access) {
  let orgId = resolveOrgId(access);
  if (!orgId && access.orgSlug) {
    const resolved = await denizenVisitor.resolveOrgBySlug(access.orgSlug);
    orgId = resolved?.id || null;
  }
  return orgId;
}

async function resolveUpdatedByLabel(identityId) {
  if (!identityId || !denizenDb.enabled) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=display_name,email&id=eq.${encodeURIComponent(identityId)}&limit=1`,
  ).catch(() => []);
  const row = rows?.[0];
  return row?.display_name || row?.email || null;
}

/**
 * Resolve actor for CRM audit (Angela, Zion, teammates).
 */
async function resolveCrmActor(access, sessionId) {
  const identityId = access?.session?.identity_id || null;
  let displayName = access?.session?.display_name || null;
  let email = null;
  let role = null;
  let accountId = null;

  if (identityId && denizenDb.enabled) {
    const rows = await denizenDb._get(
      `denizen_user_identities?select=display_name,email&id=eq.${encodeURIComponent(identityId)}&limit=1`,
    ).catch(() => []);
    if (rows?.[0]) {
      displayName = rows[0].display_name || displayName;
      email = rows[0].email || null;
    }
  }

  try {
    const account = await teamAuth.getTeamAccountForSession(sessionId);
    if (account) {
      email = account.email || email;
      displayName = account.display_name || displayName;
      role = account.role || null;
      accountId = account.id || null;
    }
  } catch (_) { /* optional */ }

  if (!role && access) {
    try {
      const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
        isCeoPrincipal: !!access.session?.metadata?.is_ceo_principal,
      });
      role = approval.role || role;
    } catch (_) { /* optional */ }
  }

  return {
    user: displayName || email || 'Team member',
    displayName: displayName || null,
    email: email || null,
    role: role || null,
    identityId,
    accountId,
    source: 'workspace_save',
  };
}

async function resolveCrmAccessScope(access, sessionId) {
  const actor = await resolveCrmActor(access, sessionId);
  const isDemo = isDemoAccess(access);
  let role = actor.role || null;
  if (!role && sessionId) {
    try {
      const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
        isCeoPrincipal: !!access.session?.metadata?.is_ceo_principal,
      });
      role = approval.role || role;
    } catch (_) { /* optional */ }
  }
  if (isDemo) {
    // Demo sandbox stays org-wide so the sample dataset remains usable.
    return { actor: { ...actor, role: role || 'demo' }, orgWide: true, scope: 'org' };
  }
  const principal = await teamAuth.resolveCeoPrincipalForSession(sessionId, { access }).catch(() => null);
  if (principal?.ceo || isCeoAccess(access, principal)) {
    return { actor: { ...actor, role: role || 'owner' }, orgWide: true, scope: 'org' };
  }
  const orgWide = crmAccess.isOrgWideRole(role);
  return {
    actor: { ...actor, role: role || 'member' },
    orgWide,
    scope: orgWide ? 'org' : 'own',
  };
}

async function loadWorkspacePayload(orgId, access, pullSpine = true, { sessionId = null, applyMemberScope = true } = {}) {
  const row = await crmStore.getWorkspace(orgId);
  let state = row?.state || {};
  if (pullSpine) {
    state = await crmSpine.enrichWorkspaceFromSpine(orgId, state);
  }
  const updatedByName = await resolveUpdatedByLabel(row?.updated_by);
  let scope = 'org';
  let filtered = false;
  let actor = null;
  if (applyMemberScope && sessionId) {
    const accessScope = await resolveCrmAccessScope(access, sessionId);
    actor = accessScope.actor;
    const scoped = crmAccess.filterWorkspaceForAccess(state, accessScope.actor, {
      orgWide: accessScope.orgWide,
    });
    state = scoped.state;
    scope = scoped.scope;
    filtered = !!scoped.filtered;
  }
  return {
    org_id: orgId,
    org_slug: access.orgSlug || null,
    org_display_name: access.org?.display_name || null,
    schema_version: crmStore.SCHEMA_VERSION,
    state,
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
    updated_by_name: updatedByName,
    empty: !crmStore.hasWorkspaceData(state),
    crm_scope: scope,
    scoped: filtered,
    actor: actor ? {
      user: actor.user,
      email: actor.email || null,
      role: actor.role || null,
      identity_id: actor.identityId || null,
    } : null,
  };
}

function crmPathname(url) {
  const raw = String(url.pathname || '');
  const normalized = raw.replace(/\/+$/, '') || '/';
  return normalized;
}

function mountCrmRoutes({ verifyVisitorSession, readJsonBody, npcBrains, broadcastToOffice }) {
  return async function handleCrmRoutes(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = crmPathname(url);
    if (!path.startsWith('/api/crm/')) return false;

    if (path === '/api/crm/health' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'denizen-crm',
        routes: [
          'GET /api/crm/health',
          'GET /api/crm/session',
          'GET|PUT /api/crm/workspace',
          'GET /api/crm/workspace/stream',
          'GET /api/crm/audit',
          'GET /api/crm/my-day',
          'POST /api/crm/govcon-enable',
          'GET /api/crm/email-inbound/status',
          'POST /api/crm/email-inbound/poll',
          'POST /api/crm/email-inbound',
          'POST /api/crm/assist',
          'POST /api/crm/assist/execute',
          'POST /api/crm/event',
          'POST /api/crm/send-email',
          'POST /api/crm/sequence/enroll',
          'POST /api/crm/intake',
          'POST /api/crm/intake-handoff',
          'GET /api/crm/team',
          'GET /api/crm/team/activity',
          'POST /api/crm/team/invite',
          'POST /api/crm/setup-wizard',
          'GET /api/crm/sam/search',
          'POST /api/crm/sam/ingest',
          'GET /api/crm/deals/:dealId/studio-tasks',
          'POST /api/crm/deals/:dealId/studio-tasks',
          'POST /api/crm/deals/:dealId/studio-tasks/link',
          'POST /api/crm/deals/:dealId/studio-tasks/unlink',
          'POST /api/crm/deals/:dealId/studio-tasks/:taskId/advance',
        ],
      });
      return true;
    }

    // Personal My Day feed (Angela's notes, tasks, emails, agent captures)
    if (path === '/api/crm/my-day' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        const row = await crmStore.getWorkspace(orgId);
        const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') || 168)));
        const crmCapture = require('./denizen-crm-capture');
        const myDay = crmCapture.buildMyDay(row?.state || {}, {
          email: actor.email,
          user: actor.user,
          displayName: actor.user,
          hours,
        });
        json(res, 200, { ok: true, org_id: orgId, actor, ...myDay });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    // Recent per-user CRM audit (who changed what)
    if (path === '/api/crm/audit' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await crmStore.getWorkspace(orgId);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
        const filterUser = String(url.searchParams.get('user') || '').trim().toLowerCase();
        const accessScope = await resolveCrmAccessScope(access, sessionId);
        let audit = Array.isArray(row?.state?.auditLog) ? row.state.auditLog : [];
        if (!accessScope.orgWide) {
          const aliases = crmAccess.buildActorAliases(accessScope.actor);
          audit = audit.filter((e) => crmAccess.matchesAlias(e.user, aliases)
            || crmAccess.matchesAlias(e.email, aliases)
            || crmAccess.matchesAlias(e.identityId, aliases));
        }
        if (filterUser) {
          audit = audit.filter((e) => {
            const blob = `${e.user || ''} ${e.email || ''}`.toLowerCase();
            return blob.includes(filterUser);
          });
        }
        json(res, 200, {
          ok: true,
          org_id: orgId,
          industry: row?.state?.industryConfig?.id || null,
          count: audit.length,
          entries: audit.slice(0, limit),
          crm_scope: accessScope.scope,
        });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    // Gmail → CRM: status / poll / manual inject (Angela → Zion inbox)
    if (path === '/api/crm/email-inbound/status' && req.method === 'GET') {
      try {
        const inbound = require('./denizen-crm-email-inbound');
        json(res, 200, inbound.getInboundStatus());
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/email-inbound/poll' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 32 * 1024).catch(() => ({}));
        const sessionId = sessionIdFrom(req, body, url);
        // Allow service secret for automation, or logged-in CRM session
        const secret = String(req.headers['x-denizen-secret'] || body.secret || '').trim();
        const expected = String(process.env.DENIZEN_EMAIL_SECRET || process.env.DENIZEN_BRIDGE_SECRET || '').trim();
        let allowed = false;
        if (expected && secret && secret === expected) allowed = true;
        if (!allowed && sessionId) {
          try {
            await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
            allowed = true;
          } catch (_) { /* not session */ }
        }
        if (!allowed && !expected) {
          // dev: allow when no secret configured and session present fails → still require session in prod
          if (!sessionId) {
            json(res, 401, { ok: false, error: 'Login or X-Denizen-Secret required' });
            return true;
          }
        }
        if (!allowed && expected && !secret) {
          json(res, 401, { ok: false, error: 'Login or X-Denizen-Secret required' });
          return true;
        }
        const inbound = require('./denizen-crm-email-inbound');
        const result = await inbound.pollGmailInbound({
          orgId: body.org_id || body.orgId || null,
          orgSlug: body.org_slug || body.orgSlug || null,
          broadcast: broadcastToOffice || null,
        });
        json(res, result.ok ? 200 : 502, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/email-inbound' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 512 * 1024);
        const secret = String(req.headers['x-denizen-secret'] || body.secret || '').trim();
        const expected = String(process.env.DENIZEN_EMAIL_SECRET || process.env.DENIZEN_BRIDGE_SECRET || '').trim();
        if (expected && secret !== expected) {
          // also allow CRM session
          const sessionId = sessionIdFrom(req, body, url);
          if (sessionId) {
            try {
              await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
            } catch (_) {
              json(res, 401, { ok: false, error: 'invalid secret or session' });
              return true;
            }
          } else {
            json(res, 401, { ok: false, error: 'invalid secret' });
            return true;
          }
        }
        const inbound = require('./denizen-crm-email-inbound');
        const msg = {
          id: body.gmailId || body.id || `manual_${Date.now()}`,
          threadId: body.threadId || null,
          from: body.from || body.fromEmail || '',
          to: body.to || body.toEmail || '',
          subject: body.subject || '(no subject)',
          bodyText: body.body || body.bodyText || body.text || '',
          snippet: body.snippet || '',
          internalDate: body.internalDate || Date.now(),
          messageId: body.messageId || null,
          date: body.date || null,
        };
        const result = await inbound.ingestInboundEmail(msg, {
          orgId: body.org_id || body.orgId || null,
          orgSlug: body.org_slug || body.orgSlug || null,
          force: true,
          source: body.source || 'api_inject',
          fromEmail: body.fromEmail || null,
          fromName: body.fromName || null,
        });
        if (result.ok && !result.skipped && typeof broadcastToOffice === 'function') {
          broadcastToOffice(result.orgId, {
            type: 'crm_event',
            kind: 'email-inbound',
            npcName: 'Lucy',
            title: result.subject,
            from: result.contactName,
            at: new Date().toISOString(),
          });
        }
        json(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    // Switch org CRM to Government Contracting capture mode (Angela / 1921)
    if (path === '/api/crm/govcon-enable' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 32 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        // members+ can enable for their org; owners/admins preferred for team invite later
        const existing = await crmStore.getWorkspace(orgId);
        const { applyGovconPreset } = require('./denizen-crm-audit-diff');
        const next = applyGovconPreset(existing?.state || {}, {
          user: actor.user,
          email: actor.email,
          role: actor.role,
          source: 'govcon_enable_api',
        });
        const saved = await crmStore.upsertWorkspace(
          orgId,
          next,
          access.session?.identity_id || null,
          { actor, skipAudit: true }, // preset already audited
        );
        json(res, 200, {
          ok: true,
          org_id: orgId,
          industry: 'govcon',
          message: 'CRM switched to Government Contracting capture mode (NAICS, vehicles, set-asides, PoP, solicitations).',
          updated_at: saved?.updated_at || null,
          actor: { user: actor.user, email: actor.email, role: actor.role },
        });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/session' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        if (!sessionId) {
          json(res, 200, { ok: false, reason: 'no_session' });
          return true;
        }
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        const isDemo = isDemoAccess(access);
        const principal = isDemo
          ? { ceo: false, tier: 'demo', source: null }
          : (
            await teamAuth.maybeUpgradeSessionCeoPrincipal(sessionId, access.session)
            || await teamAuth.resolveCeoPrincipalForSession(sessionId, { access })
          );
        const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
          isCeoPrincipal: !isDemo && !!principal?.ceo,
        });
        let email = null;
        let identityId = access.session?.identity_id || null;
        let workPosition = null;
        let identityRow = null;
        try {
          const userIdentity = require('./denizen-user-identity.js');
          if (identityId && denizenDb.enabled) {
            const idRows = await denizenDb._get(
              `denizen_user_identities?select=display_name,email,metadata,username&id=eq.${encodeURIComponent(identityId)}&limit=1`,
            ).catch(() => []);
            identityRow = idRows?.[0] || null;
          } else if (sessionId) {
            identityRow = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
            identityId = identityRow?.id || identityId;
          }
          email = identityRow?.email || access.session?.metadata?.email || null;
          try {
            const userPosition = require('./denizen-user-position.js');
            workPosition = userPosition.toClientPosition(
              userPosition.getPositionFromIdentity(identityRow),
            );
          } catch (_) { /* optional */ }
        } catch (_) { /* optional identity */ }
        const profile = resolveCrmVisitorProfile(access, identityRow, access.session?.display_name, { principal });
        const isCeo = profile.isCeo;
        if (
          isDemo
          && profile.displayName
          && !isDemoPlaceholderName(profile.displayName)
          && isDemoPlaceholderName(access.session?.display_name)
          && denizenDb.enabled
        ) {
          const meta = access.session?.metadata && typeof access.session.metadata === 'object'
            ? { ...access.session.metadata }
            : {};
          delete meta.is_ceo_principal;
          meta.tier = 'demo';
          meta.access_method = meta.access_method || 'demo';
          await denizenVisitor.createOrUpdateSession({
            sessionId,
            displayName: profile.displayName,
            metadata: meta,
          }).catch(() => {});
        } else if (
          isCeo
          && profile.displayName
          && (isGuestLabel(access.session?.display_name) || !access.session?.display_name)
          && denizenDb.enabled
        ) {
          const meta = access.session?.metadata && typeof access.session.metadata === 'object'
            ? { ...access.session.metadata }
            : {};
          meta.is_ceo_principal = true;
          meta.tier = 'ceo';
          meta.access_method = 'ceo';
          await denizenVisitor.createOrUpdateSession({
            sessionId,
            displayName: profile.displayName,
            metadata: meta,
          }).catch(() => {});
        }
        const teamRole = isDemo ? null : (approval.role === 'ceo' ? 'owner' : (approval.role || null));
        const crmScope = isDemo || isCeo || crmAccess.isOrgWideRole(teamRole) ? 'org' : 'own';
        json(res, 200, {
          ok: true,
          session_id: sessionId,
          org_slug: access.orgSlug || null,
          org_display_name: access.org?.display_name || null,
          org_id: orgId,
          display_name: profile.displayName,
          username: profile.username,
          email,
          identity_id: identityId,
          ceo: isCeo,
          is_owner: isCeo || (!isDemo && approval.role === 'owner'),
          team_role: teamRole,
          crm_scope: crmScope,
          can_approve_skills: !!approval.allowed,
          tier: isDemo ? 'demo' : (isCeo ? 'ceo' : (principal?.tier || access.tier || null)),
          work_position: workPosition,
        });
        return true;
      } catch (err) {
        json(res, 200, { ok: false, reason: 'invalid', error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/workspace/stream' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        let lastTs = url.searchParams.get('since') || '';
        const send = async () => {
          if (res.writableEnded) return;
          const row = await crmStore.getWorkspace(orgId);
          const ts = row?.updated_at || '';
          if (ts && ts !== lastTs) {
            lastTs = ts;
            const updatedByName = await resolveUpdatedByLabel(row?.updated_by);
            res.write(`data: ${JSON.stringify({ updated_at: ts, updated_by_name: updatedByName })}\n\n`);
          } else {
            res.write(': ping\n\n');
          }
        };
        await send();
        const timer = setInterval(send, 5000);
        req.on('close', () => clearInterval(timer));
        return true;
      } catch (err) {
        if (!res.writableEnded) json(res, 401, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/setup-wizard' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const result = await crmSetupWizard.runSetupWizard(orgId, {
          mode: body.mode || (body.stepId || body.step ? 'run_step' : 'run_all'),
          stepId: body.stepId || body.step || null,
          identityId: access.session?.identity_id || null,
          orgSlug: access.orgSlug || body.orgSlug || null,
          profile: body.profile || null,
          industryId: body.industryId || body.templateId || body.industry || null,
          contact: body.contact || null,
          deal: body.deal || null,
          seedPackages: body.seedPackages !== false,
        });
        json(res, 200, { ok: true, ...result });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/assist' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id, X-Session-Token, X-Denizen-Ceo-Grant, X-Access-Method, X-Org-Slug',
        });
        res.end();
        return true;
      }
      try {
        const body = await readJsonBody(req, 512 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await crmStore.getWorkspace(orgId);
        const serverState = row?.state || {};
        const clientState = body.state && typeof body.state === 'object'
          ? crmStore.sanitizeState(body.state)
          : null;
        const state = clientState
          ? crmAssist.mergeWorkspaceStates(serverState, clientState)
          : serverState;
        const result = await crmAssist.crmAssist(npcBrains, body.message || body.prompt, state, {
          npcKey: body.npc_key || body.npcKey || null,
          npcName: body.npc_name || body.npcName || null,
        });
        json(res, 200, { ok: true, ...result });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    // Confirm chip → execute agent-writes / capture
    if (path === '/api/crm/assist/execute' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id, X-Session-Token, X-Denizen-Ceo-Grant, X-Access-Method, X-Org-Slug',
        });
        res.end();
        return true;
      }
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const orgSlug = String(
          body.org_slug
          || body.orgSlug
          || access.session?.org_slug
          || access.org?.slug
          || process.env.DENIZEN_ORG_SLUG
          || 'zion',
        ).trim();
        const action = body.action && typeof body.action === 'object'
          ? body.action
          : { type: body.type, label: body.label, payload: body.payload };
        const result = await crmAssist.executeAssistAction({
          orgSlug,
          orgId,
          action,
          npcName: body.npc_name || body.npcName || body.npc_key || body.npcKey || 'Lucy',
          identityId: access.session?.identity_id || null,
        });
        json(res, result.ok ? 200 : 400, { ok: !!result.ok, ...result });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/event' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        const kind = String(body.kind || body.event || '').trim();
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
        const officeId = access.session?.identity_id || orgId;

        if (typeof broadcastToOffice === 'function' && officeId) {
          if (kind === 'deal-won') {
            broadcastToOffice(officeId, {
              type: 'crm_event',
              kind: 'deal-won',
              title: payload.title || 'Deal won',
              value: payload.value,
              contact: payload.contact,
              dealId: payload.dealId,
              org_id: orgId,
              at: new Date().toISOString(),
            });
          }
          if (kind === 'task-overdue') {
            broadcastToOffice(officeId, {
              type: 'crm_event',
              kind: 'task-overdue',
              title: payload.title || 'Task overdue',
              due: payload.due,
              contact: payload.contact,
              at: new Date().toISOString(),
            });
          }
        }

        json(res, 200, { ok: true, kind, broadcast: !!officeId });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/send-email' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 512 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await crmStore.getWorkspace(orgId);
        const senderName = await resolveUpdatedByLabel(access.session?.identity_id) || 'You';
        const state = row?.state || {};
        let toEmail = String(body.toEmail || body.to_email || '').trim();
        if (!toEmail && (body.contactId ?? body.contact_id)) {
          const cid = body.contactId ?? body.contact_id;
          const contact = (state.contacts || []).find((c) => String(c.id) === String(cid));
          toEmail = String(contact?.email || '').trim();
        }
        const subject = String(body.subject || '').trim();
        const mailBody = String(body.body || '').trim();
        const gate = mailPolicy.assertSendAllowed({
          npcKey: body.npc_key || body.npcKey || 'visitor',
          to: toEmail,
          subject,
          body: mailBody,
          confirmToken: body.confirm_token || body.confirmToken || null,
        });
        if (!gate.ok) {
          json(res, gate.needs_confirm ? 202 : 403, {
            ok: false,
            ...gate,
            error: gate.error || 'mail policy blocked send',
          });
          return true;
        }
        const sendResult = await sendCrmEmail(state, {
          contactId: body.contactId ?? body.contact_id,
          dealId: body.dealId ?? body.deal_id,
          toEmail,
          subject: body.subject,
          body: body.body,
          templateId: body.templateId ?? body.template_id,
          templateName: body.templateName || body.template_name,
          senderName,
          forceMailto: !!body.force_mailto,
          attachments: body.attachments,
        });
        if (!sendResult.ok) {
          json(res, 400, { ok: false, error: sendResult.error || 'Send failed' });
          return true;
        }
        const identityId = access.session?.identity_id || null;
        await crmStore.upsertWorkspace(orgId, sendResult.state, identityId, {
          ifUpdatedAt: row?.updated_at || null,
        });
        json(res, 200, {
          ok: true,
          mode: sendResult.mode,
          mailto: sendResult.mailto || null,
          logEntry: sendResult.logEntry,
          subject: sendResult.subject,
          policy: gate.policy,
        });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/sequence/enroll' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 128 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await crmStore.getWorkspace(orgId);
        const enrollResult = enrollContact(
          row?.state || {},
          body.sequenceId ?? body.sequence_id,
          body.contactId ?? body.contact_id,
        );
        if (!enrollResult.ok) {
          json(res, 400, { ok: false, error: enrollResult.error });
          return true;
        }
        const identityId = access.session?.identity_id || null;
        await crmStore.upsertWorkspace(orgId, enrollResult.state, identityId, {
          ifUpdatedAt: row?.updated_at || null,
        });
        json(res, 200, { ok: true, enrollment: enrollResult.enrollment });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const quoteGetMatch = path.match(/^\/api\/crm\/quote\/([^/]+)$/);
    if (quoteGetMatch && req.method === 'GET') {
      try {
        const token = decodeURIComponent(quoteGetMatch[1]);
        const result = await crmPortal.getPublicQuote(token);
        if (!result.ok) {
          json(res, 404, { ok: false, error: result.error || 'not_found' });
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const quoteSignMatch = path.match(/^\/api\/crm\/quote\/([^/]+)\/sign$/);
    if (quoteSignMatch && req.method === 'POST') {
      try {
        const token = decodeURIComponent(quoteSignMatch[1]);
        const body = await readJsonBody(req, 256 * 1024);
        const result = await crmPortal.signQuote(token, body);
        if (!result.ok) {
          json(res, 400, { ok: false, error: result.error });
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const quoteEventMatch = path.match(/^\/api\/crm\/quote\/([^/]+)\/event$/);
    if (quoteEventMatch && req.method === 'POST') {
      try {
        const token = decodeURIComponent(quoteEventMatch[1]);
        const body = await readJsonBody(req, 32 * 1024);
        const result = await crmPortal.recordPortalEvent(token, body.event || body.type, body.detail);
        if (!result.ok) {
          const status = result.error === 'rate_limited' ? 429 : 400;
          json(res, status, result);
          return true;
        }
        json(res, 200, { ok: true });
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/intake' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const clientKey = String(
          req.headers['cf-connecting-ip']
          || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket?.remoteAddress
          || '',
        ).replace(/^::ffff:/, '');
        const result = await submitPublicIntake(body, { clientKey });
        if (!result.ok) {
          json(res, result.status || 400, { ok: false, error: result.error });
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/resend-webhook' && req.method === 'POST') {
      try {
        const rawBody = await readRawBody(req, 256 * 1024);
        const body = JSON.parse(rawBody || '{}');
        const result = await handleResendWebhook(body, { rawBody, headers: req.headers });
        const status = result.error === 'invalid_signature' ? 401 : 200;
        json(res, status, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/stripe-webhook' && req.method === 'POST') {
      try {
        const rawBody = await readRawBody(req, 512 * 1024);
        const sig = req.headers['stripe-signature'] || '';
        const result = await crmStripe.handleStripeWebhook(rawBody, sig);
        const status = result.error === 'invalid_signature' ? 400 : 200;
        json(res, status, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const quoteCheckoutMatch = path.match(/^\/api\/crm\/quote\/([^/]+)\/checkout$/);
    if (quoteCheckoutMatch && req.method === 'POST') {
      try {
        const token = decodeURIComponent(quoteCheckoutMatch[1]);
        const result = await crmStripe.createPortalCheckout(token);
        if (!result.ok) {
          json(res, 400, result);
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        json(res, 500, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/stripe/status' && req.method === 'GET') {
      json(res, 200, { ok: true, configured: crmStripe.stripeConfigured() });
      return true;
    }

    if (path === '/api/crm/calendar/status' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const row = await crmStore.getWorkspace(orgId);
        const identityId = access.session?.identity_id || 'default';
        json(res, 200, { ok: true, ...crmCalendar.calendarStatus(row?.state || {}, identityId) });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/calendar/google/connect' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const identityId = access.session?.identity_id || 'default';
        const result = crmCalendar.buildGoogleAuthUrl(orgId, identityId);
        if (!result.ok) {
          json(res, 503, result);
          return true;
        }
        redirect(res, result.url);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/calendar/google/callback' && req.method === 'GET') {
      try {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=google&error=missing_code`);
          return true;
        }
        await crmCalendar.handleGoogleCallback(code, state);
        redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=google&connected=1`);
        return true;
      } catch (err) {
        redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=google&error=${encodeURIComponent(err?.message || 'oauth_failed')}`);
        return true;
      }
    }

    if (path === '/api/crm/calendar/microsoft/connect' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const identityId = access.session?.identity_id || 'default';
        const result = crmCalendar.buildMicrosoftAuthUrl(orgId, identityId);
        if (!result.ok) {
          json(res, 503, result);
          return true;
        }
        redirect(res, result.url);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/calendar/microsoft/callback' && req.method === 'GET') {
      try {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=microsoft&error=missing_code`);
          return true;
        }
        await crmCalendar.handleMicrosoftCallback(code, state);
        redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=microsoft&connected=1`);
        return true;
      } catch (err) {
        redirect(res, `${crmPublicBase()}/crm/#schedule?calendar=microsoft&error=${encodeURIComponent(err?.message || 'oauth_failed')}`);
        return true;
      }
    }

    if (path === '/api/crm/calendar/sync' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 32 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const identityId = access.session?.identity_id || 'default';
        const provider = String(body.provider || 'google').toLowerCase();
        const result = await crmCalendar.syncCalendar(orgId, identityId, provider);
        if (!result.ok) {
          json(res, 400, result);
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/team/invite' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 32 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const principal = await teamAuth.resolveCeoPrincipalForSession(sessionId, { access });
        const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
          isCeoPrincipal: !!principal?.ceo,
        });
        if (!approval.allowed) {
          json(res, 403, { ok: false, error: 'Only team owners and admins can invite members' });
          return true;
        }
        const result = await inviteTeamMember(
          orgId,
          access.orgSlug || null,
          {
            email: body.email,
            displayName: body.displayName || body.display_name,
            platform: body.platform,
          },
          access.session?.display_name || 'Team',
        );
        if (!result.ok) {
          json(res, 400, result);
          return true;
        }
        json(res, 200, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/team/activity' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const accessScope = await resolveCrmAccessScope(access, sessionId);
        const row = await crmStore.getWorkspace(orgId);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
        const accounts = await denizenDb._get(
          `denizen_team_accounts?select=display_name,email,role&org_id=eq.${encodeURIComponent(orgId)}&order=display_name`,
        ).catch(() => []);
        const teamMembers = (accounts || [])
          .map((a) => a.display_name)
          .filter(Boolean);
        const activity = crmAccess.buildTeamActivity(row?.state || {}, { limit, teamMembers });

        // Members still get the team viewer feed (who is doing what) without
        // receiving other people's CRM record payloads.
        json(res, 200, {
          ok: true,
          org_id: orgId,
          crm_scope: accessScope.scope,
          viewer_role: accessScope.actor?.role || null,
          ...activity,
        });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/team' && req.method === 'GET') {
      try {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const isDemoTeam = isDemoAccess(access);
        const teamPrincipal = isDemoTeam
          ? { ceo: false }
          : await teamAuth.resolveCeoPrincipalForSession(sessionId, { access });
        const accounts = await denizenDb._get(
          `denizen_team_accounts?select=display_name,email,role&org_id=eq.${encodeURIComponent(orgId)}&order=display_name`,
        ).catch(() => []);
        const identities = await denizenDb._get(
          `denizen_user_identities?select=display_name,email,tier&org_id=eq.${encodeURIComponent(orgId)}&order=display_name`,
        ).catch(() => []);
        let selfEmail = null;
        let identityRow = null;
        let identityId = access.session?.identity_id || null;
        try {
          const userIdentity = require('./denizen-user-identity.js');
          if (identityId) {
            const idRows = await denizenDb._get(
              `denizen_user_identities?select=email,display_name,username&id=eq.${encodeURIComponent(identityId)}&limit=1`,
            ).catch(() => []);
            identityRow = idRows?.[0] || null;
          } else if (sessionId) {
            identityRow = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
          }
          selfEmail = identityRow?.email || access.session?.metadata?.email || null;
        } catch (_) { /* optional */ }
        const selfName = resolveCrmVisitorProfile(
          access,
          identityRow,
          access.session?.display_name,
          { principal: teamPrincipal },
        ).displayName;
        const memberMap = new Map();
        for (const row of accounts || []) {
          if (!row?.email) continue;
          memberMap.set(String(row.email).toLowerCase(), {
            display_name: row.display_name,
            email: row.email,
            role: row.role || 'member',
          });
        }
        for (const row of identities || []) {
          if (!row?.email) continue;
          const key = String(row.email).toLowerCase();
          if (memberMap.has(key)) continue;
          memberMap.set(key, {
            display_name: row.display_name,
            email: row.email,
            role: row.tier === 'ceo' ? 'owner' : (row.tier === 'team' ? 'member' : (row.tier || 'member')),
          });
        }
        const members = [...memberMap.values()]
          .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)))
          .map((m) => ({
            ...m,
            is_self: !!(
              (selfEmail && String(m.email).toLowerCase() === String(selfEmail).toLowerCase())
              || (selfName && m.display_name === selfName)
            ),
          }));
        json(res, 200, { ok: true, members, self: { display_name: selfName, email: selfEmail } });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (path === '/api/crm/intake-handoff' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const submission = body.submission || body;
        const row = await crmStore.getWorkspace(orgId);
        const handoff = intakeQualifiedHandoff(row?.state || {}, submission);
        if (!handoff.changed) {
          json(res, 200, { ok: true, changed: false });
          return true;
        }
        const identityId = access.session?.identity_id || null;
        await crmStore.upsertWorkspace(orgId, handoff.state, identityId, {
          ifUpdatedAt: row?.updated_at || null,
        });
        json(res, 200, { ok: true, changed: true });
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    // SAM.gov federal opportunities. Both routes require a verified CRM session
    // (same gate as /api/crm/workspace): `search` amplifies each call into up to
    // ~21 upstream SAM requests on the shared key, and `ingest` WRITES to the DB
    // — neither may be anonymous on a public host. The nightly auto-ingest calls
    // the ingest logic directly (not this route), so it is unaffected.
    if (path === '/api/crm/sam/search' && req.method === 'GET') {
      try {
        const sessionId = sessionIdFrom(req, {}, url);
        const access = await verifyCrmSession(req, sessionId, {}, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) { json(res, 409, { ok: false, error: 'Session is not linked to an organization' }); return true; }
        if (!samGov.hasKey()) {
          json(res, 200, { ok: false, configured: false, error: 'SAM_GOV_API_KEY is not set' });
          return true;
        }
        const q = url.searchParams;
        const result = await samGov.searchOpportunities({
          naics: q.get('naics') != null ? q.get('naics') : undefined,
          setAside: q.get('setAside') != null ? q.get('setAside') : undefined,
          ptype: q.get('ptype') != null ? q.get('ptype') : undefined,
          days: q.get('days') != null ? Number(q.get('days')) : undefined,
          q: q.get('q') || undefined,
          limit: q.get('limit') != null ? Number(q.get('limit')) : undefined,
          offset: q.get('offset') != null ? Number(q.get('offset')) : undefined,
          activeOnly: q.get('activeOnly') === '0' ? false : undefined,   // default true
        });
        json(res, 200, { ok: true, configured: true, ...result });
        return true;
      } catch (err) {
        const authFail = err?.code === 'DENIED' || err?.code === 'BAD_INPUT';   // no/invalid session
        const status = authFail ? 401
          : (err?.code === 'NO_SAM_KEY' ? 409 : 502);
        json(res, status, { ok: false, error: err?.message || String(err), code: err?.code });
        return true;
      }
    }

    if (path === '/api/crm/sam/ingest' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        // Required session — never fall back to the default org for an anonymous
        // caller. verifyCrmSession throws DENIED (→ 401) without a valid session,
        // demo session, or CEO grant header.
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) { json(res, 409, { ok: false, error: 'Session is not linked to an organization' }); return true; }
        const result = await crmSam.ingestOpportunities({
          orgId,
          naics: body.naics,
          setAside: body.setAside,
          ptype: body.ptype,
          days: body.days != null ? Number(body.days) : undefined,
          q: body.q,
          limit: body.limit != null ? Number(body.limit) : undefined,
          activeOnly: body.activeOnly === false ? false : undefined,   // default true
          mirrorToDeals: body.mirrorToDeals !== false,                 // default true
        });
        json(res, result.ok ? 200 : (result.code === 'NO_SAM_KEY' ? 409 : 500), result);
        return true;
      } catch (err) {
        const authFail = err?.code === 'DENIED' || err?.code === 'BAD_INPUT';   // no/invalid session
        const status = authFail ? 401 : (err?.code === 'SAM_AUTH' ? 502 : 500);
        json(res, status, { ok: false, error: err?.message || String(err), code: err?.code });
        return true;
      }
    }

    if (path === '/api/crm/workspace') {
    try {
      if (req.method === 'GET') {
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured' });
          return true;
        }
        const pullSpine = url.searchParams.get('pull_spine') !== '0';
        const payload = await loadWorkspacePayload(orgId, access, pullSpine, {
          sessionId,
          applyMemberScope: true,
        });
        json(res, 200, { ok: true, ...payload });
        return true;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req, 4 * 1024 * 1024);
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        if (!denizenDb.enabled) {
          json(res, 503, { ok: false, error: 'Database not configured' });
          return true;
        }
        const accessScope = await resolveCrmAccessScope(access, sessionId);
        const identityId = access.session?.identity_id || null;
        const ifUpdatedAt = body.if_updated_at || body.ifUpdatedAt || null;
        const actor = accessScope.actor;
        let state = crmStore.sanitizeState(body.state || body);
        if (!accessScope.orgWide) {
          const existing = await crmStore.getWorkspace(orgId);
          state = crmStore.sanitizeState(
            crmAccess.mergeMemberWorkspace(existing?.state || {}, state, actor),
          );
        }

        const saved = await crmStore.upsertWorkspace(orgId, state, identityId, {
          ifUpdatedAt,
          actor,
          actorName: actor.user,
        });

        if (saved?.conflict) {
          const conflictScoped = crmAccess.filterWorkspaceForAccess(saved.state || {}, actor, {
            orgWide: accessScope.orgWide,
          });
          json(res, 409, {
            ok: false,
            error: 'Workspace was updated by a teammate — reloading latest copy',
            code: 'CONFLICT',
            org_id: orgId,
            org_slug: access.orgSlug || null,
            org_display_name: access.org?.display_name || null,
            state: conflictScoped.state,
            updated_at: saved.updated_at,
            schema_version: saved.schema_version,
            crm_scope: conflictScoped.scope,
          });
          return true;
        }

        const updatedByName = actor.user
          || (await resolveUpdatedByLabel(saved?.updated_by || identityId));
        json(res, 200, {
          ok: true,
          org_id: orgId,
          org_slug: access.orgSlug || null,
          org_display_name: access.org?.display_name || null,
          schema_version: saved?.schema_version || crmStore.SCHEMA_VERSION,
          updated_at: saved?.updated_at || new Date().toISOString(),
          updated_by_name: updatedByName,
          updated_by_email: actor.email || null,
          updated_by_role: actor.role || null,
          crm_scope: accessScope.scope,
        });
        return true;
      }

      json(res, 405, { ok: false, error: 'Method not allowed' });
      return true;
    } catch (err) {
      const status = err?.code === 'DENIED' || err?.code === 'BAD_INPUT' ? 401
        : err?.code === 'NOT_FOUND' ? 404
          : 500;
      json(res, status, { ok: false, error: err?.message || String(err), code: err?.code || null });
      return true;
    }
    return true;
    }

    // ── CRM ↔ Studio Board agency routes (shared bridge with MCP) ──
    const dealStudioListMatch = path.match(/^\/api\/crm\/deals\/([^/]+)\/studio-tasks$/);
    if (dealStudioListMatch && req.method === 'GET') {
      try {
        const dealId = decodeURIComponent(dealStudioListMatch[1]);
        const body = {};
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const result = await agencyBridge.listTasksForDeal(orgId, dealId);
        json(res, result.ok ? 200 : 404, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    if (dealStudioListMatch && req.method === 'POST') {
      try {
        const dealId = decodeURIComponent(dealStudioListMatch[1]);
        const body = await readJsonBody(req, 64 * 1024).catch(() => ({}));
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        const result = await agencyBridge.createDeliveryFromDeal(orgId, {
          dealId,
          title: body.title || null,
          assignee: body.assignee || null,
          status: body.status || null,
          due: body.due || null,
          notes: body.notes || null,
          markWon: !!body.mark_won || !!body.markWon,
          identityId: actor.identityId || access.session?.identity_id || null,
          actor: {
            npc_key: 'crm',
            displayName: actor.user,
            user: actor.user,
            identityId: actor.identityId || null,
          },
        });
        json(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const dealStudioLinkMatch = path.match(/^\/api\/crm\/deals\/([^/]+)\/studio-tasks\/link$/);
    if (dealStudioLinkMatch && req.method === 'POST') {
      try {
        const dealId = decodeURIComponent(dealStudioLinkMatch[1]);
        const body = await readJsonBody(req, 32 * 1024).catch(() => ({}));
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        const taskId = String(body.studio_task_id || body.studioTaskId || body.task_id || '').trim();
        const result = await agencyBridge.linkDealTask(orgId, {
          dealId,
          taskId,
          contactId: body.contact_id ?? body.contactId ?? null,
          identityId: actor.identityId || access.session?.identity_id || null,
          actor: {
            npc_key: 'crm',
            displayName: actor.user,
            user: actor.user,
            identityId: actor.identityId || null,
          },
        });
        json(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const dealStudioUnlinkMatch = path.match(/^\/api\/crm\/deals\/([^/]+)\/studio-tasks\/unlink$/);
    if (dealStudioUnlinkMatch && req.method === 'POST') {
      try {
        const dealId = decodeURIComponent(dealStudioUnlinkMatch[1]);
        const body = await readJsonBody(req, 32 * 1024).catch(() => ({}));
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        const taskId = String(body.studio_task_id || body.studioTaskId || body.task_id || '').trim();
        const result = await agencyBridge.unlinkDealTask(orgId, {
          dealId,
          taskId,
          identityId: actor.identityId || access.session?.identity_id || null,
        });
        json(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    const dealStudioAdvanceMatch = path.match(/^\/api\/crm\/deals\/([^/]+)\/studio-tasks\/([^/]+)\/advance$/);
    if (dealStudioAdvanceMatch && req.method === 'POST') {
      try {
        const dealId = decodeURIComponent(dealStudioAdvanceMatch[1]);
        const taskId = decodeURIComponent(dealStudioAdvanceMatch[2]);
        const body = await readJsonBody(req, 32 * 1024).catch(() => ({}));
        const sessionId = sessionIdFrom(req, body, url);
        const access = await verifyCrmSession(req, sessionId, body, verifyVisitorSession);
        const orgId = await resolveOrgIdAsync(access);
        if (!orgId) {
          json(res, 409, { ok: false, error: 'Session is not linked to an organization' });
          return true;
        }
        const actor = await resolveCrmActor(access, sessionId);
        const result = await agencyBridge.advanceDealTask(orgId, {
          dealId,
          taskId,
          status: body.status || null,
          identityId: actor.identityId || access.session?.identity_id || null,
          actor: {
            npc_key: 'crm',
            displayName: actor.user,
            user: actor.user,
            identityId: actor.identityId || null,
          },
        });
        json(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        const status = err?.code === 'DENIED' ? 401 : 500;
        json(res, status, { ok: false, error: err?.message || String(err) });
        return true;
      }
    }

    json(res, 404, {
      ok: false,
      error: 'CRM route not found',
      path,
      method: req.method,
      hint: 'Restart Denizen after updating denizen-crm-routes.js, or open CRM at http://HOST:8080/crm/ (not the Vite dev port without API proxy).',
    });
    return true;
  };
}

module.exports = {
  mountCrmRoutes,
  // Exported for unit tests
  resolveCrmAccessScope,
  loadWorkspacePayload,
};
