'use strict';

/**
 * Per-NPC MCP gateway — Streamable HTTP JSON-RPC.
 * Teammate AIs (Claude, Cursor, etc.) connect to /mcp/npc/:npcKey with a bearer token.
 *
 * Sync: update_memory, get_status, log_activity
 * Actions: list_skills, run_skill, assign_task, delegate_task, announce_in_office
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const denizenDb = require('./denizen-db.js');
const mcpActions = require('./denizen-mcp-actions.js');
const mcpMarketTools = require('./denizen-mcp-market-tools.js');
const mcpTeamTools = require('./denizen-mcp-team-tools.js');
const mcpCrmTools = require('./denizen-mcp-crm-tools.js');
const mcpMeshTools = require('./denizen-mcp-mesh-tools.js');
const mcpCursorTools = require('./denizen-mcp-cursor-tools.js');
const mcpScopes = require('./denizen-mcp-scopes.js');
const mcpResources = require('./denizen-mcp-resources.js');
const mcpMentorTools = require('./denizen-mcp-mentor-tools.js');
const { hashSessionToken } = require('./visitor-session-auth.js');

const PROTOCOL_VERSION = '2024-11-05';
const RATE_LIMIT_PER_HOUR = Number(process.env.DENIZEN_MCP_RATE_LIMIT || 120);
const _rateBuckets = new Map();

let _idCounter = 1;
const _sessions = new Map();

const TOOL_DEFINITIONS = [
  {
    name: 'update_memory',
    description: 'Append a memory line to this NPC in Denizen (syncs to the in-world agent).',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Memory text to remember' },
        topic: { type: 'string', description: 'Optional topic tag' },
        outcome: { type: 'string', description: 'Optional outcome label' },
      },
      required: ['body'],
    },
  },
  {
    name: 'get_status',
    description: 'Read current NPC status: recent work, memories, roster info.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max recent items (default 10)' },
      },
    },
  },
  {
    name: 'log_activity',
    description: 'Log a work activity for this NPC (appears in work feed and facts spine).',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'What the NPC did' },
        phase: { type: 'string', description: 'Optional phase tag (e.g. review, coding)' },
        action: { type: 'string', description: 'Optional action verb' },
      },
      required: ['note'],
    },
  },
  {
    name: 'list_skills',
    description: 'List OpenClaw/Jelly skills this NPC is allowed to run (research, canvas-render, CRM, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_skill',
    description:
      'Run a real skill as this NPC (research, CRM, web-search, …). '
      + 'For ChatGPT: use wait=false (returns job_id) then poll get_skill_job. '
      + 'For Cursor/local: wait=true returns the result.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name, e.g. canvas-render, research, crm-summary' },
        params: { type: 'object', description: 'Skill parameters (query, task, etc.)' },
        wait: { type: 'boolean', description: 'If false, return job_id immediately (default true)' },
        max_wait_ms: {
          type: 'number',
          description: 'When wait=false, optionally wait up to this many ms before returning job_id',
        },
        timeout_ms: { type: 'number', description: 'Max wait when wait=true (default 180000)' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'get_skill_job',
    description: 'Poll an async run_skill job by job_id until status is done or failed.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id from run_skill (skj_…)' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'assign_task',
    description:
      'Queue work for the local office NPC brain (slow). Blocked for ChatGPT clients — use run_skill.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What the NPC should do' },
        urgent: { type: 'boolean', description: 'Skip think cooldown when true' },
        from: { type: 'string', description: 'Who assigned it (default MCP teammate)' },
        allow_local_queue: {
          type: 'boolean',
          description: 'Required override if a ChatGPT-labeled token must queue local work',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'delegate_task',
    description: 'Delegate a task to another teammate NPC by name or folder key.',
    inputSchema: {
      type: 'object',
      properties: {
        to_npc: { type: 'string', description: 'Target NPC, e.g. Josh or josh' },
        task: { type: 'string', description: 'Task description' },
        urgent: { type: 'boolean' },
      },
      required: ['to_npc', 'task'],
    },
  },
  {
    name: 'announce_in_office',
    description: 'Make this NPC say something in the virtual office (speech bubble for connected viewers).',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Line of dialogue' },
      },
      required: ['message'],
    },
  },
];

function sendJson(res, status, payload, extraHeaders) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', ...(extraHeaders || {}) });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data.trim()) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function extractBearer(req, url) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return url.searchParams.get('token') || null;
}

function rateLimitKey(tokenId) {
  return String(tokenId || 'unknown');
}

function checkRateLimit(tokenId) {
  const key = rateLimitKey(tokenId);
  const hour = Math.floor(Date.now() / 3600000);
  const bucketKey = `${key}:${hour}`;
  const count = (_rateBuckets.get(bucketKey) || 0) + 1;
  _rateBuckets.set(bucketKey, count);
  if (_rateBuckets.size > 5000) {
    const cutoff = hour - 2;
    for (const k of _rateBuckets.keys()) {
      if (Number(k.split(':').pop()) < cutoff) _rateBuckets.delete(k);
    }
  }
  return count <= RATE_LIMIT_PER_HOUR;
}

async function resolveToken(token) {
  if (!token || !denizenDb.enabled) return null;
  const result = await denizenDb._rpc('denizen_resolve_mcp_token', { p_token: token });
  if (!result?.ok) return null;
  return result;
}

function npcDisplayName(npcKey) {
  const entries = require('./npc-roster').entries || [];
  const hit = entries.find((e) => e.folder === npcKey);
  return hit?.display || npcKey;
}

async function toolUpdateMemory(scope, args) {
  const body = String(args?.body || '').trim().slice(0, 2000);
  if (!body) return { ok: false, error: 'body required' };

  const row = await denizenDb.insertNpcMemory({
    orgId: scope.org_id,
    npcKey: scope.npc_key,
    body,
    topic: args?.topic || null,
    outcome: args?.outcome || null,
    source: 'mcp',
    memberId: scope.member_id || null,
  });

  await denizenDb.recordFact({
    orgId: scope.org_id,
    factType: 'npc.memory.updated',
    actorType: 'system',
    actorId: scope.npc_key,
    payload: {
      body: body.slice(0, 200),
      topic: args?.topic || null,
      source: 'mcp',
      memory_id: row?.id || null,
      member_id: scope.member_id || null,
    },
    tags: ['npc', 'memory', 'mcp'],
  });

  return {
    ok: true,
    memory_id: row?.id || null,
    npc_key: scope.npc_key,
    recorded_at: row?.recorded_at || new Date().toISOString(),
  };
}

async function toolGetStatus(scope, args) {
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10));
  const npcKey = scope.npc_key;
  const orgId = scope.org_id;

  const [npcRows, memories, work] = await Promise.all([
    denizenDb._get(`denizen_npcs?select=npc_key,display_name,role,protected,claimable&npc_key=eq.${encodeURIComponent(npcKey)}&limit=1`).catch(() => []),
    denizenDb.listNpcMemories({ orgId, npcKey, limit, source: 'mcp' }).catch(() => []),
    denizenDb._get([
      'denizen_work_output?select=phase,action,note,ts',
      `org_id=eq.${encodeURIComponent(orgId)}`,
      `npc_key=eq.${encodeURIComponent(npcKey)}`,
      'order=ts.desc',
      `limit=${limit}`,
    ].join('&')).catch(() => []),
  ]);

  const extras = await mcpTeamTools.buildStatusExtras(scope, { work: work || [] });

  return {
    ok: true,
    npc: npcRows?.[0] || { npc_key: npcKey, display_name: npcDisplayName(npcKey) },
    recent_mcp_memories: memories,
    recent_work: work || [],
    org_slug: scope.org_slug,
    ...extras,
  };
}

async function toolLogActivity(scope, args) {
  const note = String(args?.note || '').trim().slice(0, 500);
  if (!note) return { ok: false, error: 'note required' };
  const display = npcDisplayName(scope.npc_key);

  denizenDb.recordWorkOutput({
    orgId: scope.org_id,
    npcName: display,
    phase: args?.phase || 'mcp',
    action: args?.action || 'activity',
    note,
    role: 'mcp-sync',
  });

  return { ok: true, logged: true, npc_key: scope.npc_key };
}

async function logMcpAudit(scope, toolName, result) {
  if (!denizenDb.enabled || !scope?.org_id) return;
  try {
    await denizenDb._rpc('denizen_log_mcp_audit', {
      p_org_id: scope.org_id,
      p_token_id: scope.token_id || null,
      p_npc_key: scope.npc_key,
      p_tool_name: toolName,
      p_ok: result?.ok !== false && result?.error !== 'scope_denied',
      p_error_code: result?.error || null,
      p_session_id: scope.session_id || null,
      p_member_id: scope.member_id || null,
      p_meta: {},
    });
  } catch (_) { /* audit must not block tools */ }
}

