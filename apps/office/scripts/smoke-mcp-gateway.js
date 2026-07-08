#!/usr/bin/env node
'use strict';

/**
 * Smoke test: MCP gateway RPC + HTTP auth gate.
 *
 * Env:
 *   DENIZEN_URL or DENIZEN_PUBLIC_URL — base URL (default http://127.0.0.1:8080)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — RPC resolve check
 *   MCP_SMOKE_NPC_KEY — npc key (default rob)
 *   MCP_SMOKE_TOKEN — optional bearer token for full HTTP handshake
 */

const base = String(
  process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || 'http://127.0.0.1:8080',
).replace(/\/+$/, '');
const npcKey = String(process.env.MCP_SMOKE_NPC_KEY || 'rob').toLowerCase();
const token = String(process.env.MCP_SMOKE_TOKEN || '').trim();

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function checkRpcResolve() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !key) {
    console.log('SKIP: RPC resolve (SUPABASE_URL / key not set)');
    return;
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/denizen_resolve_mcp_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_token: 'x'.repeat(24) }),
  });

  const body = await res.text();
  if (!res.ok) {
    fail(`RPC denizen_resolve_mcp_token HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  if (body.includes('digest') && body.includes('does not exist')) {
    fail('RPC digest/search_path broken — run migration 20260622000001');
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    fail(`RPC returned non-JSON: ${body.slice(0, 120)}`);
  }
  if (parsed?.ok !== false || parsed?.error !== 'not_found') {
    fail(`RPC unexpected payload: ${body.slice(0, 120)}`);
  }
  pass('RPC denizen_resolve_mcp_token resolves (not_found for dummy token)');
}

async function checkHttpGate() {
  const url = `${base}/mcp/npc/${encodeURIComponent(npcKey)}`;
  const anon = await fetch(url, { method: 'GET' });
  if (anon.status !== 401) {
    fail(`Unauthenticated GET expected 401, got ${anon.status}`);
  }
  pass(`GET ${url} returns 401 without token`);

  if (!token) {
    console.log('SKIP: authenticated handshake (MCP_SMOKE_TOKEN not set)');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };
  const manifest = await fetch(url, { headers });
  const manifestBody = await manifest.json().catch(() => ({}));
  if (!manifest.ok || !manifestBody.mcp) {
    fail(`Authenticated GET failed: HTTP ${manifest.status} ${JSON.stringify(manifestBody).slice(0, 120)}`);
  }
  pass(`GET manifest ok — tools: ${(manifestBody.tools || []).join(', ')}`);

  const initRes = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '1.0' },
      },
    }),
  });
  const initBody = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !initBody.result?.serverInfo?.name) {
    fail(`initialize failed: HTTP ${initRes.status} ${JSON.stringify(initBody).slice(0, 160)}`);
  }
  pass(`MCP initialize ok — ${initBody.result.serverInfo.name}`);
}

async function main() {
  console.log(`MCP smoke → ${base} npc=${npcKey}`);
  await checkRpcResolve();
  await checkHttpGate();
  console.log('MCP smoke complete');
}

main().catch((err) => fail(err.message));
