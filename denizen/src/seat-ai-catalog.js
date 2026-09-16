'use strict';

/**
 * Seat an AI — provider catalog + seated/detect helpers.
 * Browser UI lives in seat-ai.js; Desktop and /api/seat-ai reuse this.
 */

const { execFileSync } = require('node:child_process');
const http = require('node:http');

const PROVIDERS = [
  {
    id: 'cursor',
    label: 'Cursor',
    desk: 'Cursor work queue',
    npcKeys: ['_team'],
    binaries: ['cursor', 'cursor-agent'],
    connect: 'team',
    hint: 'Seat Cursor with team MCP. Same subscription you already pay for.',
  },
  {
    id: 'claude',
    label: 'Claude',
    desk: 'Claude',
    npcKeys: ['claude'],
    binaries: ['claude'],
    connect: 'npc',
    hint: 'Claude Code or Claude.ai — one desk, no new API bill.',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    desk: 'Team inbox',
    npcKeys: ['_team'],
    binaries: [],
    connect: 'team',
    hint: 'Custom GPT polls handoffs. Seat via team MCP.',
  },
  {
    id: 'grok',
    label: 'Grok',
    desk: 'Grok',
    npcKeys: ['grok'],
    binaries: ['grok'],
    connect: 'npc',
    hint: 'Grok CLI uses your existing login.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    desk: 'Local models',
    npcKeys: [],
    binaries: [],
    connect: 'local',
    hint: 'Local models stay on this machine. Office staff can use them when reachable.',
  },
  {
    id: 'codex',
    label: 'Codex',
    desk: 'Coding worktrees',
    npcKeys: [],
    binaries: ['codex'],
    connect: 'later',
    hint: 'Detected if installed. Seating Codex as a first-class desk is next.',
  },
];

function whichBinary(cmd) {
  const name = String(cmd || '').trim();
  if (!name || /[^a-zA-Z0-9._-]/.test(name)) return null;
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(bin, [name], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    }).trim();
    return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
  } catch (_) {
    return null;
  }
}

function detectBinaries(cmds = []) {
  const found = {};
  for (const cmd of cmds) {
    found[cmd] = whichBinary(cmd);
  }
  return found;
}

function detectLocalTools() {
  const binaries = detectBinaries(['claude', 'grok', 'cursor', 'cursor-agent', 'codex']);
  return {
    claude: binaries.claude,
    grok: binaries.grok,
    cursor: binaries.cursor || binaries['cursor-agent'],
    codex: binaries.codex,
  };
}

function probeLmStudio(url = 'http://127.0.0.1:1234/v1/models', timeoutMs = 700) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        res.resume();
        done({ reachable: ok, status: res.statusCode || 0 });
      });
      req.on('timeout', () => { req.destroy(); done({ reachable: false, status: 0 }); });
      req.on('error', () => done({ reachable: false, status: 0 }));
    } catch (_) {
      done({ reachable: false, status: 0 });
    }
  });
}

function tokenNpcKeys(tokens = []) {
  const keys = new Set();
  for (const tok of tokens || []) {
    const npc = String(tok.npc_key || tok.npcKey || '').toLowerCase().trim();
    if (npc) keys.add(npc);
    const client = String(tok.client_type || tok.clientType || tok.label || '').toLowerCase();
    if (client.includes('cursor')) keys.add('_team');
    if (client.includes('chatgpt') || client.includes('gpt')) keys.add('_team');
  }
  return keys;
}

function providersWithStatus({ tokens = [], detected = {}, lmStudio = null } = {}) {
  const keys = tokenNpcKeys(tokens);
  const teamSeated = keys.has('_team');
  return PROVIDERS.map((p) => {
    const seatedByToken = p.npcKeys.some((k) => keys.has(k)) || (p.connect === 'team' && teamSeated);
    const foundBin = p.binaries.some((b) => detected[b] || detected[p.id]);
    const localUp = p.id === 'lmstudio' && !!lmStudio?.reachable;
    return {
      id: p.id,
      label: p.label,
      desk: p.desk,
      connect: p.connect,
      hint: p.hint,
      seated: seatedByToken || (p.connect === 'local' && localUp),
      detected: foundBin || localUp,
      detectedPath: p.binaries.map((b) => detected[b] || detected[p.id]).find(Boolean) || null,
    };
  });
}

function buildCrewRows({ roster, directives = [], presenceAtNpc } = {}) {
  const byNpc = {};
  for (const d of directives || []) {
    const name = String(d.npc || '').trim();
    if (name && !byNpc[name]) byNpc[name] = d;
  }
  return (roster?.entries || []).map((e) => {
    const mcpAt = typeof presenceAtNpc === 'function' ? presenceAtNpc(e.folder) : null;
    const dir = byNpc[e.display];
    const seated = !!mcpAt;
    return {
      name: e.display,
      key: e.folder,
      seated,
      status: dir?.status || (seated ? 'seated' : 'empty'),
      task: String(dir?.task || '').slice(0, 120),
      mcp_at: mcpAt,
    };
  });
}

function leashFromStats(stats = {}) {
  const errorRate = Number(stats.errorRate || 0);
  const top = Array.isArray(stats.topErrors) ? stats.topErrors : [];
  const circuit = top.find((e) => e.category === 'circuit_breaker');
  const hot = Object.entries(stats.byNpc || {})
    .filter(([, v]) => (v?.errors || 0) >= 3 || (v?.calls || 0) > 40)
    .map(([npc, v]) => ({ npc, calls: v.calls, errors: v.errors }));
  let state = 'ok';
  if (circuit || errorRate >= 0.45) state = 'stop';
  else if (hot.length || errorRate >= 0.2) state = 'constrain';
  else if ((stats.calls || 0) > 20 && (stats.promptToCompletionRatio || 0) > 25) state = 'steer';
  const notes = {
    ok: 'Abby handles routine routing. Spend, destructive ops, and scope changes wait for you.',
    steer: 'Context is getting heavy — trim history or pause looping staff.',
    constrain: 'Errors or retries are stacking. Constrain the hot desks before they run away.',
    stop: 'Circuit breaker is cooling someone down. Stop and look before sending more work.',
  };
  return {
    state,
    note: notes[state],
    errorRate,
    circuit: circuit || null,
    hot,
  };
}

module.exports = {
  PROVIDERS,
  whichBinary,
  detectBinaries,
  detectLocalTools,
  probeLmStudio,
  tokenNpcKeys,
  providersWithStatus,
  leashFromStats,
  buildCrewRows,
};
