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

/**
 * Process-local MCP presence — touched on every authenticated MCP tool call.
 * Avoids depending solely on denizen_list_mcp_tokens (capped / created_at order),
 * so an active Grok/Cursor session always counts as mcp_online.
 */
const _mcpPresenceBySession = new Map();
const MCP_PRESENCE_MAX = 5000;

/** Display-name patterns for ephemeral probe / e2e / health sessions — hide from roster. */
const PROBE_NAME_RE = /^(test\s*user|testuser|probe|health\s*check|healthcheck|e2e|cypress|playwright|load\s*test|smoke\s*test)(\b|[_\-\d]|$)/i;

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
  {
    name: 'cloud_supervisor_inbox',
    description:
      'Read the cloud→local supervisor inbox: hallucination flags, chronos loops, skill failures. '
      + 'Free-tier Grok/ChatGPT/Claude can poll this, then assign_task / update_memory / mentor_* '
      + 'to guide local LM Studio NPCs that keep doing the tool work.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max open events (default 25)' },
        include_handled: { type: 'boolean', description: 'Include already-handled events (default false)' },
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

const _mcpPresenceByNpc = new Map();

function _prunePresenceMap(map) {
  if (map.size <= MCP_PRESENCE_MAX) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [k, v] of map) {
    if (v < cutoff) map.delete(k);
  }
  while (map.size > MCP_PRESENCE_MAX) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

/** Record MCP activity for a visitor session (call on every MCP tools/call). */
function touchMcpPresence(sessionId, at = Date.now()) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const ts = typeof at === 'number' && Number.isFinite(at) ? at : Date.parse(at);
  const ms = Number.isFinite(ts) ? ts : Date.now();
  const prev = _mcpPresenceBySession.get(sid);
  if (!prev || ms >= prev) _mcpPresenceBySession.set(sid, ms);
  _prunePresenceMap(_mcpPresenceBySession);
  return new Date(ms).toISOString();
}

/** Record MCP activity for CLI / API tokens that have no visitor session_id. */
function touchMcpPresenceByNpc(npcKey, at = Date.now()) {
  const key = String(npcKey || '').trim().toLowerCase();
  if (!key || key === '_team') return null;
  const ts = typeof at === 'number' && Number.isFinite(at) ? at : Date.parse(at);
  const ms = Number.isFinite(ts) ? ts : Date.now();
  const prev = _mcpPresenceByNpc.get(key);
  if (!prev || ms >= prev) _mcpPresenceByNpc.set(key, ms);
  _prunePresenceMap(_mcpPresenceByNpc);
  return new Date(ms).toISOString();
}

