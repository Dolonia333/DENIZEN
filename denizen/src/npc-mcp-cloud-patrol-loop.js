'use strict';

/**
 * In-process Grok + Claude MCP cloud patrol (announce, assign_task, skills).
 * Started from server.js when NPC_MCP_CLOUD_PATROL !== '0'.
 */

const fs = require('node:fs');
const path = require('node:path');

const TOKEN_DIR = path.join(__dirname, '..', 'data', 'mcp-patrol');
const INTERVAL_MS = Math.max(60_000, Number(process.env.NPC_MCP_PATROL_MS) || 180_000);

const PATROL_ROUTES = [
  'Walk to reception, greet Bouncer, visit conference room, check Marcus desk, return to my desk.',
  'Patrol breakroom — coffee check — then visit Abby at her desk for a quick sync.',
  'Walk the open office floor, wave at Lucy, stop at CRM desk, return home.',
  'Meeting at conference — discuss fleet status — then back to desk.',
];

const ANNOUNCEMENTS = {
  grok: [
    'Grok online — cloud MCP patrol active.',
    'Patrolling the floor — home base watching mesh + CRM.',
    'Heading out on patrol — status pulse incoming.',
  ],
  claude: [
    'Claude online — verifying office systems via MCP patrol.',
    'Walking the floor — mentor check-in cycle.',
    'Patrol: reviewing team standup and open directives.',
  ],
};

let _timer = null;
let _running = false;

function log(...args) {
  console.log('[npc-mcp-cloud-patrol]', ...args);
}

function baseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || 'https://denizen.dolonia.cloud').replace(/\/+$/, '');
}

function loadTokenFile(npc) {
  const p = path.join(TOKEN_DIR, `${npc}-token.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(p, 'utf8'));
    return String(row.token || '').trim() || null;
  } catch (_) {
    return null;
  }
}

function saveTokenFile(npc, row) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(path.join(TOKEN_DIR, `${npc}-token.json`), JSON.stringify(row, null, 2) + '\n');
}

async function ensureTokens(orgId, createMcpToken) {
  const out = {};
  for (const npc of ['grok', 'claude']) {
    let token = loadTokenFile(npc);
    if (!token && createMcpToken && orgId) {
      try {
        const r = await createMcpToken({ orgId, npcKey: npc, label: 'cloud-patrol-loop' });
        saveTokenFile(npc, { token: r.token, token_id: r.token_id, mcp_url: r.mcp_url });
        token = r.token;
        log('minted token for', npc, r.token_id);
      } catch (e) {
        log('mint failed', npc, e?.message || e);
      }
    }
    out[npc] = token;
  }
  return out;
}

async function mcpCall(base, npc, token, tool, args = {}) {
  const url = `${base}/mcp/npc/${npc}`;
  const body = {
    jsonrpc: '2.0',
    id: `${npc}-${Date.now()}`,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) throw new Error(`${tool} HTTP ${res.status}`);
  const content = data?.result?.content?.[0]?.text;
  if (content) {
    try { return JSON.parse(content); } catch { return { text: content }; }
  }
  return data?.result || data;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function patrolNpc(base, npc, token) {
  if (!token) return { ok: false, reason: 'no_token' };
  const route = pick(PATROL_ROUTES);
  const announce = pick(ANNOUNCEMENTS[npc] || ANNOUNCEMENTS.grok);
  const steps = [];

  for (const [tool, args] of [
    ['team_standup', { include_crm: false, include_cursor: false }],
    ['announce_in_office', { message: announce }],
    ['assign_task', { task: route, urgent: Math.random() < 0.2 }],
  ]) {
    try {
      const r = await mcpCall(base, npc, token, tool, args);
      steps.push({ tool, ok: !!r?.ok });
    } catch (e) {
      steps.push({ tool, ok: false, error: String(e.message || e).slice(0, 80) });
    }
  }

  if (npc === 'grok' && Math.random() < 0.45) {
    try {
      await mcpCall(base, npc, token, 'run_skill', { skill: 'health-check' });
      steps.push({ tool: 'run_skill', ok: true });
    } catch (e) {
      steps.push({ tool: 'run_skill', ok: false });
    }
  }

  log(npc, 'patrol', JSON.stringify(steps));
  return { ok: true, steps };
}

async function runCycle(tokens) {
  if (_running) return;
  _running = true;
  try {
    const base = baseUrl();
    await Promise.allSettled([
      patrolNpc(base, 'grok', tokens.grok),
      patrolNpc(base, 'claude', tokens.claude),
    ]);
  } finally {
    _running = false;
  }
}

/**
 * @param {{ orgId: string, createMcpToken: Function }} deps
 */
async function startNpcMcpCloudPatrol(deps = {}) {
  if (_timer) return { ok: true, already: true };
  const tokens = await ensureTokens(deps.orgId, deps.createMcpToken);
  if (!tokens.grok && !tokens.claude) {
    log('disabled — no tokens');
    return { ok: false, reason: 'no_tokens' };
  }
  log('started', { intervalMs: INTERVAL_MS, grok: !!tokens.grok, claude: !!tokens.claude });
  setTimeout(() => runCycle(tokens), 15_000);
  _timer = setInterval(() => runCycle(tokens), INTERVAL_MS);
  _timer.unref?.();
  return { ok: true, intervalMs: INTERVAL_MS };
}

function stopNpcMcpCloudPatrol() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = {
  startNpcMcpCloudPatrol,
  stopNpcMcpCloudPatrol,
  runCycle,
  ensureTokens,
};
