'use strict';

/**
 * Generic MCP connector — tool discovery alongside Supabase bridge.
 * Streamable HTTP JSON-RPC (same pattern as robinhood-mcp).
 */

const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'data', 'mcp-servers.json');
const TIMEOUT_MS = 15000;

let _idCounter = 1;
const _sessions = new Map();

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Array.isArray(parsed.servers) ? parsed : { servers: [] };
  } catch (_) {
    return { servers: [] };
  }
}

function listServers() {
  return (loadConfig().servers || []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    url: s.url,
    enabled: s.enabled !== false,
    readOnly: s.readOnly !== false,
  }));
}

function _request(url, body, sessionId) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const sid = res.headers['mcp-session-id'];
        if (sid) _sessions.set(url, sid);
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), sessionId: sid });
          } catch (_) {
            resolve({ status: res.statusCode, body: data, sessionId: sid });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('MCP timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function _rpc(serverUrl, method, params = {}) {
  const id = _idCounter++;
  const res = await _request(
    serverUrl,
    { jsonrpc: '2.0', id, method, params },
    _sessions.get(serverUrl),
  );
  const result = res.body?.result ?? res.body;
  return { id, result, error: res.body?.error || null, status: res.status };
}

async function initializeServer(serverId) {
  const cfg = loadConfig().servers?.find((s) => s.id === serverId);
  if (!cfg?.url) return { ok: false, error: 'server not found' };
  const init = await _rpc(cfg.url, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'denizen', version: '1.0.0' },
  });
  return { ok: !init.error, serverId, init };
}

async function listTools(serverId) {
  const cfg = loadConfig().servers?.find((s) => s.id === serverId);
  if (!cfg?.url) return { tools: [], error: 'server not found' };
  if (!_sessions.has(cfg.url)) {
    await initializeServer(serverId).catch(() => {});
  }
  const listed = await _rpc(cfg.url, 'tools/list', {});
  const tools = listed.result?.tools || listed.result || [];
  return { serverId, tools: Array.isArray(tools) ? tools : [], error: listed.error };
}

async function callTool(serverId, toolName, args = {}) {
  const cfg = loadConfig().servers?.find((s) => s.id === serverId);
  if (!cfg?.url) return { ok: false, error: 'server not found' };
  if (cfg.readOnly && /^(write|delete|post|create|update)/i.test(toolName)) {
    return { ok: false, error: 'read-only server' };
  }
  const called = await _rpc(cfg.url, 'tools/call', { name: toolName, arguments: args });
  return { ok: !called.error, result: called.result, error: called.error };
}

async function discoverAll() {
  const servers = listServers().filter((s) => s.enabled);
  const out = [];
  for (const s of servers) {
    const tools = await listTools(s.id).catch((err) => ({
      tools: [],
      error: err.message,
    }));
    out.push({ ...s, tools: tools.tools || [], error: tools.error });
  }
  return out;
}

module.exports = {
  loadConfig,
  listServers,
  initializeServer,
  listTools,
  callTool,
  discoverAll,
};
