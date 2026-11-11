'use strict';

/**
 * Team orchestration MCP tools — roster, handoffs, enriched status, standup.
 */

const npcRoster = require('./npc-roster');
const mcpActions = require('./denizen-mcp-actions');
const denizenDb = require('./denizen-db.js');
const outcomeLedger = require('./denizen-outcome-ledger.js');

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
    description:
      'Send a message/handoff to a teammate, or escalate to the CEO office (Lucy bridge). '
      + 'If the recipient registered a wake webhook, Denizen POSTs handoff.received so their bot wakes in seconds. '
      + 'Use kind (question|task|fyi|urgent) and reply_to to keep threads actionable. '
      + 'Optional document attaches a research brief for same-org sharing — the office shows a folder-carry delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Handoff message (required)' },
        to_session_id: { type: 'string', description: 'Target teammate session UUID' },
        to_display_name: { type: 'string', description: 'Target by display name (partial match)' },
        to_ceo: { type: 'boolean', description: 'Escalate to CEO / Lucy bridge' },
        to_npc: { type: 'string', description: 'Optional target NPC key for routing metadata' },
        kind: {
          type: 'string',
          description: 'Handoff type: question | task | fyi | urgent (default fyi)',
          enum: ['question', 'task', 'fyi', 'urgent'],
        },
        reply_to: {
          type: 'string',
          description: 'Parent handoff id — keeps a back-and-forth threaded',
        },
        document: {
          type: 'object',
          description: 'Optional research handoff document shared inside the same Denizen org',
          properties: {
            title: { type: 'string', description: 'Brief title' },
            summary: { type: 'string', description: 'Short summary of findings' },
            citations: {
              type: 'array',
              items: { type: 'string' },
              description: 'Source URLs or citation strings',
            },
            brief_id: { type: 'string', description: 'Optional research brief id / path' },
          },
        },
        dry_run: {
          type: 'boolean',
          description: 'Validate + preview without sending (no side effects)',
        },
        validate_only: {
          type: 'boolean',
          description: 'Alias for dry_run',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'list_pending_handoffs',
    description:
      'Open inbound handoffs (lifecycle=sent). Prefer wake webhooks over polling. '
      + 'For outbound/history/filters use list_handoffs.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 20)' },
        kind: {
          type: 'string',
          description: 'Filter by kind: question|task|fyi|urgent',
          enum: ['question', 'task', 'fyi', 'urgent'],
        },
      },
    },
  },
  {
    name: 'list_handoffs',
    description:
      'List handoffs for your session with direction + status filters. '
      + 'Use direction=outbound to see unanswered questions you sent; status=open|read|done|all.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'inbound (default) | outbound | both',
          enum: ['inbound', 'outbound', 'both'],
        },
        status: {
          type: 'string',
          description: 'open (default) | read | done | all',
          enum: ['open', 'read', 'done', 'all'],
        },
        kind: {
          type: 'string',
          description: 'Filter by kind',
          enum: ['question', 'task', 'fyi', 'urgent'],
        },
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'get_handoff',
    description:
      'Fetch one handoff by id (full message, kind, lifecycle, document, completion). '
      + 'Either party in the handoff pair can read it — use after a wake webhook.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Handoff id' },
      },
      required: ['handoff_id'],
    },
  },
  {
    name: 'list_handoff_thread',
    description:
      'Return the full back-and-forth thread for a handoff (root + reply_to chain), chronological.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Any handoff id in the thread' },
        limit: { type: 'number', description: 'Max messages (default 40)' },
      },
      required: ['handoff_id'],
    },
  },
  {
    name: 'reply_handoff',
    description:
      'Reply to a handoff without re-resolving the teammate. Sets reply_to automatically and '
      + 'sends to the other party. Prefer this over send_handoff after get_handoff.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Parent handoff id to reply to' },
        message: { type: 'string', description: 'Reply message' },
        kind: {
          type: 'string',
          description: 'Defaults to question if parent was question, else fyi',
          enum: ['question', 'task', 'fyi', 'urgent'],
        },
      },
      required: ['handoff_id', 'message'],
    },
  },
  {
    name: 'acknowledge_handoff',
    description:
      'Mark a handoff as read (lifecycle=read) after you saw/acted on it. '
      + 'Use complete_handoff when the work is finished (lifecycle=done). Optional note.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Handoff / message id from list_pending_handoffs' },
        status: {
          type: 'string',
          description: 'Optional lifecycle override: read (default) or done',
          enum: ['read', 'done'],
        },
        note: { type: 'string', description: 'Optional note stored on the handoff' },
      },
      required: ['handoff_id'],
    },
  },
  {
    name: 'complete_handoff',
    description:
      'Mark a handoff done (lifecycle=done). Optionally attach note + artifact; wakes the sender '
      + 'webhook with event=handoff.done when registered.',
    inputSchema: {
      type: 'object',
      properties: {
        handoff_id: { type: 'string', description: 'Handoff / message id' },
        note: { type: 'string', description: 'What you did / answer summary' },
        artifact: { type: 'string', description: 'Commit, path, ticket id, URL, etc.' },
      },
      required: ['handoff_id'],
    },
  },
  {
    name: 'register_handoff_webhook',
    description:
      'Register THIS bot\'s wake URL. Denizen POSTs {event:handoff.received,...} here whenever '
      + 'send_handoff targets your session — wake within seconds instead of polling. HTTPS required '
      + '(localhost allowed with DENIZEN_HANDOFF_WAKE_ALLOW_LOCALHOST=1). Optional secret becomes Authorization: Bearer.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS webhook URL that wakes this bot' },
        secret: { type: 'string', description: 'Optional Bearer token Denizen sends on wake POSTs' },
        clear: { type: 'boolean', description: 'Set true to remove the wake URL' },
      },
    },
  },
  {
    name: 'get_handoff_webhook',
    description: 'Show whether this session has a handoff wake webhook registered (URL is masked).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_directives',
    description:
      'List NPC directives with lifecycle status (queued|running|done|blocked|expired). '
      + 'Pass include_archived to see recent completions.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: queued|running|done|blocked|expired' },
        include_archived: { type: 'boolean', description: 'Include archived completions (default false)' },
      },
    },
  },
  {
    name: 'complete_directive',
    description:
      'Close a directive: done|blocked|expired. Archives + writes an outcome receipt when available.',
    inputSchema: {
      type: 'object',
      properties: {
        npc_key: { type: 'string', description: 'NPC folder key (default: your NPC)' },
        status: { type: 'string', description: 'done (default) | blocked | expired' },
        note: { type: 'string', description: 'Result note / blocker reason' },
        artifact: { type: 'string', description: 'Commit, path, closed task id, etc.' },
      },
    },
  },
  {
    name: 'record_outcome',
    description:
      'Write one outcome ledger receipt (owner, type, artifact, pass/fail). '
      + 'This is what morning standup reads — not log_activity diary lines.',
    inputSchema: {
      type: 'object',
      properties: {
        outcome_type: { type: 'string', description: 'e.g. hygiene.nightly, directive.done, handoff.done' },
        value_text: { type: 'string', description: 'Human-readable receipt' },
        entity_type: { type: 'string', description: 'deal|task|npc_directive|handoff|workspace|…' },
        entity_key: { type: 'string', description: 'ID or key of the entity' },
        artifact: { type: 'string', description: 'Commit SHA, path, ticket id' },
        pass: { type: 'boolean', description: 'true=success (default), false=fail' },
        actor: { type: 'string', description: 'Who produced this (default: caller NPC)' },
      },
      required: ['outcome_type', 'value_text'],
    },
  },
  {
    name: 'team_standup',
    description:
      'One-call team sync: human presence (WS + MCP), your handoff inbox, Cursor work queue, '
      + 'office directives, CRM tasks, Studio Board brief, Business Studio founder brief. '
      + 'Default mode=summary stays under connector size limits; mode=full returns full teammate rows. '
      + 'Start every collaborative session with this. Prefer wake webhooks for handoffs; '
      + 'standup every ~15m is a fallback until the recipient registers register_handoff_webhook.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['summary', 'full'],
          description: 'summary (default) = counts + compact rows; full = full teammate/handoff objects',
        },
        include_crm: {
          type: 'boolean',
          description: 'Include CRM open-task snapshot (default true)',
        },
        include_cursor: {
          type: 'boolean',
          description: 'Include pending Cursor work (default true)',
        },
        include_studio: {
          type: 'boolean',
          description: 'Include Studio Board + Business Studio briefs (default true)',
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
  const mcpResponse = require('./denizen-mcp-response');
  const err = requireSession(scope);
  if (err) return err;
  const message = String(args?.message || '').trim().slice(0, 4000);
  const toCeo = args?.to_ceo === true;
  const toSessionId = args?.to_session_id || args?.toSessionId || null;
  const toDisplayName = args?.to_display_name || args?.toDisplayName || null;
  const missing = [];
  if (!message) missing.push('message');
  if (!toCeo && !toSessionId && !toDisplayName) missing.push('to_session_id|to_display_name|to_ceo');
  if (mcpResponse.isDryRun(args)) {
    return mcpResponse.dryRunResult({
      tool: 'send_handoff',
      missing,
      args,
      plan: {
        message: message || null,
        to_ceo: toCeo,
        to_session_id: toSessionId,
        to_display_name: toDisplayName,
        kind: args?.kind || args?.type || 'fyi',
      },
    });
  }
  if (missing.length) {
    return {
      ok: false,
      error: missing.includes('message')
        ? 'message required'
        : 'Specify to_session_id, to_display_name, or to_ceo: true',
    };
  }

  const visitor = _deps.denizenVisitor;
  const connections = _deps.visitorConnections;
  if (!visitor?.sendHandoff || !visitor?.resolveHandoffTarget) {
    return { ok: false, error: 'handoff not configured' };
  }

  const wake = require('./denizen-handoff-wake.js');
  const kind = wake.normalizeHandoffKind(args?.kind || args?.type);
  const replyTo = args?.reply_to || args?.replyTo || null;

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
  const toNpc = args?.to_npc || args?.toNpc || (target.is_ceo_bridge ? 'lucy' : 'assistant');
  const rawDoc = args?.document && typeof args.document === 'object' ? args.document : null;
  const document = rawDoc ? {
    title: String(rawDoc.title || '').trim().slice(0, 200) || null,
    summary: String(rawDoc.summary || '').trim().slice(0, 2000) || null,
    citations: Array.isArray(rawDoc.citations)
      ? rawDoc.citations.map((c) => String(c).slice(0, 500)).filter(Boolean).slice(0, 20)
      : [],
    brief_id: String(rawDoc.brief_id || rawDoc.briefId || '').trim().slice(0, 240) || null,
  } : null;
  if (document && !document.title && !document.summary && !document.brief_id) {
    // Ignore empty document objects.
    document.title = null;
  }
  const hasDocument = !!(document && (document.title || document.summary || document.brief_id || document.citations.length));

  let fromDisplayName = displayNameForKey(fromNpc);
  try {
    const fromSession = await visitor.getSession?.(scope.session_id);
    if (fromSession?.display_name) fromDisplayName = fromSession.display_name;
  } catch (_) { /* optional */ }

  let handoff;
  try {
    handoff = await visitor.sendHandoff({
      fromSessionId: scope.session_id,
      toSessionId: target.session_id,
      fromNpc,
      toNpc,
      message,
      kind,
      replyTo,
      metadata: {
        source: 'mcp',
        member_id: scope.member_id || null,
        poll_hint: 'Recipient AI should call list_pending_handoffs then acknowledge_handoff',
        wake_hint: 'If register_handoff_webhook is set, Denizen POSTs handoff.received on arrival',
        document: hasDocument ? document : null,
        from_npc: fromNpc,
        to_npc: toNpc,
        kind,
        reply_to: replyTo,
      },
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }

  if (target.is_ceo_bridge && typeof _deps.notifyCeoHandoff === 'function' && handoff) {
    const enriched = {
      ...handoff,
      from_display_name: fromDisplayName,
      message,
      kind,
      document: hasDocument ? document : null,
    };
    _deps.notifyCeoHandoff(enriched);
  }

  // Office theater: always broadcast so the receiving NPC can walk/act; folder-carry when doc attached.
  if (typeof _deps.broadcast === 'function' && handoff) {
    try {
      _deps.broadcast({
        type: 'assistant_handoff',
        handoff,
        document: hasDocument ? document : null,
        kind,
        reply_to: replyTo,
        from_npc: fromNpc,
        to_npc: toNpc,
        from_display_name: fromDisplayName,
        message,
        ts: Date.now(),
      });
    } catch (_) { /* non-fatal */ }
  }

  let wakeResult = { skipped: true, reason: 'no_wake' };
  try {
    wakeResult = await wake.notifyHandoffWake({
      visitor,
      toSessionId: target.session_id,
      handoff,
      fromDisplayName,
      kind,
      replyTo,
      fetchImpl: _deps.fetchImpl || globalThis.fetch,
    });
  } catch (e) {
    wakeResult = { ok: false, skipped: false, reason: e?.message || String(e) };
  }

  const woke = !!wakeResult?.notified || !!wakeResult?.ok;
  const projected = wake.projectHandoff({
    ...handoff,
    from_display_name: fromDisplayName,
    direction: 'outbound',
  });
  return {
    ok: true,
    handoff_id: handoff?.id || null,
    kind: handoff?.kind || kind,
    lifecycle: handoff?.lifecycle || 'sent',
    reply_to: replyTo,
    handoff: projected,
    thread_hint: {
      parent_id: replyTo,
      reply_tool: 'reply_handoff',
      get_tool: 'get_handoff',
      thread_tool: 'list_handoff_thread',
    },
    target,
    from_npc: fromNpc,
    document: hasDocument ? document : null,
    wake: {
      notified: woke,
      skipped: !!wakeResult?.skipped,
      reason: wakeResult?.reason || null,
      status: wakeResult?.status || null,
      url: wakeResult?.url || null,
    },
    next_step: woke
      ? 'Recipient bot should wake from webhook within seconds'
      : 'Recipient has no wake webhook — their AI should poll list_pending_handoffs (or team_standup ~15m)',
  };
}

async function toolListPendingHandoffs(scope, args) {
  return toolListHandoffs(scope, {
    direction: 'inbound',
    status: 'open',
    kind: args?.kind || null,
    limit: args?.limit,
  });
}

async function toolListHandoffs(scope, args = {}) {
  const err = requireSession(scope);
  if (err) return err;
  const visitor = _deps.denizenVisitor;
  if (!visitor?.listHandoffs && !visitor?.getPendingHandoffs) {
    return { ok: false, error: 'handoff inbox not configured' };
  }
  const wake = require('./denizen-handoff-wake.js');
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 20));
  let rows;
  if (visitor.listHandoffs) {
    rows = await visitor.listHandoffs(scope.session_id, {
      direction: args?.direction || 'inbound',
      status: args?.status || 'open',
      kind: args?.kind || null,
      limit,
    });
  } else {
    const pending = await visitor.getPendingHandoffs(scope.session_id);
    rows = (pending || []).slice(0, limit).map((h) => ({
      ...h,
      direction: 'inbound',
      projected: wake.projectHandoff({ ...h, direction: 'inbound' }),
    }));
  }
  const handoffs = (rows || []).map((h) => {
    const projected = h.projected || wake.projectHandoff(h);
    return {
      ...projected,
      poll_action: Array.isArray(projected?.suggested_actions)
        ? projected.suggested_actions.join(' → ')
        : 'Read message, act, then acknowledge_handoff / reply_handoff / complete_handoff',
    };
  });
  const mcpResponse = require('./denizen-mcp-response');
  return mcpResponse.withEmptyList({
    ok: true,
    direction: args?.direction || 'inbound',
    status: args?.status || 'open',
    handoffs,
    count: handoffs.length,
    hint: handoffs.length
      ? 'Use get_handoff / list_handoff_thread / reply_handoff / complete_handoff'
      : 'No handoffs yet — create one with send_handoff, or register_handoff_webhook to wake on arrival',
  }, {
    itemsKey: 'handoffs',
    kind: 'handoffs',
    create_with: 'send_handoff',
  });
}