async function callToolImpl(scope, name, args) {
  if (mcpMarketTools.isMarketNpc(scope.npc_key) && mcpMarketTools.toolsForNpc(scope.npc_key).some((t) => t.name === name)) {
    return mcpMarketTools.callTool(scope.npc_key, name, args);
  }
  if (mcpTeamTools.isTeamTool(name)) {
    return mcpTeamTools.callTool(scope, name, args);
  }
  if (mcpCrmTools.isCrmTool(name)) {
    return mcpCrmTools.callTool(scope, name, args);
  }
  if (mcpMeshTools.isMeshTool(name)) {
    return mcpMeshTools.callTool(scope, name, args);
  }
  if (mcpCursorTools.isCursorTool(name)) {
    return mcpCursorTools.callTool(scope, name, args);
  }
  if (mcpMentorTools.isMentorTool(name)) {
    return mcpMentorTools.callTool(scope, name, args);
  }
  switch (name) {
    case 'update_memory': return toolUpdateMemory(scope, args);
    case 'get_status': return toolGetStatus(scope, args);
    case 'log_activity': return toolLogActivity(scope, args);
    case 'list_skills': return mcpActions.toolListSkills(scope, args);
    case 'run_skill': return mcpActions.toolRunSkill(scope, args);
    case 'get_skill_job': return mcpActions.toolGetSkillJob(scope, args);
    case 'assign_task': return mcpActions.toolAssignTask(scope, args);
    case 'delegate_task': return mcpActions.toolDelegateTask(scope, args);
    case 'announce_in_office': return mcpActions.toolAnnounce(scope, args);
    default: return { ok: false, error: `unknown tool: ${name}` };
  }
}

