'use strict';

/**
 * Org-scoped team MCP gateway — /mcp/team with _team bearer tokens.
 */

const crypto = require('node:crypto');
const npcGateway = require('./denizen-npc-mcp-gateway.js');
const mcpTeamTools = require('./denizen-mcp-team-tools.js');
const npcRoster = require('./npc-roster');

const TEAM_NPC_KEY = '_team';
const PROTOCOL_VERSION = '2024-11-05';

const TEAM_TOOL_DEFINITIONS = [
  {
    name: 'team_status',
    description: 'Office-wide snapshot: teammates, online presence, active directives, inference health.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_as_npc',
    description: 'Run any MCP tool as another NPC in your org (skills, CRM, market on Roki, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        npc_key: { type: 'string', description: 'Target NPC folder key, e.g. rob, josh, roki' },
        tool: { type: 'string', description: 'Tool name to invoke on that NPC' },
        arguments: { type: 'object', description: 'Tool arguments' },
      },
      required: ['npc_key', 'tool'],
    },
  },
  {
    name: 'broadcast_task',
    description: 'Assign the same mandatory task to multiple NPCs (wakes think loops).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description' },
        npc_keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'NPC keys to assign (default: all non-protected roster NPCs)',
        },
        urgent: { type: 'boolean' },
      },
      required: ['task'],
    },
  },
  ...mcpTeamTools.TEAM_TOOL_DEFINITIONS,
];

const TEAM_RESOURCES = [
  {
    uri: 'team://roster',
    name: 'team_roster',
    description: 'Org teammates with claimed assistants and online presence',
    mimeType: 'application/json',
  },
  {
    uri: 'team://handoffs',
    name: 'team_handoffs',
    description: 'Pending assistant handoffs for your session',
    mimeType: 'application/json',
  },
];

let _deps = {};

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
  mcpTeamTools.configure(deps);
  npcGateway.configure(deps);
}

function isTeamScope(scope) {
  return scope?.npc_key === TEAM_NPC_KEY || scope?.scope_mode === 'team';
}

function displayNameForKey(npcKey) {
  const hit = (npcRoster.entries || []).find((e) => e.folder === npcKey);
  return hit?.display || npcKey;
}

function protectedNpcKeys() {
  return new Set(['abby', 'lucy', 'bouncer']);
}

async function toolTeamStatus(scope) {
  const [team, extras] = await Promise.all([
    mcpTeamTools.callTool(scope, 'list_team', {}),
    mcpTeamTools.buildStatusExtras(scope, { work: [] }),
  ]);
  const directives = _deps.npcBrains?.getAllDirectives?.() || {};
  return {
    ok: true,
    org_slug: scope.org_slug,
    teammates: team.teammates || [],
    teammate_count: team.count || 0,
    active_directives: directives,
    inference: extras.inference,
    pending_handoffs_count: extras.pending_handoffs_count,
  };
}

async function toolRunAsNpc(scope, args) {
  const targetKey = String(args?.npc_key || '').toLowerCase().trim();
  const tool = String(args?.tool || '').trim();
  if (!targetKey || targetKey === TEAM_NPC_KEY) {
    return { ok: false, error: 'npc_key required (not _team)' };
  }
  if (protectedNpcKeys().has(targetKey)) {
    return { ok: false, error: `NPC ${targetKey} is protected — use send_handoff to CEO instead` };
  }
  if (!tool) return { ok: false, error: 'tool required' };

  const childScope = {
    ...scope,
    npc_key: targetKey,
    scope_mode: 'npc',
  };
  const toolArgs = args?.arguments && typeof args.arguments === 'object' ? args.arguments : {};
  const result = await npcGateway.callTool(childScope, tool, toolArgs);
  return { ok: result?.ok !== false, npc_key: targetKey, tool, result };
}