function getMcpPresenceAt(sessionId) {
  const ms = _mcpPresenceBySession.get(String(sessionId || '').trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function getMcpPresenceAtNpc(npcKey) {
  const ms = _mcpPresenceByNpc.get(String(npcKey || '').trim().toLowerCase());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function clearMcpPresenceForTests() {
  _mcpPresenceBySession.clear();
  _mcpPresenceByNpc.clear();
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

function isProbeSessionName(displayName) {
  const name = String(displayName || '').trim();
  if (!name) return false;
  return PROBE_NAME_RE.test(name);
}

function normalizeIdentityKey(tm) {
  if (tm?.identity_id) return `id:${tm.identity_id}`;
  const name = String(tm?.display_name || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return `session:${tm?.session_id || 'unknown'}`;
}

function newerIso(a, b) {
  const ta = Date.parse(a || '');
  const tb = Date.parse(b || '');
  if (!Number.isFinite(ta)) return b || a || null;
  if (!Number.isFinite(tb)) return a || b || null;
  return ta >= tb ? a : b;
}

function presenceRank(tm) {
  if (tm?.online) return 3;
  if (tm?.mcp_presence === 'recent') return 2;
  if (tm?.mcp_presence === 'stale') return 1;
  return 0;
}

/** Drop probe/test clones; keep one row per human identity (best presence wins). */
function collapseRosterByIdentity(teammates, { includeProbes = false } = {}) {
  const filtered = [];
  let prunedProbeCount = 0;
  for (const tm of teammates || []) {
    if (!includeProbes && isProbeSessionName(tm.display_name) && !tm.is_you) {
      prunedProbeCount += 1;
      continue;
    }
    filtered.push(tm);
  }

  const byKey = new Map();
  for (const tm of filtered) {
    const key = normalizeIdentityKey(tm);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...tm,
        sessions_collapsed: 1,
        session_ids: tm.session_id ? [tm.session_id] : [],
      });
      continue;
    }
    const sessionIds = new Set([...(prev.session_ids || []), tm.session_id].filter(Boolean));
    const preferNew = presenceRank(tm) > presenceRank(prev)
      || (presenceRank(tm) === presenceRank(prev)
        && Date.parse(tm.last_mcp_at || '') > Date.parse(prev.last_mcp_at || ''));
    const winner = preferNew ? tm : prev;
    const loser = preferNew ? prev : tm;
    byKey.set(key, {
      ...winner,
      online: !!(winner.online || loser.online),
      ws_online: !!(winner.ws_online || loser.ws_online),
      mcp_online: !!(winner.mcp_online || loser.mcp_online),
      last_mcp_at: newerIso(winner.last_mcp_at, loser.last_mcp_at),
      mcp_presence: presenceBucket(newerIso(winner.last_mcp_at, loser.last_mcp_at)),
      mcp_clients: [...new Set([...(winner.mcp_clients || []), ...(loser.mcp_clients || [])])],
      sessions_collapsed: (prev.sessions_collapsed || 1) + 1,
      session_ids: [...sessionIds],
      is_you: !!(winner.is_you || loser.is_you),
    });
    const merged = byKey.get(key);
    if (merged.ws_online && merged.mcp_online) merged.presence = 'office+ai';
    else if (merged.ws_online) merged.presence = 'office';
    else if (merged.mcp_online) merged.presence = 'ai';
    else if (merged.mcp_presence === 'recent') merged.presence = 'recent';
    else merged.presence = merged.online ? 'ai' : 'offline';
  }

  const collapsed = [...byKey.values()].sort((a, b) => {
    if (a.is_you !== b.is_you) return a.is_you ? -1 : 1;
    return presenceRank(b) - presenceRank(a);
  });
  return { teammates: collapsed, pruned_probe_count: prunedProbeCount };
}

function inferClientType(token) {
  const label = String(token?.label || '').toLowerCase();
  const meta = token?.metadata || {};
  const client = String(meta.client_type || meta.clientType || '').toLowerCase();
  if (client.includes('chatgpt') || label.includes('chatgpt')) return 'chatgpt';
  if (client.includes('cursor') || label.includes('cursor')) return 'cursor';
  if (client.includes('claude') || label.includes('claude')) return 'claude';
  if (client.includes('grok') || label.includes('grok')) return 'grok';
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

function pickBestLastMcpAt(...candidates) {
  let best = null;
  let bestAge = Infinity;
  for (const raw of candidates) {
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) continue;
    const age = Date.now() - ts;
    if (age < bestAge) {
      bestAge = age;
      best = typeof raw === 'string' ? raw : new Date(ts).toISOString();
    }
  }
  return best;
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
    let lastMcpFromTokens = null;
    let bestAge = Infinity;
    const clients = new Set();
    for (const tok of sessionTokens) {
      clients.add(inferClientType(tok));
      const ts = Date.parse(tok.last_used_at || '');
      if (Number.isFinite(ts) && Date.now() - ts < bestAge) {
        bestAge = Date.now() - ts;
        lastMcpFromTokens = tok.last_used_at;
      }
    }
    const lastMcpAt = pickBestLastMcpAt(lastMcpFromTokens, getMcpPresenceAt(sid), tm.last_mcp_at);
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

async function resolveSelfTeammate(scope) {
  const visitor = _deps.denizenVisitor;
  let displayName = null;
  let identityId = null;
  let npcKey = scope.npc_key && scope.npc_key !== '_team' ? scope.npc_key : null;
  let assistantName = null;
  if (visitor?.getSession) {
    try {
      const session = await visitor.getSession(scope.session_id);
      displayName = session?.display_name || null;
      identityId = session?.identity_id || null;
    } catch (_) { /* ignore */ }
  }
  if (visitor?.getAssistant && !npcKey) {
    try {
      const asst = await visitor.getAssistant(scope.session_id);
      npcKey = asst?.npc_key || npcKey;
      assistantName = asst?.assistant_name || null;
    } catch (_) { /* ignore */ }
  }
  return {
    session_id: scope.session_id,
    display_name: displayName || 'You',
    identity_id: identityId,
    npc_key: npcKey,
    assistant_name: assistantName,
    is_you: true,
  };
}

/** Office CLI / API tokens (no Connect AI session) — roster from NPC souls + MCP activity. */
async function toolListTeamWithoutSession(scope) {
  if (scope?.npc_key) touchMcpPresenceByNpc(scope.npc_key);
  const brains = _deps.npcBrains;
  const teammates = (npcRoster.entries || []).map((entry) => {
    const mcpAt = getMcpPresenceAtNpc(entry.folder);
    const mcpBucket = presenceBucket(mcpAt);
    const isYou = scope?.npc_key && scope.npc_key !== '_team' && entry.folder === scope.npc_key;
    const directive = brains?.getDirective?.(entry.display) || null;
    let presence = 'offline';
    if (mcpBucket === 'active') presence = 'ai';
    else if (mcpBucket === 'recent') presence = 'recent';
    return {
      session_id: null,
      display_name: entry.display,
      identity_id: null,
      npc_key: entry.folder,
      assistant_name: entry.display,
      is_you: !!isYou,
      online: mcpBucket === 'active' || !!isYou,
      ws_online: false,
      mcp_online: mcpBucket === 'active' || !!isYou,
      mcp_presence: isYou && !mcpBucket ? 'active' : mcpBucket,
      last_mcp_at: mcpAt || (isYou ? new Date().toISOString() : null),
      mcp_clients: (mcpBucket === 'active' || isYou) ? [inferClientType({ label: entry.folder })] : [],
      presence: isYou ? 'ai' : presence,
      directive: directive
        ? { from: directive.from || null, task: directive.task || null, urgent: !!directive.urgent }
        : null,
      sessions_collapsed: 1,
    };
  });
  // Ensure the calling NPC is marked active even mid-first-call.
  if (scope?.npc_key && scope.npc_key !== '_team') {
    const self = teammates.find((t) => t.npc_key === scope.npc_key);
    if (self) {
      self.is_you = true;
      self.online = true;
      self.mcp_online = true;
      self.mcp_presence = 'active';
      self.presence = 'ai';
      self.last_mcp_at = self.last_mcp_at || new Date().toISOString();
    }
  }
  const onlineCount = teammates.filter((t) => t.online).length;
  return {
    ok: true,
    org_slug: scope.org_slug,
    your_npc_key: scope.npc_key,
    your_session_id: null,
    session_linked: false,
    teammates,
    count: teammates.length,
    raw_session_count: teammates.length,
    pruned_probe_count: 0,
    online_count: onlineCount,
    presence_hint:
      'CLI/API token (no visitor session) — roster is office NPCs; '
      + 'mcp_online = this NPC MCP client called tools recently. '
      + 'Mint from Connect AI while logged in for full human presence + handoffs.',
  };
}

async function toolListTeam(scope) {
  if (!scope?.session_id) {
    return toolListTeamWithoutSession(scope);
  }
  // Always stamp the caller's MCP presence so standup/list_team itself counts as online.
  touchMcpPresence(scope.session_id);
  if (scope.npc_key) touchMcpPresenceByNpc(scope.npc_key);
  const visitor = _deps.denizenVisitor;
  if (!visitor?.listTeammatesWithPresence) {
    return { ok: false, error: 'visitor module not configured' };
  }
  const online = typeof _deps.listOnlineSessionIds === 'function'
    ? _deps.listOnlineSessionIds()
    : null;
  const onlineSet = online instanceof Set ? online : new Set(online || []);
  const raw = await visitor.listTeammatesWithPresence(scope.session_id, onlineSet);
  const selfRow = await resolveSelfTeammate(scope);
  const withSelf = [
    selfRow,
    ...(raw || []).filter((tm) => tm.session_id !== scope.session_id),
  ];
  const tokens = await loadOrgMcpTokens(scope);
  const enriched = enrichTeammatesWithMcpPresence(withSelf, tokens, onlineSet);
  const { teammates, pruned_probe_count: prunedProbeCount } = collapseRosterByIdentity(enriched);
  const onlineCount = teammates.filter((t) => t.online).length;
  const rawCount = withSelf.length;
  return {
    ok: true,
    org_slug: scope.org_slug,
    your_npc_key: scope.npc_key,
    your_session_id: scope.session_id,
    session_linked: true,
    teammates,
    count: teammates.length,
    raw_session_count: rawCount,
    pruned_probe_count: prunedProbeCount,
    online_count: onlineCount,
    presence_hint:
      'online = in office (WS) and/or AI client used MCP in the last '
      + `${Math.round(MCP_ACTIVE_MS / 60000)} minutes; roster collapsed by identity; `
      + 'probe/TestUser/HealthCheck sessions filtered',
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
  const includeCrm = args?.include_crm !== false;
  const includeCursor = args?.include_cursor !== false;
  const sessionLinked = Boolean(scope?.session_id);
  if (scope?.npc_key) touchMcpPresenceByNpc(scope.npc_key);

  const [team, handoffs, extras] = await Promise.all([
    toolListTeam(scope),
    sessionLinked
      ? toolListPendingHandoffs(scope, { limit: 20 })
      : Promise.resolve({
        ok: true,
        count: 0,
        handoffs: [],
        hint: 'Handoffs need a Connect AI token minted while logged in (session_linked=false)',
      }),
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
    session_linked: sessionLinked,
    you: {
      session_id: scope.session_id || null,
      npc_key: scope.npc_key,
      display_name: extras.display_name,
      directive: extras.directive_inbox,
    },
    team: {
      count: team.count || 0,
      online_count: team.online_count || 0,
      raw_session_count: team.raw_session_count || team.count || 0,
      pruned_probe_count: team.pruned_probe_count || 0,
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
      tools: sessionLinked
        ? ['team_standup', 'list_pending_handoffs']
        : ['team_standup', 'announce_in_office', 'get_status'],
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
  if (scope?.session_id) touchMcpPresence(scope.session_id);
  else if (scope?.npc_key) touchMcpPresenceByNpc(scope.npc_key);
  switch (name) {
    case 'list_team': return toolListTeam(scope, args);
    case 'send_handoff': return toolSendHandoff(scope, args);
    case 'list_pending_handoffs': return toolListPendingHandoffs(scope, args);
    case 'acknowledge_handoff': return toolAcknowledgeHandoff(scope, args);
    case 'team_standup': return toolTeamStandup(scope, args);
    case 'cloud_supervisor_inbox': {
      const inbox = require('./npc-cloud-supervisor-inbox.js');
      const limit = Math.max(1, Math.min(80, Number(args?.limit) || 25));
      if (args?.include_handled) {
        return { ok: true, ...inbox.summarizeForCloud(limit), events: inbox.readRecent(limit) };
      }
      return inbox.summarizeForCloud(limit);
    }
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
  collapseRosterByIdentity,
  isProbeSessionName,
  touchMcpPresence,
  touchMcpPresenceByNpc,
  getMcpPresenceAt,
  getMcpPresenceAtNpc,
  clearMcpPresenceForTests,
  MCP_ACTIVE_MS,
};