async function callTool(scope, name, args) {
  const toolName = String(name || '').trim();
  if (!mcpScopes.toolAllowed(scope, toolName)) {
    const denied = {
      ok: false,
      error: 'scope_denied',
      required_scope: mcpScopes.requiredScope(toolName),
      granted_scopes: mcpScopes.scopesFromTokenScope(scope),
    };
    logMcpAudit(scope, toolName, denied);
    return denied;
  }
  const result = await callToolImpl(scope, toolName, args);
  logMcpAudit(scope, toolName, result);
  return result;
}

function configure(deps = {}) {
  mcpActions.configure(deps);
  mcpMarketTools.configure(deps);
  mcpTeamTools.configure(deps);
  mcpCrmTools.configure(deps);
  mcpMeshTools.configure(deps);
  mcpCursorTools.configure(deps);
  mcpMentorTools.configure({
    announceInOffice: ({ npcName, message }) => {
      if (typeof deps.broadcast === 'function') {
        deps.broadcast({
          type: 'npc_response',
          npcName,
          fromName: 'Mentor panel',
          text: String(message || '').slice(0, 500),
          turn: 1,
          ts: Date.now(),
        });
      }
    },
    refreshNpcMemories: () => deps.npcBrains?.refreshDbMemories?.(),
  });
}

function toolsForScope(scope) {
  const base = [...TOOL_DEFINITIONS];
  if (scope?.npc_key) {
    base.push(...mcpTeamTools.toolsForNpc(scope.npc_key));
    base.push(...mcpCrmTools.toolsForNpc(scope.npc_key));
    base.push(...mcpMarketTools.toolsForNpc(scope.npc_key));
    base.push(...mcpMeshTools.toolsForNpc(scope.npc_key));
    base.push(...mcpCursorTools.toolsForNpc(scope.npc_key));
    if (scope.npc_key === 'grok' || scope.npc_key === '_team') {
      base.push(...mcpMentorTools.toolsForGateway());
    }
  }
  return mcpScopes.filterTools(scope, base);
}

