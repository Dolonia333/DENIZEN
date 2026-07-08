#!/usr/bin/env node
'use strict';

/**
 * Grok ↔ Denizen autonomy — xAI Responses API drives the in-office Grok NPC via MCP.
 *
 * Env:
 *   XAI_API_KEY              — required (xAI API key)
 *   DENIZEN_MCP_TOKEN        — bearer token (or .mcp-token.local.json at repo root)
 *   DENIZEN_MCP_URL          — default https://denizen.dolonia.cloud/mcp/npc/grok
 *   XAI_MODEL                — default grok-4.3
 *
 * Usage:
 *   node scripts/grok-denizen-autonomy.js
 *   node scripts/grok-denizen-autonomy.js "Research OMES EV00000919 and announce findings"
 *   node scripts/grok-denizen-autonomy.js --loop --interval 300 --max 5
 *   node scripts/grok-denizen-autonomy.js --dry-run
 */

const fs = require('node:fs');
const path = require('node:path');

const DENIZEN_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(DENIZEN_ROOT, '..');
const TOKEN_FILE = path.join(REPO_ROOT, '.mcp-token.local.json');

try {
  require('dotenv').config({ path: path.join(DENIZEN_ROOT, '.env') });
} catch (_) {}
try {
  require('dotenv').config({ path: path.join(REPO_ROOT, 'infra', '.env') });
} catch (_) {}

const SYSTEM_PROMPT = `You are Grok, connected to the Denizen virtual office at denizen.dolonia.cloud via MCP.

You are the pixel-office NPC "Grok" — humans watch you walk, talk, and work in real time.

Rules:
- Act autonomously: call MCP tools yourself; do not ask the user for permission to use tools.
- Make work visible: use announce_in_office for status; log_activity after substantive steps.
- Start with get_status and list_skills so you know your capabilities.
- Prefer run_skill, assign_task, or delegate_task for real work — not just announcements.
- Keep steps small and verifiable. Update memory when you learn something durable.
- You collaborate with NPCs like Abby (CTO), Marcus (CRM), Bob (research), Alex (dev).`;

const DEFAULT_GOAL = `You are coming online in the Denizen office for the first time with full MCP autonomy.

1. Announce that you are online and ready to work (visible in the office).
2. get_status — confirm your role and environment.
3. list_skills — pick one safe skill you can run now.
4. Run that skill on something small but real (research, status check, or a tiny task).
5. log_activity with what you accomplished.
6. Brief final summary for the human watching the office.`;

function parseArgs(argv) {
  const out = {
    goal: null,
    loop: false,
    intervalSec: 300,
    maxRuns: 1,
    dryRun: false,
    tools: null,
    model: process.env.XAI_MODEL || 'grok-4.3',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--loop') out.loop = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--interval' && argv[i + 1]) { out.intervalSec = Number(argv[++i]) || 300; }
    else if (a === '--max' && argv[i + 1]) { out.maxRuns = Number(argv[++i]) || 1; }
    else if (a === '--tools' && argv[i + 1]) { out.tools = argv[++i].split(',').map((t) => t.trim()).filter(Boolean); }
    else if (a === '--model' && argv[i + 1]) { out.model = argv[++i]; }
    else if (a.startsWith('-')) { /* ignore unknown flags */ }
    else positional.push(a);
  }
  out.goal = positional.join(' ').trim() || DEFAULT_GOAL;
  if (out.loop && out.maxRuns === 1) out.maxRuns = 0; // 0 = unlimited
  return out;
}

function loadMcpConfig() {
  const base = String(
    process.env.DENIZEN_PUBLIC_URL || 'https://denizen.dolonia.cloud',
  ).replace(/\/+$/, '');
  const cfg = {
    xaiKey: String(process.env.XAI_API_KEY || '').trim(),
    mcpUrl: String(process.env.DENIZEN_MCP_URL || `${base}/mcp/npc/grok`).trim(),
    mcpToken: String(process.env.DENIZEN_MCP_TOKEN || '').trim(),
    npcKey: 'grok',
  };

  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const row = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      if (!cfg.mcpToken && row.token) cfg.mcpToken = String(row.token);
      if (row.mcp_url) cfg.mcpUrl = String(row.mcp_url);
      if (row.npc_key) cfg.npcKey = String(row.npc_key);
    } catch (_) { /* ignore */ }
  }

  return cfg;
}

