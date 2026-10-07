'use strict';

/**
 * Resolve the human behind an MCP token (ChatGPT / Cursor / Claude).
 *
 * Token resolve only returns org_id + session_id (+ optional member_id).
 * CRM / Studio Board / Business Studio tools need identity_id + role so
 * member sessions stay in "own" scope and do not bleed teammate data.
 */

const crmAccess = require('./denizen-crm-access');

let _deps = {};

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function isOrgWideRole(role) {
  return crmAccess.isOrgWideRole(role);
}

/**
 * Enrich a raw MCP token scope with caller identity fields.
 * Safe to call repeatedly — returns a new object; never mutates input.
 */
async function enrichMcpScope(scope = {}) {
  if (!scope || typeof scope !== 'object') return scope;
  // Already enriched this request
  if (scope._mcp_actor_enriched) return scope;

  const out = { ...scope, _mcp_actor_enriched: true };
  let displayName = out.display_name || out.user || null;
  let identityId = out.identity_id || out.identityId || null;
  let email = out.email || null;
  let role = out.role || null;
  let memberId = out.member_id || out.memberId || null;
  let accountId = out.account_id || null;

  const visitor = _deps.denizenVisitor;
  const sessionId = out.session_id || null;

  if (sessionId && visitor?.getSession) {
    try {
      const session = await visitor.getSession(sessionId);
      displayName = session?.display_name || displayName;
      identityId = session?.identity_id || identityId;
      if (!email && session?.metadata?.email) email = session.metadata.email;
      if (!role && session?.metadata?.role) role = session.metadata.role;
    } catch (_) { /* optional */ }
  }

  const teamAuth = _deps.teamAuth || (() => {
    try { return require('./denizen-team-auth'); } catch (_) { return null; }
  })();

  if (sessionId && teamAuth?.getTeamAccountForSession) {
    try {
      const account = await teamAuth.getTeamAccountForSession(sessionId);
      if (account) {
        memberId = memberId || account.id || null;
        accountId = account.id || accountId;
        email = account.email || email;
        displayName = account.display_name || displayName;
        role = account.role || role;
      }
    } catch (_) { /* optional */ }
  }

  const isTeamOperator = out.scope_mode === 'team' || out.npc_key === '_team';
  let orgWide = false;
  if (!sessionId && !identityId && !memberId) {
    orgWide = true;
  } else if (isTeamOperator && !sessionId) {
    orgWide = true;
    role = role || 'admin';
  }
  if (!role) role = (sessionId || identityId) ? 'member' : null;

  out.identity_id = identityId || null;
  out.identityId = identityId || null;
  out.member_id = memberId || null;
  out.account_id = accountId || null;
  out.display_name = displayName || null;
  out.user = displayName || email || out.npc_key || 'mcp';
  out.email = email || null;
  out.role = role || null;
  out.org_wide = orgWide;
  out.data_scope = orgWide ? 'org' : 'own';

  return out;
}

/** Actor shape consumed by CRM / Studio Board access helpers. */
function actorFromMcpScope(scope = {}) {
  return {
    user: scope.user || scope.display_name || scope.npc_key || 'mcp',
    displayName: scope.display_name || scope.user || null,
    email: scope.email || null,
    role: scope.role || 'member',
    identityId: scope.identity_id || scope.identityId || null,
    accountId: scope.account_id || scope.member_id || null,
    npc_key: scope.npc_key || null,
    source: 'mcp',
  };
}

function isOrgWideScope(scope = {}) {
  if (scope.identity_id || scope.identityId || scope.session_id) return false;
  if (scope.org_wide === true || scope.data_scope === 'org') return true;
  return isOrgWideRole(scope.role);
}

module.exports = {
  configure,
  enrichMcpScope,
  actorFromMcpScope,
  isOrgWideScope,
  isOrgWideRole,
};
