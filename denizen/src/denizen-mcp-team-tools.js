'use strict';

/**
 * Team orchestration MCP tools — roster, handoffs, enriched status, standup.
 */

const npcRoster = require('./npc-roster');
const mcpActions = require('./denizen-mcp-actions');
const denizenDb = require('./denizen-db.js');

let _deps = {};

/** MCP last_used within this window counts as "online via AI client". */
const MCP_ACTIVE_MS = Number(process.env.DENIZEN_MCP_PRESENCE_MS || 15 * 60 * 1000);

const TEAM_TOOL_DEFINITIONS = [
  {
    name: 'list_team',
    description:
      'List human teammates in your org with claimed assistant, WS online, and MCP/AI presence '
      + '(ChatGPT/Cursor recently active).',
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
    description:
      'Pending assistant handoffs addressed to your session. Cloud AIs (ChatGPT/Cursor) should poll this regularly.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'acknowledge_handoff',
    description: 'Mark a pending handoff as delivered/read after you acted on it (keeps the team inbox clean).',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Handoff / message id from list_pending_handoffs' },
      },
      required: ['handoff_id'],
    },
  },
  {
    name: 'team_standup',
    description:
      'One-call team sync: human presence (WS + MCP), your handoff inbox, Cursor work queue, '
      + 'office directives, CRM task snapshot. Start every collaborative session with this.',
    inputSchema: {
      type: 'object',
      properties: {
        include_crm: {
          type: 'boolean',
          description: 'Include CRM open-task snapshot (default true)',
        },
        include_cursor: {
          type: 'boolean',
          description: 'Include pending Cursor work (default true)',
        },
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

function presenceBucket(lastUsedAt) {
  if (!lastUsedAt) return null;
  const ts = Date.parse(lastUsedAt);
  if (!Number.isFinite(ts)) return null;
  const age = Date.now() - ts;
  if (age <= MCP_ACTIVE_MS) return 'active';
  if (age <= 24 * 60 * 60 * 1000) return 'recent';
  return 'stale';
}

function inferClientType(token) {
  const label = String(token?.label || '').toLowerCase();
  const meta = token?.metadata || {};
  const client = String(meta.client_type || meta.clientType || '').toLowerCase();
  if (client.includes('chatgpt') || label.includes('chatgpt')) return 'chatgpt';
  if (client.includes('cursor') || label.includes('cursor')) return 'cursor';
  if (client.includes('claude') || label.includes('claude')) return 'claude';
  if (label.includes('team')) return 'team';
  if (label) return label.slice(0, 32);
  return 'mcp';
}

async function loadOrgMcpTokens(scope) {
  if (!denizenDb.enabled || !scope?.org_id || !scope?.session_id) return [];
  try {
    const listed = await denizenDb._rpc('denizen_list_mcp_tokens', {
      p_org_id: scope.org_id,
      p_session_id: scope.session_id,
      p_org_wide: true,
    });
    if (listed?.ok && Array.isArray(listed.tokens)) return listed.tokens;
  } catch (_) {
    /* fall through */
  }
  return [];
}

function enrichTeammatesWithMcpPresence(teammates, tokens, onlineSet) {
  const bySession = new Map();
  for (const tok of tokens || []) {
    const sid = tok.session_id;
    if (!sid) continue;
    const list = bySession.get(sid) || [];
    list.push(tok);
    bySession.set(sid, list);
  }

  return (teammates || []).map((tm) => {
    const sid = tm.session_id;
    const wsOnline = !!(onlineSet && onlineSet.has(sid));
    const sessionTokens = bySession.get(sid) || [];
    let lastMcpAt = null;
    let bestAge = Infinity;
    const clients = new Set();
    for (const tok of sessionTokens) {
      clients.add(inferClientType(tok));
      const ts = Date.parse(tok.last_used_at || '');
      if (Number.isFinite(ts) && Date.now() - ts < bestAge) {
        bestAge = Date.now() - ts;
        lastMcpAt = tok.last_used_at;
      }
    }
    const mcpBucket = presenceBucket(lastMcpAt);
    const mcpOnline = mcpBucket === 'active';
    let presence = 'offline';
    if (wsOnline && mcpOnline) presence = 'office+ai';
    else if (wsOnline) presence = 'office';
    else if (mcpOnline) presence = 'ai';
    else if (mcpBucket === 'recent') presence = 'recent';

    return {
      ...tm,
      online: wsOnline || mcpOnline,
      ws_online: wsOnline,
      mcp_online: mcpOnline,
      mcp_presence: mcpBucket,
      last_mcp_at: lastMcpAt,
      mcp_clients: [...clients],
      presence,
    };
  });
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
  const onlineSet = online instanceof Set ? online : new Set(online || []);
  const raw = await visitor.listTeammatesWithPresence(scope.session_id, onlineSet);
  const tokens = await loadOrgMcpTokens(scope);
  const teammates = enrichTeammatesWithMcpPresence(raw, tokens, onlineSet);
  const onlineCount = teammates.filter((t) => t.online).length;
  return {
    ok: true,
    org_slug: scope.org_slug,
    your_npc_key: scope.npc_key,
    your_session_id: scope.session_id,
    teammates,
    count: teammates.length,
    online_count: onlineCount,
    presence_hint:
      'online = in office (WS) and/or AI client used MCP in the last '
      + `${Math.round(MCP_ACTIVE_MS / 60000)} minutes`,
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
    metadata: {
      source: 'mcp',
      member_id: scope.member_id || null,
      poll_hint: 'Recipient AI should call list_pending_handoffs then acknowledge_handoff',
    },
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
    next_step: 'Their ChatGPT/Cursor should poll list_pending_handoffs',
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
  const rows = (handoffs || []).slice(0, limit).map((h) => ({
    ...h,
    poll_action: 'Read message, act, then acknowledge_handoff with handoff_id',
  }));
  return {
    ok: true,
    handoffs: rows,
    count: (handoffs || []).length,
    hint: rows.length
      ? 'Process each handoff, then acknowledge_handoff so teammates know you saw it'
      : 'Inbox empty',
  };
}

async function toolAcknowledgeHandoff(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const handoffId = args?.handoff_id || args?.id || args?.message_id;
  if (!handoffId) return { ok: false, error: 'handoff_id required' };
  const visitor = _deps.denizenVisitor;
  if (!visitor?.markHandoffDelivered) {
    return { ok: false, error: 'handoff ack not configured' };
  }
  try {
    const row = await visitor.markHandoffDelivered(handoffId, scope.session_id);
    return {
      ok: true,
      handoff_id: row?.id || handoffId,
      status: row?.status || 'delivered',
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolTeamStandup(scope, args = {}) {
  const err = requireSession(scope);
  if (err) return err;

  const includeCrm = args?.include_crm !== false;
  const includeCursor = args?.include_cursor !== false;

  const [team, handoffs, extras] = await Promise.all([
    toolListTeam(scope),
    toolListPendingHandoffs(scope, { limit: 20 }),
    buildStatusExtras(scope, { work: [] }),
  ]);

  const directives = _deps.npcBrains?.getAllDirectives?.() || {};
  const directiveRows = Object.entries(directives).map(([npc, d]) => ({
    npc,
    from: d?.from || null,
    task: d?.task || null,
    urgent: !!d?.urgent,
  }));

  let cursorWork = { ok: true, items: [], count: 0 };
  if (includeCursor) {
    try {
      const mcpCursorTools = require('./denizen-mcp-cursor-tools.js');
      cursorWork = await mcpCursorTools.callTool(scope, 'list_cursor_work', {
        status: 'pending',
        limit: 15,
      });
    } catch (e) {
      cursorWork = { ok: false, error: e?.message || String(e), items: [], count: 0 };
    }
  }

  let crmTasks = null;
  if (includeCrm) {
    try {
      const mcpCrmTools = require('./denizen-mcp-crm-tools.js');
      if (mcpCrmTools.isCrmTool?.('crm_list_tasks') || true) {
        crmTasks = await mcpCrmTools.callTool(scope, 'crm_list_tasks', { limit: 15 });
      }
    } catch (e) {
      crmTasks = { ok: false, error: e?.message || String(e) };
    }
  }

  const online = (team.teammates || []).filter((t) => t.online);
  const needsYou = (handoffs.handoffs || []).length;
  const pendingCursor = cursorWork?.count || cursorWork?.items?.length || 0;

  const actionItems = [];
  if (needsYou) {
    actionItems.push({
      priority: 'high',
      action: 'list_pending_handoffs',
      detail: `${needsYou} handoff(s) waiting — act then acknowledge_handoff`,
    });
  }
  if (pendingCursor) {
    actionItems.push({
      priority: 'high',
      action: 'list_cursor_work',
      detail: `${pendingCursor} Cursor work item(s) pending`,
    });
  }
  const urgentDirs = directiveRows.filter((d) => d.urgent);
  if (urgentDirs.length) {
    actionItems.push({
      priority: 'normal',
      action: 'office_directives',
      detail: `${urgentDirs.length} urgent NPC directive(s)`,
    });
  }
  if (!actionItems.length) {
    actionItems.push({
      priority: 'low',
      action: 'none',
      detail: 'No blocking handoffs or Cursor work — sync CRM / continue current task',
    });
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    org_slug: scope.org_slug,
    you: {
      session_id: scope.session_id,
      npc_key: scope.npc_key,
      display_name: extras.display_name,
      directive: extras.directive_inbox,
    },
    team: {
      count: team.count || 0,
      online_count: team.online_count || 0,
      teammates: team.teammates || [],
      presence_hint: team.presence_hint,
    },
    handoffs: {
      count: handoffs.count || 0,
      items: handoffs.handoffs || [],
      hint: handoffs.hint,
    },
    cursor_work: {
      count: pendingCursor,
      items: cursorWork?.items || cursorWork?.work || [],
      error: cursorWork?.ok === false ? cursorWork.error : null,
    },
    office_directives: directiveRows.slice(0, 20),
    crm_tasks: crmTasks,
    inference: extras.inference,
    action_items: actionItems,
    next_poll: {
      tools: ['team_standup', 'list_pending_handoffs'],
      suggested_interval_seconds: needsYou || pendingCursor ? 60 : 300,
    },
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
    case 'acknowledge_handoff': return toolAcknowledgeHandoff(scope, args);
    case 'team_standup': return toolTeamStandup(scope, args);
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
  enrichTeammatesWithMcpPresence,
  MCP_ACTIVE_MS,
};
