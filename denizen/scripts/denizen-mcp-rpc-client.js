#!/usr/bin/env node
'use strict';

/**
 * Thin JSON-RPC client for Denizen NPC MCP (/mcp/npc/:npcKey).
 */

const DEFAULT_BASE = 'https://denizen.dolonia.cloud';

function mcpUrl(base, npcKey) {
  const b = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  return `${b}/mcp/npc/${npcKey}`;
}

async function rpc({ url, token, method, params = {}, id = '1' }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(`MCP non-JSON HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }
  return data.result;
}

async function initialize(cfg) {
  return rpc({
    url: cfg.url,
    token: cfg.token,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: cfg.clientName || 'denizen-autonomy', version: '1.0.0' },
    },
  });
}

async function listTools(cfg) {
  const result = await rpc({ url: cfg.url, token: cfg.token, method: 'tools/list' });
  return Array.isArray(result?.tools) ? result.tools : [];
}

async function callTool(cfg, name, args = {}) {
  const result = await rpc({
    url: cfg.url,
    token: cfg.token,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  return {
    ok: !result?.isError,
    text: text || JSON.stringify(result),
    raw: result,
  };
}

function toAnthropicTools(mcpTools) {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description || t.name,
    input_schema: t.inputSchema || t.input_schema || { type: 'object', properties: {} },
  }));
}

module.exports = {
  mcpUrl,
  rpc,
  initialize,
  listTools,
  callTool,
  toAnthropicTools,
};