async function toolBroadcastTask(scope, args) {
  const task = String(args?.task || '').trim().slice(0, 2000);
  if (!task) return { ok: false, error: 'task required' };
  if (!_deps.npcBrains?.assignDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }

  let keys = (args?.npc_keys || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
  if (!keys.length) {
    keys = (npcRoster.entries || [])
      .map((e) => e.folder)
      .filter((k) => k && k !== TEAM_NPC_KEY && !protectedNpcKeys().has(k));
  }

  const urgent = !!args?.urgent;
  const from = 'Team MCP';
  const assigned = [];
  for (const key of keys) {
    const display = displayNameForKey(key);
    _deps.npcBrains.assignDirective(display, from, task, urgent);
    assigned.push({ npc_key: key, display_name: display });
  }
  return { ok: true, task, urgent, assigned_count: assigned.length, assigned };
}

async function readResource(scope, uri) {
  if (uri === 'team://roster') {
    const team = await mcpTeamTools.callTool(scope, 'list_team', {});
    return JSON.stringify(team, null, 2);
  }
  if (uri === 'team://handoffs') {
    const inbox = await mcpTeamTools.callTool(scope, 'list_pending_handoffs', { limit: 20 });
    return JSON.stringify(inbox, null, 2);
  }
  return null;
}

async function callTool(scope, name, args) {
  switch (name) {
    case 'team_status': return toolTeamStatus(scope, args);
    case 'run_as_npc': return toolRunAsNpc(scope, args);
    case 'broadcast_task': return toolBroadcastTask(scope, args);
    default:
      if (mcpTeamTools.isTeamTool(name)) {
        return mcpTeamTools.callTool(scope, name, args);
      }
      return { ok: false, error: `unknown team tool: ${name}` };
  }
}

async function createTeamMcpToken(opts = {}) {
  return npcGateway.createMcpToken({
    ...opts,
    npcKey: TEAM_NPC_KEY,
    label: opts.label || 'team-operator',
  });
}

function buildConnectInfo(baseUrl) {
  const base = String(baseUrl || npcGateway.getPublicBaseUrl()).replace(/\/$/, '');
  return {
    npc_key: TEAM_NPC_KEY,
    scope_mode: 'team',
    mcp_url: `${base}/mcp/team`,
    tools: TEAM_TOOL_DEFINITIONS.map((t) => t.name),
    resources: TEAM_RESOURCES.map((r) => r.uri),
    instructions: 'Create via POST /api/mcp/team-tokens (team session). Operate the whole office from one connection.',
  };
}

async function handleHttpRequest(req, res) {
  const token = (() => {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const m = String(auth).match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    try {
      const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      return u.searchParams.get('token') || null;
    } catch (_) {
      return null;
    }
  })();

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Bearer token required' }));
    return;
  }

  const scope = await npcGateway.resolveToken(token);
  if (!scope?.ok || !isTeamScope(scope)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Team MCP requires a _team operator token from POST /api/mcp/team-tokens',
    }));
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      mcp: true,
      scope_mode: 'team',
      tools: TEAM_TOOL_DEFINITIONS.map((t) => t.name),
      resources: TEAM_RESOURCES.map((r) => r.uri),
      protocol: PROTOCOL_VERSION,
    }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'POST or GET only' }));
    return;
  }

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        if (!data.trim()) return resolve(null);
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err?.message || 'invalid json' }));
    return;
  }

  const { id, method, params } = body || {};

  if (method === 'initialize') {
    const sid = crypto.randomBytes(16).toString('hex');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'denizen-team', version: '1.0.0' },
      },
    }));
    return;
  }

  if (method === 'tools/list') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: { tools: TEAM_TOOL_DEFINITIONS },
    }));
    return;
  }

  if (method === 'resources/list') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: { resources: TEAM_RESOURCES },
    }));
    return;
  }

  if (method === 'resources/read') {
    const uri = params?.uri;
    const text = await readResource(scope, uri);
    if (text == null) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown resource: ${uri}` },
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{ uri, mimeType: 'application/json', text }],
      },
    }));
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    try {
      const result = await callTool(scope, toolName, toolArgs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result?.ok,
        },
      }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err?.message || String(err) },
      }));
    }
    return;
  }

  if (method === 'notifications/initialized') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }));
}

module.exports = {
  TEAM_NPC_KEY,
  TEAM_TOOL_DEFINITIONS,
  TEAM_RESOURCES,
  configure,
  isTeamScope,
  callTool,
  createTeamMcpToken,
  buildConnectInfo,
  handleHttpRequest,
};