async function handleRpc(scope, req, res, message, sessionId) {
  const { id, method, params } = message || {};

  if (method === 'initialize') {
    const sid = sessionId || crypto.randomBytes(16).toString('hex');
    _sessions.set(sid, { scope, at: Date.now() });
    if (sessionId) res.setHeader('Mcp-Session-Id', sid);
    const capabilities = { tools: {} };
    // Expose telemetry as first-class resource for external AIs (Claude, Cursor, etc.)
    // This decouples the Intelligence Spine from local filesystem.
    if (scope.npc_key === 'grok') {
      capabilities.resources = {};
    }
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities,
        serverInfo: { name: `denizen-npc-${scope.npc_key}`, version: '2.0.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: { tools: toolsForScope(scope) },
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    try {
      const result = await callTool(scope, toolName, toolArgs);
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result?.ok,
        },
      });
    } catch (err) {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err?.message || String(err) },
      });
    }
  }

  // MCP Resources: telemetry spine (full + per-NPC templates)
  if (method === 'resources/list') {
    if (scope.npc_key !== 'grok') {
      return sendJson(res, 200, { jsonrpc: '2.0', id, result: { resources: [] } });
    }
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: { resources: [...mcpResources.grokResourcesList(), ...mcpResources.mentorResourcesList()] },
    });
  }

  if (method === 'resources/templates/list') {
    if (scope.npc_key !== 'grok') {
      return sendJson(res, 200, { jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
    }
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        resourceTemplates: [
          ...mcpResources.GROK_RESOURCE_TEMPLATES,
          ...mcpResources.MENTOR_RESOURCE_TEMPLATES,
        ],
      },
    });
  }

  if (method === 'resources/read') {
    const uri = params?.uri;
    if (mcpResources.canReadTelemetry(scope, uri)) {
      try {
        const text = mcpResources.readResource(uri);
        if (text == null) {
          return sendJson(res, 200, {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Resource not found' },
          });
        }
        return sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [{ uri, mimeType: 'application/json', text }],
          },
        });
      } catch (err) {
        return sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: `Failed to read telemetry: ${err.message}` },
        });
      }
    }
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Resource not found or not accessible for this scope' },
    });
  }

  if (method === 'notifications/initialized') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: {} });
  }

  return sendJson(res, 200, {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

async function handleHttpRequest(req, res, npcKeyFromPath) {
  const npcKey = String(npcKeyFromPath || '').toLowerCase().trim();
  if (!npcKey) {
    return sendJson(res, 400, { ok: false, error: 'npc_key required' });
  }

  let reqUrl;
  try {
    reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    return sendJson(res, 400, { ok: false, error: 'bad url' });
  }

  const pathKey = reqUrl.pathname.split('/').filter(Boolean).pop();
  if (pathKey && pathKey !== npcKey) {
    return sendJson(res, 400, { ok: false, error: 'npc_key mismatch' });
  }

  // Advertise the OAuth flow so subscription AIs (Claude.ai, ChatGPT, Cursor)
  // can connect by URL alone instead of a pasted bearer token.
  const wwwAuth = (() => {
    try {
      // eslint-disable-next-line global-require
      return require('./denizen-mcp-oauth.js').wwwAuthenticate(getPublicBaseUrl(), npcKey);
    } catch (_) {
      return 'Bearer';
    }
  })();

  const token = extractBearer(req, reqUrl);
  if (!token) {
    return sendJson(res, 401, { ok: false, error: 'Bearer token required' }, { 'WWW-Authenticate': wwwAuth });
  }

  const scope = await module.exports.resolveToken(token);
  if (!scope) {
    return sendJson(res, 401, { ok: false, error: 'invalid or revoked token' }, { 'WWW-Authenticate': wwwAuth });
  }

  if (scope.npc_key !== npcKey) {
    return sendJson(res, 403, { ok: false, error: 'token not valid for this NPC' });
  }

  if (!checkRateLimit(scope.token_id)) {
    return sendJson(res, 429, { ok: false, error: 'rate limit exceeded' });
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      mcp: true,
      npc_key: npcKey,
      tools: toolsForScope(scope).map((t) => t.name),
      protocol: PROTOCOL_VERSION,
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'POST or GET only' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err?.message || 'invalid json' });
  }

  const sessionId = req.headers['mcp-session-id'] || req.headers['Mcp-Session-Id'] || null;

  if (Array.isArray(body)) {
    for (const msg of body) {
      await handleRpc(scope, req, res, msg, sessionId);
    }
    return;
  }

  return handleRpc(scope, req, res, body, sessionId);
}

