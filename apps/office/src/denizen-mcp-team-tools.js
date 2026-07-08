'use strict';

/**
 * Team orchestration MCP tools — roster, handoffs, enriched status.
 */

const npcRoster = require('./npc-roster');
const mcpActions = require('./denizen-mcp-actions');

let _deps = {};

const TEAM_TOOL_DEFINITIONS = [
  {
    name: 'list_team',
    description: 'List teammates in your org with claimed assistant NPC and online presence.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_handoff',
    description: 'Send a message/handoff to a teammate, or escalate to the CEO office (Lucy bridge).',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Handoff message (required)' },
        to_session_id: { type: 'string', description: 'Target teammate session UUID' },
        to_display_name: { type: 'string', description: 'Target by display name (partial match)' },
        to_ceo: { type: 'boolean', description: 'Escalate to CEO / Lucy bridge' },
        to_npc: { type: 'string', description: 'Optional target NPC key for routing metadata' },
      },
      required: ['message'],
    },
  },
  {
    name: 'list_pending_handoffs',
    description: 'Pending assistant handoffs addressed to your session.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
];

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function displayNameForKey(npcKey) {
  const hit = (npcRoster.entries || []).find((e) => e.folder === npcKey);
  return hit?.display || npcKey;
}

function requireSession(scope) {
  if (!scope?.session_id) {
    return {
      ok: false,
      error: 'MCP token has no session_id — re-create token from Connect AI while logged in',
    };
  }
  return null;
}

async function toolListTeam(scope) {
  const err = requireSession(scope);
  if (err) return err;
  const visitor = _deps.denizenVisitor;
  if (!visitor?.listTeammatesWithPresence) {
    return { ok: false, error: 'visitor module not configured' };
  }
  const online = typeof _deps.listOnlineSessionIds === 'function'
    ? _deps.listOnlineSessionIds()
    : null;
  const teammates = await visitor.listTeammatesWithPresence(scope.session_id, online);
  return {
    ok: true,
    org_slug: scope.org_slug,
    your_npc_key: scope.npc_key,
    teammates,
    count: teammates.length,
  };
}

async function toolSendHandoff(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const message = String(args?.message || '').trim().slice(0, 4000);
  if (!message) return { ok: false, error: 'message required' };

  const visitor = _deps.denizenVisitor;
  const connections = _deps.visitorConnections;
  if (!visitor?.sendHandoff || !visitor?.resolveHandoffTarget) {
    return { ok: false, error: 'handoff not configured' };
  }

  const toCeo = args?.to_ceo === true;
  const toSessionId = args?.to_session_id || args?.toSessionId || null;
  const toDisplayName = args?.to_display_name || args?.toDisplayName || null;

  if (!toCeo && !toSessionId && !toDisplayName) {
    return {
      ok: false,
      error: 'Specify to_session_id, to_display_name, or to_ceo: true',
    };
  }

  let target;
  try {
    target = await visitor.resolveHandoffTarget({
      toSessionId,
      toCeo,
      toDisplayName,
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  if (!target.is_ceo_bridge && connections?.assertCanMessage) {
    try {
      await connections.assertCanMessage({
        fromSessionId: scope.session_id,
        toSessionId: target.session_id,
      });
    } catch (e) {
      return { ok: false, error: e?.message || String(e), code: e?.code || 'CONNECTION_REQUIRED' };
    }
  }

  const fromNpc = scope.npc_key || 'assistant';
  const handoff = await visitor.sendHandoff({
    fromSessionId: scope.session_id,
    toSessionId: target.session_id,
    fromNpc,
    toNpc: args?.to_npc || args?.toNpc || (target.is_ceo_bridge ? 'lucy' : 'assistant'),
    message,
    metadata: { source: 'mcp', member_id: scope.member_id || null },
  });

  if (target.is_ceo_bridge && typeof _deps.notifyCeoHandoff === 'function' && handoff) {
    const enriched = {
      ...handoff,
      from_display_name: displayNameForKey(fromNpc),
      message,
    };
    _deps.notifyCeoHandoff(enriched);
  }

  return {
    ok: true,
    handoff_id: handoff?.id || null,
    target,
    from_npc: fromNpc,
  };
}

async function toolListPendingHandoffs(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const visitor = _deps.denizenVisitor;
  if (!visitor?.getPendingHandoffs) {
    return { ok: false, error: 'handoff inbox not configured' };
  }
  const handoffs = await visitor.getPendingHandoffs(scope.session_id);
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 20));
  return {
    ok: true,
    handoffs: (handoffs || []).slice(0, limit),
    count: (handoffs || []).length,
  };
}

async function buildStatusExtras(scope, { work = [] } = {}) {
  const display = displayNameForKey(scope.npc_key);
  const brains = _deps.npcBrains;
  const directive = brains?.getDirective?.(display) || null;
  const commitments = brains?.getOpenCommitments?.(display) || [];
  const skills = mcpActions.listSkillsForNpc(scope.npc_key);

  const skillWork = (work || []).filter((row) => {
    const phase = String(row?.phase || '').toLowerCase();
    const action = String(row?.action || '').toLowerCase();
    return phase.includes('skill') || action.includes('skill') || phase === 'mcp';
  }).slice(0, 10);

  let inference = null;
  if (typeof _deps.getInferenceHealth === 'function') {
    try {
      inference = await _deps.getInferenceHealth();
    } catch (_) {
      inference = { reachable: false };
    }
  }

  let pending_handoffs = [];
  if (scope.session_id && _deps.denizenVisitor?.getPendingHandoffs) {
    try {
      pending_handoffs = await _deps.denizenVisitor.getPendingHandoffs(scope.session_id);
    } catch (_) {
      pending_handoffs = [];
    }
  }

  return {
    display_name: display,
    skills,
    directive_inbox: directive,
    open_commitments: commitments,
    recent_skill_work: skillWork,
    inference,
    pending_handoffs_count: pending_handoffs.length,
    pending_handoffs: pending_handoffs.slice(0, 5),
    session_linked: Boolean(scope.session_id),
  };
}

function toolsForNpc() {
  return [...TEAM_TOOL_DEFINITIONS];
}

function isTeamTool(name) {
  return TEAM_TOOL_DEFINITIONS.some((t) => t.name === name);
}

async function callTool(scope, name, args) {
  switch (name) {
    case 'list_team': return toolListTeam(scope, args);
    case 'send_handoff': return toolSendHandoff(scope, args);
    case 'list_pending_handoffs': return toolListPendingHandoffs(scope, args);
    default: return { ok: false, error: `unknown team tool: ${name}` };
  }
}

module.exports = {
  configure,
  TEAM_TOOL_DEFINITIONS,
  toolsForNpc,
  isTeamTool,
  callTool,
  buildStatusExtras,
};