async function toolGetHandoff(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const handoffId = args?.handoff_id || args?.id || args?.message_id;
  if (!handoffId) return { ok: false, error: 'handoff_id required' };
  const visitor = _deps.denizenVisitor;
  if (!visitor?.getHandoffForSession) {
    return { ok: false, error: 'get_handoff not configured' };
  }
  try {
    const result = await visitor.getHandoffForSession(handoffId, scope.session_id);
    return {
      ok: true,
      handoff: result.handoff,
      next_step: result.handoff?.direction === 'inbound'
        ? 'Act, then reply_handoff / acknowledge_handoff / complete_handoff'
        : 'Wait for recipient or list_handoff_thread',
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolListHandoffThread(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const handoffId = args?.handoff_id || args?.id;
  if (!handoffId) return { ok: false, error: 'handoff_id required' };
  const visitor = _deps.denizenVisitor;
  if (!visitor?.listHandoffThread) {
    return { ok: false, error: 'list_handoff_thread not configured' };
  }
  try {
    const thread = await visitor.listHandoffThread(handoffId, scope.session_id, {
      limit: args?.limit,
    });
    return { ok: true, ...thread };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolReplyHandoff(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const handoffId = args?.handoff_id || args?.id;
  const message = String(args?.message || '').trim().slice(0, 4000);
  if (!handoffId) return { ok: false, error: 'handoff_id required' };
  if (!message) return { ok: false, error: 'message required' };
  const visitor = _deps.denizenVisitor;
  if (!visitor?.getHandoffForSession) {
    return { ok: false, error: 'reply_handoff not configured' };
  }
  let parent;
  try {
    const got = await visitor.getHandoffForSession(handoffId, scope.session_id);
    parent = got?.raw || null;
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
  if (!parent) return { ok: false, error: 'parent handoff not found' };
  const toSessionId = parent.from_session_id === scope.session_id
    ? parent.to_session_id
    : parent.from_session_id;
  const defaultKind = parent.kind === 'question' || parent.metadata?.kind === 'question'
    ? 'question'
    : 'fyi';
  const kind = args?.kind || defaultKind;
  return toolSendHandoff(scope, {
    message,
    to_session_id: toSessionId,
    kind,
    reply_to: handoffId,
    to_npc: parent.from_session_id === scope.session_id ? parent.to_npc : parent.from_npc,
  });
}

async function _notifySenderLifecycle(scope, row, lifecycle, { note, artifact } = {}) {
  if (!row?.from_session_id) return { skipped: true, reason: 'no_sender' };
  const wake = require('./denizen-handoff-wake.js');
  const event = lifecycle === 'done' ? 'handoff.done' : 'handoff.read';
  try {
    const session = await _deps.denizenVisitor?.getSession?.(row.from_session_id);
    const cfg = wake.wakeConfigFromSession(session);
    if (!cfg.url) return { skipped: true, reason: 'no_wake_url' };
    const payload = wake.buildWakePayload({
      handoff: row,
      fromDisplayName: displayNameForKey(scope.npc_key),
      kind: row.kind || row.metadata?.kind,
      lifecycle,
      event,
      note,
      artifact,
    });
    const result = await wake.postWakeWebhook(cfg.url, payload, {
      secret: cfg.secret,
      fetchImpl: _deps.fetchImpl || globalThis.fetch,
    });
    return {
      ...result,
      skipped: false,
      notified: !!result.ok,
      reason: result.ok ? 'posted' : (result.error || `http_${result.status || 'error'}`),
    };
  } catch (e) {
    return { ok: false, skipped: false, reason: e?.message || String(e) };
  }
}

async function toolAcknowledgeHandoff(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const handoffId = args?.handoff_id || args?.id || args?.message_id;
  if (!handoffId) return { ok: false, error: 'handoff_id required' };
  const visitor = _deps.denizenVisitor;
  const lifecycleRaw = String(args?.status || args?.lifecycle || 'read').toLowerCase();
  const lifecycle = lifecycleRaw === 'done' ? 'done' : 'read';
  const note = args?.note != null ? String(args.note).slice(0, 2000) : undefined;
  const artifact = args?.artifact != null ? String(args.artifact).slice(0, 500) : undefined;
  if (!visitor?.markHandoffStatus && !visitor?.markHandoffDelivered) {
    return { ok: false, error: 'handoff ack not configured' };
  }
  try {
    const row = visitor.markHandoffStatus
      ? await visitor.markHandoffStatus(handoffId, scope.session_id, lifecycle, { note, artifact })
      : await visitor.markHandoffDelivered(handoffId, scope.session_id);
    const wake = require('./denizen-handoff-wake.js');
    const projected = wake.projectHandoff(row);
    const senderWake = await _notifySenderLifecycle(scope, row, lifecycle, { note, artifact });
    return {
      ok: true,
      handoff_id: row?.id || handoffId,
      status: row?.status || (lifecycle === 'done' ? 'done' : 'delivered'),
      lifecycle: row?.lifecycle || lifecycle,
      handoff: projected,
      note: projected?.completion?.note || note || null,
      artifact: projected?.completion?.artifact || artifact || null,
      sender_wake: {
        notified: !!senderWake?.ok,
        skipped: !!senderWake?.skipped,
        reason: senderWake?.reason || null,
      },
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolCompleteHandoff(scope, args) {
  return toolAcknowledgeHandoff(scope, { ...args, status: 'done' });
}

async function toolRegisterHandoffWebhook(scope, args) {
  const err = requireSession(scope);
  if (err) return err;
  const visitor = _deps.denizenVisitor;
  if (!visitor?.setHandoffWakeUrl) {
    return { ok: false, error: 'handoff wake not configured' };
  }
  const clear = args?.clear === true;
  const url = args?.url || args?.webhook_url || args?.wake_url || null;
  const secret = args?.secret !== undefined ? args.secret : undefined;
  if (!clear && !url) {
    return { ok: false, error: 'url required (or clear: true)' };
  }
  try {
    const result = await visitor.setHandoffWakeUrl(scope.session_id, { url, secret, clear });
    return {
      ...result,
      hint: clear
        ? 'Wake webhook cleared — bots will fall back to polling list_pending_handoffs'
        : 'When someone send_handoff targets you, Denizen POSTs event=handoff.received to this URL',
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolGetHandoffWebhook(scope) {
  const err = requireSession(scope);
  if (err) return err;
  const visitor = _deps.denizenVisitor;
  if (!visitor?.getHandoffWakeUrl) {
    return { ok: false, error: 'handoff wake not configured' };
  }
  try {
    return await visitor.getHandoffWakeUrl(scope.session_id);
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

async function toolListDirectives(scope, args = {}) {
  const brains = _deps.npcBrains;
  if (!brains?.listDirectives && !brains?.getAllDirectives) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const rows = brains.listDirectives
    ? brains.listDirectives({
      status: args?.status || null,
      include_archived: args?.include_archived === true || args?.includeArchived === true,
    })
    : Object.entries(brains.getAllDirectives() || {}).map(([npc, d]) => ({ npc, ...d, active: true }));
  return {
    ok: true,
    count: rows.length,
    directives: rows,
    summary: rows.length
      ? `${rows.length} directive(s): ${rows.slice(0, 5).map((r) => `${r.npc}=${r.status || 'queued'}`).join(', ')}`
      : 'No active directives.',
    next_step: rows.length ? 'complete_directive when finished' : 'assign_task / delegate_task to queue work',
  };
}

async function toolCompleteDirective(scope, args = {}) {
  const key = String(args?.npc_key || scope?.npc_key || '').toLowerCase().trim();
  if (!key || key === '_team') return { ok: false, error: 'npc_key required' };
  if (!_deps.npcBrains?.completeDirective && !_deps.npcBrains?.clearDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const display = displayNameForKey(key);
  if (_deps.npcBrains.completeDirective) {
    const result = _deps.npcBrains.completeDirective(display, {
      status: args?.status || 'done',
      note: args?.note,
      artifact: args?.artifact,
    });
    return {
      ok: result.ok !== false,
      npc_key: key,
      display_name: display,
      ...result,
      next_step: 'record_outcome if this was a deliverable teammates should see',
    };
  }
  const cleared = _deps.npcBrains.clearDirective(display);
  return { ok: true, npc_key: key, display_name: display, cleared };
}

async function toolRecordOutcome(scope, args = {}) {
  const outcomeType = String(args?.outcome_type || args?.type || '').trim();
  const valueText = String(args?.value_text || args?.text || args?.note || '').trim();
  if (!outcomeType) return { ok: false, error: 'outcome_type required' };
  if (!valueText) return { ok: false, error: 'value_text required' };
  const entry = outcomeLedger.appendOutcome({
    org_id: scope?.org_id || denizenDb.orgId || null,
    actor: String(args?.actor || scope?.npc_key || 'mcp').slice(0, 80),
    outcome_type: outcomeType,
    entity_type: args?.entity_type || 'workspace',
    entity_key: args?.entity_key || null,
    value_text: valueText,
    value_json: {
      artifact: args?.artifact || null,
      ...(args?.value_json && typeof args.value_json === 'object' ? args.value_json : {}),
    },
    source: 'mcp_record_outcome',
    pass: args?.pass !== false,
  });
  return { ok: true, outcome: entry, summary: `Recorded ${entry.outcome_type} (${entry.id})` };
}

async function toolTeamStandup(scope, args = {}) {
  const mcpResponse = require('./denizen-mcp-response');
  const mode = mcpResponse.modeOf(args, 'summary');
  const includeCrm = args?.include_crm !== false;
  const includeCursor = args?.include_cursor !== false;
  const includeStudio = args?.include_studio !== false;
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
    id: d?.id || null,
    from: d?.from || null,
    task: d?.task || null,
    urgent: !!d?.urgent,
    status: d?.status || 'queued',
    started_at: d?.started_at || null,
    expires_at: d?.expires_at || null,
  }));

  let recentOutcomes = { count: 0, outcomes: [], breakdown: {} };
  try {
    recentOutcomes = outcomeLedger.standup({ hours: 168, limit: 10 });
  } catch (_) {}

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

  let studioBoard = null;
  let businessStudio = null;
  if (includeStudio) {
    try {
      const mcpStudioBoardTools = require('./denizen-mcp-studio-board-tools.js');
      studioBoard = await mcpStudioBoardTools.callTool(scope, 'studio_board_brief', {});
    } catch (e) {
      studioBoard = { ok: false, error: e?.message || String(e) };
    }
    try {
      const mcpBusinessStudioTools = require('./denizen-mcp-business-studio-tools.js');
      businessStudio = await mcpBusinessStudioTools.callTool(scope, 'business_studio_brief', {});
    } catch (e) {
      businessStudio = { ok: false, error: e?.message || String(e) };
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
  if (studioBoard?.ok !== false && (studioBoard?.overdue_count || studioBoard?.stuck_count)) {
    actionItems.push({
      priority: 'normal',
      action: 'studio-board-working-set',
      detail: 'Studio Board has overdue/stuck work — run studio-board-working-set then update tasks',
    });
  }
  if (businessStudio?.ok !== false && businessStudio?.recommended_next_action) {
    actionItems.push({
      priority: 'normal',
      action: 'business-studio-working-set',
      detail: `Business Studio next: ${String(businessStudio.recommended_next_action).slice(0, 160)}`,
    });
  }
  if (!actionItems.length) {
    actionItems.push({
      priority: 'low',
      action: 'none',
      detail: 'No blocking handoffs or Cursor work — sync CRM / Studio Board / Business Studio',
    });
  }

  const teammateRows = team.teammates || [];
  const handoffItems = handoffs.handoffs || [];
  const cursorItems = cursorWork?.items || cursorWork?.work || [];
  const compactTeammates = teammateRows.map((t) => ({
    display_name: t.display_name || t.name || null,
    npc_key: t.npc_key || t.claimed_npc || null,
    online: !!t.online,
    mcp_online: !!t.mcp_online,
    presence: t.presence || null,
  }));
  const compactHandoffs = handoffItems.map((h) => ({
    id: h.id || h.handoff_id || null,
    kind: h.kind || null,
    from: h.from_display_name || h.from || null,
    preview: String(h.message || h.body || h.title || '').slice(0, 120),
  }));
  const compactCursor = cursorItems.map((w) => ({
    id: w.id || null,
    title: w.title || null,
    priority: w.priority || null,
    status: w.status || null,
  }));

  const payload = {
    ok: true,
    mode,
    generated_at: new Date().toISOString(),
    org_slug: scope.org_slug,
    session_linked: sessionLinked,
    empty: !needsYou && !pendingCursor && !teammateRows.length,
    empty_state: (!needsYou && !pendingCursor)
      ? 'healthy'
      : 'populated',
    message: (!needsYou && !pendingCursor)
      ? 'No blocking handoffs or Cursor work — empty queues are OK'
      : null,
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
      teammates: mode === 'full' ? teammateRows : compactTeammates,
      presence_hint: team.presence_hint,
    },
    handoffs: {
      count: handoffs.count || 0,
      items: mode === 'full' ? handoffItems : compactHandoffs,
      hint: handoffs.hint
        || (handoffItems.length
          ? null
          : 'No handoffs yet — create one with send_handoff (or register_handoff_webhook to wake on arrival)'),
      ...(!handoffItems.length ? mcpResponse.emptyHealthy({
        kind: 'handoffs',
        create_with: 'send_handoff',
      }) : { empty: false }),
    },
    cursor_work: {
      count: pendingCursor,
      items: mode === 'full' ? cursorItems : compactCursor,
      error: cursorWork?.ok === false ? cursorWork.error : null,
      ...(!pendingCursor ? mcpResponse.emptyHealthy({
        kind: 'cursor work items',
        create_with: 'enqueue_cursor_work',
      }) : { empty: false }),
    },
    office_directives: mode === 'full' ? directiveRows.slice(0, 20) : directiveRows.slice(0, 8).map((d) => ({
      npc: d.npc, id: d.id, urgent: d.urgent, status: d.status, task: String(d.task || '').slice(0, 100),
    })),
    recent_outcomes: {
      count: recentOutcomes.count || 0,
      breakdown: recentOutcomes.breakdown || {},
      outcomes: mode === 'full' ? (recentOutcomes.outcomes || []) : (recentOutcomes.outcomes || []).slice(0, 5),
      summary: recentOutcomes.summary || null,
    },
    crm_tasks: crmTasks,
    studio_board: studioBoard,
    business_studio: businessStudio,
    inference: extras.inference,
    action_items: actionItems,
    next_poll: {
      tools: sessionLinked
        ? ['team_standup', 'list_pending_handoffs', 'get_handoff', 'list_directives', 'list_handoffs']
        : ['team_standup', 'list_directives', 'announce_in_office', 'get_status'],
      suggested_interval_seconds: needsYou || pendingCursor ? 60 : 300,
    },
    truncation_hint: mode === 'summary'
      ? 'mode=summary is compact — re-call with mode=full for full teammate/handoff objects'
      : null,
  };

  return mcpResponse.softCap(payload, {
    dropKeys: ['teammates', 'office_directives', 'recent_outcomes'],
    hint: 'Standup soft-capped — use mode=summary (default) or disable include_* sections.',
  });
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
    case 'list_handoffs': return toolListHandoffs(scope, args);
    case 'get_handoff': return toolGetHandoff(scope, args);
    case 'list_handoff_thread': return toolListHandoffThread(scope, args);
    case 'reply_handoff': return toolReplyHandoff(scope, args);
    case 'acknowledge_handoff': return toolAcknowledgeHandoff(scope, args);
    case 'complete_handoff': return toolCompleteHandoff(scope, args);
    case 'register_handoff_webhook': return toolRegisterHandoffWebhook(scope, args);
    case 'get_handoff_webhook': return toolGetHandoffWebhook(scope, args);
    case 'list_directives': return toolListDirectives(scope, args);
    case 'complete_directive': return toolCompleteDirective(scope, args);
    case 'record_outcome': return toolRecordOutcome(scope, args);
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
  collapseRosterByIdentity,
  isProbeSessionName,
  touchMcpPresence,
  touchMcpPresenceByNpc,
  getMcpPresenceAt,
  getMcpPresenceAtNpc,
  clearMcpPresenceForTests,
  MCP_ACTIVE_MS,
};