function getPublicBaseUrl() {
  const pub = String(process.env.DENIZEN_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (pub && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(pub)) {
    return pub;
  }
  const denizen = String(process.env.DENIZEN_URL || '').trim().replace(/\/$/, '');
  if (denizen && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(denizen)) {
    return denizen;
  }
  return String(pub || denizen || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, '');
}

async function authenticateBearerRequest(req, res) {
  let reqUrl;
  try {
    reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: 'bad url' });
    return null;
  }

  const token = extractBearer(req, reqUrl);
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'Bearer token required' });
    return null;
  }

  const scope = await module.exports.resolveToken(token);
  if (!scope) {
    sendJson(res, 401, { ok: false, error: 'invalid or revoked token' });
    return null;
  }

  if (!checkRateLimit(scope.token_id)) {
    sendJson(res, 429, { ok: false, error: 'rate limit exceeded' });
    return null;
  }

  return scope;
}

async function handleRestSync(req, res, action) {
  const scope = await authenticateBearerRequest(req, res);
  if (!scope) return;

  if (action === 'status' || action === 'list-skills' || action === 'skill-job') {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: 'GET only' });
    }
    if (action === 'list-skills') {
      const result = await callTool(scope, 'list_skills', {});
      return sendJson(res, result?.ok ? 200 : 400, result);
    }
    if (action === 'skill-job') {
      let jobId = null;
      try {
        const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        jobId = u.searchParams.get('job_id') || u.searchParams.get('id');
      } catch (_) { /* keep null */ }
      const result = await callTool(scope, 'get_skill_job', { job_id: jobId });
      const found = result && result.error !== 'job_not_found';
      return sendJson(res, found ? 200 : 404, result);
    }
    let limit = 10;
    try {
      const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      limit = Number(u.searchParams.get('limit')) || 10;
    } catch (_) { /* keep default */ }
    const result = await callTool(scope, 'get_status', { limit });
    return sendJson(res, result?.ok ? 200 : 400, result);
  }

  if (action === 'memory' || action === 'activity') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'POST only' });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err?.message || 'invalid json' });
    }
    const payload = body || {};
    const result = action === 'memory'
      ? await callTool(scope, 'update_memory', {
        body: payload.body || payload.note || payload.text,
        topic: payload.topic,
        outcome: payload.outcome,
      })
      : await callTool(scope, 'log_activity', payload);
    return sendJson(res, result?.ok ? 200 : 400, result);
  }

  if (action === 'run-skill' || action === 'assign-task') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'POST only' });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err?.message || 'invalid json' });
    }
    const payload = { ...(body || {}) };
    if (action === 'run-skill') {
      // ChatGPT Custom GPT Actions time out ~45s — default to async job + soft wait.
      if (payload.wait === undefined) {
        payload.wait = false;
        if (payload.max_wait_ms === undefined) payload.max_wait_ms = 20000;
      }
      const result = await callTool(scope, 'run_skill', payload);
      return sendJson(res, result?.ok ? 200 : 400, result);
    }
    // REST assign-task is the ChatGPT Actions path — block the slow Molly queue.
    const result = await callTool(scope, 'assign_task', {
      ...payload,
      client_type: payload.client_type || 'chatgpt',
    });
    return sendJson(res, result?.ok ? 200 : 400, result);
  }

  return sendJson(res, 404, { ok: false, error: 'unknown action' });
}