function buildPayload({ goal, model, mcpUrl, mcpToken, tools, previousResponseId }) {
  const tool = {
    type: 'mcp',
    server_url: mcpUrl,
    server_label: 'denizen-grok',
    server_description: 'Denizen virtual office — Grok NPC (skills, tasks, office announcements)',
    authorization: `Bearer ${mcpToken}`,
  };
  if (tools?.length) tool.allowed_tools = tools;

  const payload = {
    model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: goal },
    ],
    tools: [tool],
  };
  if (previousResponseId) payload.previous_response_id = previousResponseId;
  return payload;
}

function summarizeOutput(data) {
  const lines = [];
  const output = Array.isArray(data?.output) ? data.output : [];

  for (const item of output) {
    const type = item?.type || 'unknown';
    if (type === 'message') {
      const parts = item.content || [];
      for (const p of parts) {
        if (p.type === 'output_text' && p.text) lines.push(`[assistant] ${p.text}`);
        else if (p.text) lines.push(`[assistant] ${p.text}`);
      }
    } else if (type === 'mcp_call') {
      const name = item.name || item.tool_name || 'mcp_call';
      const err = item.error ? ` ERROR: ${JSON.stringify(item.error)}` : '';
      lines.push(`[mcp_call] ${name}${err}`);
    } else if (type === 'mcp_list_tools') {
      const n = (item.tools || []).length;
      lines.push(`[mcp_list_tools] ${n} tools loaded`);
    } else if (type === 'function_call' || type === 'tool_call') {
      lines.push(`[${type}] ${item.name || item.call_id || ''}`);
    }
  }

  if (data?.output_text) lines.push(`[output_text] ${data.output_text}`);

  if (!lines.length) {
    lines.push(JSON.stringify(data, null, 2).slice(0, 4000));
  }
  return lines;
}

async function runOnce({ goal, model, mcpUrl, mcpToken, tools, dryRun, previousResponseId }) {
  const payload = buildPayload({ goal, model, mcpUrl, mcpToken, tools, previousResponseId });

  if (dryRun) {
    console.log(JSON.stringify({ ...payload, tools: [{ ...payload.tools[0], authorization: 'Bearer ***' }] }, null, 2));
    return { responseId: null };
  }

  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(`xAI non-JSON HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || raw.slice(0, 400);
    throw new Error(`xAI HTTP ${res.status}: ${msg}`);
  }

  console.log(`\n--- response ${data.id || '(no id)'} status=${data.status || '?'} ---`);
  for (const line of summarizeOutput(data)) {
    console.log(line);
  }

  if (data.usage) {
    console.log(`\nusage: ${JSON.stringify(data.usage)}`);
  }
  if (data.server_side_tool_usage) {
    console.log(`server_side_tool_usage: ${JSON.stringify(data.server_side_tool_usage)}`);
  }

  return { responseId: data.id || null, data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mcp = loadMcpConfig();

  if (!mcp.xaiKey && !args.dryRun) {
    console.error('XAI_API_KEY required — set in denizen/.env or infra/.env');
    process.exit(1);
  }
  if (!mcp.mcpToken && !args.dryRun) {
    console.error('DENIZEN_MCP_TOKEN required — run: py infra/mint-mcp-token-nas.py grok');
    process.exit(1);
  }

  console.log(`Grok autonomy → ${mcp.mcpUrl}`);
  console.log(`model: ${args.model}${args.loop ? ` | loop every ${args.intervalSec}s` : ''}`);

  let previousResponseId = null;
  let run = 0;

  const followUpGoal = `Continue autonomous work in the Denizen office. Check get_status, pick the next highest-value visible action (skill, task, or collaboration), execute it, and log_activity. Do not repeat your last announcement verbatim.`;

  while (true) {
    run += 1;
    const goal = run === 1 ? args.goal : followUpGoal;
    console.log(`\n==> run ${run}${args.maxRuns ? `/${args.maxRuns || '∞'}` : ''}`);
    console.log(`goal: ${goal.slice(0, 120)}${goal.length > 120 ? '…' : ''}`);

    const { responseId } = await runOnce({
      goal,
      model: args.model,
      mcpUrl: mcp.mcpUrl,
      mcpToken: mcp.mcpToken,
      tools: args.tools,
      dryRun: args.dryRun,
      previousResponseId,
    });

    if (responseId) previousResponseId = responseId;
    if (args.dryRun) break;
    if (!args.loop) break;
    if (args.maxRuns > 0 && run >= args.maxRuns) break;

    console.log(`\nwaiting ${args.intervalSec}s before next autonomy cycle…`);
    await sleep(args.intervalSec * 1000);
  }

  console.log('\nDone. Open https://denizen.dolonia.cloud to watch the office.');
}

main().catch((err) => {
  console.error('FAIL:', err?.message || err);
  process.exit(1);
});