function buildOpenApiSpec(baseUrl) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'Denizen NPC Sync API',
      description:
        'REST bridge for ChatGPT Custom GPT Actions. YOU execute work via runNpcSkill. '
        + 'Long work: runNpcSkill with wait=false → poll getSkillJob. '
        + 'assignNpcTask is blocked (queues slow local NPC). '
        + 'Mint a Standard/Full Connect AI token.',
      version: '1.9.0',
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'NPC sync token from Denizen Connect AI (needs skills scope for runNpcSkill)',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/npc-sync/status': {
        get: {
          operationId: 'getNpcStatus',
          summary: 'Get NPC status, recent memories, and work feed',
          parameters: [{
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 10 },
          }],
          responses: {
            200: { description: 'NPC status payload' },
          },
        },
      },
      '/api/npc-sync/list-skills': {
        get: {
          operationId: 'listNpcSkills',
          summary: 'List skills YOU can run now via runNpcSkill (do not ask the office NPC)',
          responses: {
            200: { description: 'Allowed skill names for this NPC token' },
          },
        },
      },
      '/api/npc-sync/skill-job': {
        get: {
          operationId: 'getSkillJob',
          summary: 'Poll an async runNpcSkill job until status is done or failed',
          parameters: [{
            name: 'job_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Job id returned by runNpcSkill (skj_…)',
          }],
          responses: {
            200: { description: 'Job status (running | done | failed)' },
            404: { description: 'Unknown job' },
          },
        },
      },
      '/api/npc-sync/memory': {
        post: {
          operationId: 'updateNpcMemory',
          summary: 'Remember something for this NPC',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    body: { type: 'string', description: 'Memory text' },
                    note: { type: 'string', description: 'Alias for body' },
                    topic: { type: 'string' },
                    outcome: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Memory recorded' } },
        },
      },
      '/api/npc-sync/activity': {
        post: {
          operationId: 'logNpcActivity',
          summary: 'Log work activity for this NPC',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['note'],
                  properties: {
                    note: { type: 'string' },
                    phase: { type: 'string' },
                    action: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Activity logged' } },
        },
      },
      '/api/npc-sync/run-skill': {
        post: {
          operationId: 'runNpcSkill',
          summary: 'Start a skill NOW (async by default for ChatGPT — poll getSkillJob)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['skill'],
                  properties: {
                    skill: {
                      type: 'string',
                      description: 'Skill name from listNpcSkills, e.g. research, web-search, crm-summary',
                    },
                    params: {
                      type: 'object',
                      description: 'Skill parameters (query, task, note, etc.)',
                    },
                    wait: {
                      type: 'boolean',
                      description:
                        'Default false on this REST API. false returns job_id; true blocks until done (may time out in ChatGPT)',
                      default: false,
                    },
                    max_wait_ms: {
                      type: 'integer',
                      description: 'When wait=false, soft-wait this many ms before returning job_id (default 20000)',
                      default: 20000,
                    },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Skill finished early, or job_id while still running' } },
        },
      },
      '/api/npc-sync/assign-task': {
        post: {
          operationId: 'assignNpcTask',
          summary: 'BLOCKED for ChatGPT — use runNpcSkill. Local office queue only with allow_local_queue=true',
          description:
            'Queues the in-world NPC local brain. ChatGPT Actions cannot use this; it returns assign_task_blocked_for_chatgpt.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['task'],
                  properties: {
                    task: { type: 'string' },
                    urgent: { type: 'boolean' },
                    allow_local_queue: {
                      type: 'boolean',
                      description: 'Escape hatch only — still not recommended for ChatGPT',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Task queued (only if allow_local_queue)' },
            400: { description: 'Blocked — use runNpcSkill' },
          },
        },
      },
    },
  };
}

function buildOnboardingPayload({ baseUrl, npcKey, token }) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/$/, '');
  const mcpUrl = `${base}/mcp/npc/${encodeURIComponent(npcKey)}`;
  const openapiUrl = `${base}/api/npc-sync/openapi.json`;

  return {
    rest_sync: {
      base_url: `${base}/api/npc-sync`,
      status_url: `${base}/api/npc-sync/status`,
      list_skills_url: `${base}/api/npc-sync/list-skills`,
      memory_url: `${base}/api/npc-sync/memory`,
      activity_url: `${base}/api/npc-sync/activity`,
      run_skill_url: `${base}/api/npc-sync/run-skill`,
      skill_job_url: `${base}/api/npc-sync/skill-job`,
      assign_task_url: `${base}/api/npc-sync/assign-task`,
      openapi_url: openapiUrl,
    },
    chatgpt: {
      openapi_url: openapiUrl,
      auth_type: 'Bearer',
      steps: [
        'Create a Custom GPT at chatgpt.com/gpts/editor',
        'Actions → Import from URL → paste the OpenAPI URL (re-import after Denizen updates)',
        'Authentication → API Key → Auth Type: Bearer → paste your token (standard or full scope)',
        'Paste the gpt_instructions below — YOU run skills async; never assignNpcTask',
      ],
      gpt_instructions: [
        `You ARE the connected brain for ${npcDisplayName(npcKey)} in Denizen.`,
        'Never use assignNpcTask — it is blocked and only queues the slow local office AI.',
        'Do work with runNpcSkill (default wait=false). If you get a job_id / status=running, poll getSkillJob until status is done or failed, then summarize output.',
        'Start hard jobs with listNpcSkills, then runNpcSkill with a clear params object (query/task/note).',
        'Use getNpcStatus at session start. Use updateNpcMemory for lasting context. Use logNpcActivity after you finish.',
        'If you see scope_denied, tell the user to mint a Connect AI token with Standard or Full access.',
      ].join(' '),
    },
    claude_ai: {
      connector_url: mcpUrl,
      auth_header: `Bearer ${token}`,
      steps: [
        'Claude.ai → Settings → Integrations → Add MCP connector',
        'URL: MCP connector URL below',
        'Header: Authorization Bearer <your token>',
        'Note: Claude.ai connectors are more limited than the API — use REST/OpenAPI if MCP is unavailable',
      ],
    },
  };
}

async function createMcpToken({
  orgId,
  npcKey,
  memberId = null,
  sessionId = null,
  label = null,
  scopes = null,
  scopePreset = null,
  clientType = null,
  metadata = null,
} = {}) {
  if (!denizenDb.enabled || !orgId || !npcKey) {
    throw new Error('database unavailable or missing org/npc');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const normalizedScopes = mcpScopes.normalizeScopes(scopes || scopePreset);
  const meta = {
    scopes: normalizedScopes,
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
  };
  if (clientType) meta.client_type = String(clientType).toLowerCase().trim();

  const tokenId = await denizenDb._rpc('denizen_register_mcp_token', {
    p_org_id: orgId,
    p_npc_key: npcKey,
    p_token_hash: tokenHash,
    p_member_id: memberId || null,
    p_session_id: sessionId || null,
    p_label: label || null,
    p_metadata: meta,
  });

  const baseUrl = getPublicBaseUrl();
  const mcpUrl = npcKey === '_team'
    ? `${baseUrl}/mcp/team`
    : `${baseUrl}/mcp/npc/${encodeURIComponent(npcKey)}`;
  const onboarding = buildOnboardingPayload({ baseUrl, npcKey, token });

  return {
    token_id: tokenId,
    token,
    mcp_url: mcpUrl,
    npc_key: npcKey,
    scopes: normalizedScopes,
    ...onboarding,
    cursor_config: {
      mcpServers: {
        [`denizen-${npcKey}`]: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    claude_desktop_config: {
      mcpServers: {
        [`denizen-${npcKey}`]: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
  };
}

function buildConnectInfo(npcKey, baseUrl) {
  const base = String(baseUrl || getPublicBaseUrl()).replace(/\/$/, '');
  const url = `${base}/mcp/npc/${encodeURIComponent(npcKey)}`;
  return {
    npc_key: npcKey,
    mcp_url: url,
    tools: toolsForScope({ npc_key: npcKey }).map((t) => t.name),
    openapi_url: `${base}/api/npc-sync/openapi.json`,
    paths: {
      cursor_api: 'MCP JSON-RPC at mcp_url (Cursor, Claude Desktop, API clients)',
      chatgpt: 'Custom GPT Actions via openapi_url + Bearer token',
      claude_ai: 'Claude.ai MCP connector at mcp_url + Bearer token',
    },
    instructions: 'Create a token via POST /api/mcp/tokens (team session required), then choose Cursor/API, ChatGPT, or Claude.ai in Connect AI.',
  };
}

module.exports = {
  TOOL_DEFINITIONS,
  configure,
  toolsForScope,
  handleHttpRequest,
  handleRestSync,
  buildOpenApiSpec,
  getPublicBaseUrl,
  createMcpToken,
  buildConnectInfo,
  buildOnboardingPayload,
  resolveToken,
  callTool,
};
