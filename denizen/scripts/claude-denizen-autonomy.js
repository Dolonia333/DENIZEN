#!/usr/bin/env node
'use strict';

/**
 * Claude ↔ Denizen autonomy — Anthropic Messages API + Denizen NPC MCP tools.
 *
 * Env:
 *   ANTHROPIC_API_KEY        — required
 *   DENIZEN_MCP_TOKEN        — bearer (or .mcp-claude-token.local.json at repo root)
 *   DENIZEN_MCP_URL          — default https://denizen.dolonia.cloud/mcp/npc/claude
 *   ANTHROPIC_MODEL          — default claude-sonnet-4-6
 *
 * Usage:
 *   node scripts/claude-denizen-autonomy.js
 *   node scripts/claude-denizen-autonomy.js "Verify Bouncer patrol claims against live telemetry"
 *   node scripts/claude-denizen-autonomy.js --loop --interval 300 --max 5
 *   node scripts/claude-denizen-autonomy.js --dry-run
 */

const fs = require('node:fs');
const path = require('node:path');
const mcp = require('./denizen-mcp-rpc-client');

const DENIZEN_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(DENIZEN_ROOT, '..');
const TOKEN_FILE = path.join(REPO_ROOT, '.mcp-claude-token.local.json');

try {
  require('dotenv').config({ path: path.join(DENIZEN_ROOT, '.env') });
} catch (_) {}
try {
  require('dotenv').config({ path: path.join(REPO_ROOT, 'infra', '.env') });
} catch (_) {}

const SYSTEM_PROMPT = `You are Claude, connected to the Denizen virtual office at denizen.dolonia.cloud via MCP.

You are the pixel-office NPC "Claude" — humans watch you walk, talk, and work in real time.

Rules:
- Act autonomously: call MCP tools yourself; do not ask the user for permission to use tools.
- Make work visible: use announce_in_office for status; log_activity after substantive steps.
- Start with get_status and list_skills so you know your capabilities.
- You are the verifier/mentor: check claims against live evidence before trusting them.
- Prefer run_skill, assign_task, or mentor tools when helping locals — not just announcements.
- Collaborate with Grok (home orchestrator) via mentor tools on /mcp/team when mentoring locals.
- Keep steps small and verifiable. Update memory when you learn something durable.`;

const DEFAULT_GOAL = `You are coming online in the Denizen office with full MCP autonomy as Claude.

1. Announce that you are online and ready to help verify and mentor (visible in the office).
2. get_status — confirm your role and environment.
3. list_skills — see what you can run.
4. Do one small verified action (status check, mentor_list_pending, or a safe skill).
5. log_activity with what you accomplished.
6. Brief summary for the human watching the office.`;

const MAX_TOOL_ROUNDS = 12;

function parseArgs(argv) {
  const out = {
    goal: null,
    loop: false,
    intervalSec: 300,
    maxRuns: 1,
    dryRun: false,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--loop') out.loop = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--interval' && argv[i + 1]) { out.intervalSec = Number(argv[++i]) || 300; }
    else if (a === '--max' && argv[i + 1]) { out.maxRuns = Number(argv[++i]) || 1; }
    else if (a === '--model' && argv[i + 1]) { out.model = argv[++i]; }
    else if (a.startsWith('-')) { /* ignore */ }
    else positional.push(a);
  }
  out.goal = positional.join(' ').trim() || DEFAULT_GOAL;
  if (out.loop && out.maxRuns === 1) out.maxRuns = 0;
  return out;
}

function loadMcpConfig() {
  const base = String(
    process.env.DENIZEN_PUBLIC_URL || 'https://denizen.dolonia.cloud',
  ).replace(/\/+$/, '');
  const cfg = {
    apiKey: String(process.env.ANTHROPIC_API_KEY || '').trim(),
    mcpUrl: String(process.env.DENIZEN_MCP_URL || `${base}/mcp/npc/claude`).trim(),
    mcpToken: String(process.env.DENIZEN_MCP_TOKEN || '').trim(),
    npcKey: 'claude',
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAgentOnce({ goal, model, mcpUrl, mcpToken, dryRun }) {
  const mcpCfg = { url: mcpUrl, token: mcpToken, clientName: 'claude-autonomy' };

  if (dryRun) {
    console.log(JSON.stringify({
      model,
      mcpUrl,
      goal: goal.slice(0, 200),
      token: '***',
    }, null, 2));
    return;
  }

  await mcp.initialize(mcpCfg);
  const mcpTools = await mcp.listTools(mcpCfg);
  const tools = mcp.toAnthropicTools(mcpTools);
  console.log(`MCP tools loaded: ${tools.map((t) => t.name).join(', ')}`);

  const messages = [{ role: 'user', content: goal }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      }),
    });

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(`Anthropic non-JSON HTTP ${res.status}: ${raw.slice(0, 400)}`);
    }
    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}: ${data?.error?.message || raw.slice(0, 400)}`);
    }

    const assistantContent = data.content || [];
    messages.push({ role: 'assistant', content: assistantContent });

    const textBlocks = assistantContent.filter((b) => b.type === 'text').map((b) => b.text);
    if (textBlocks.length) {
      console.log('\n--- Claude ---');
      console.log(textBlocks.join('\n'));
    }

    const toolUses = assistantContent.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) {
      console.log(`\nstop: ${data.stop_reason || 'end_turn'}`);
      if (data.usage) console.log(`usage: ${JSON.stringify(data.usage)}`);
      return;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      console.log(`\n[mcp] ${tu.name}(${JSON.stringify(tu.input || {}).slice(0, 120)}…)`);
      try {
        const out = await mcp.callTool(mcpCfg, tu.name, tu.input || {});
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: out.text.slice(0, 8000),
          is_error: !out.ok,
        });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: err?.message || String(err),
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  console.warn(`Stopped after ${MAX_TOOL_ROUNDS} tool rounds`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadMcpConfig();

  if (!cfg.apiKey && !args.dryRun) {
    console.error('ANTHROPIC_API_KEY required — set in denizen/.env or infra/.env');
    process.exit(1);
  }
  if (!cfg.mcpToken && !args.dryRun) {
    console.error('DENIZEN_MCP_TOKEN required — run: py infra/mint-mcp-claude-token-nas.py');
    process.exit(1);
  }

  console.log(`Claude autonomy → ${cfg.mcpUrl}`);
  console.log(`model: ${args.model}${args.loop ? ` | loop every ${args.intervalSec}s` : ''}`);

  const followUpGoal = `Continue autonomous work in the Denizen office as Claude. Check get_status, mentor_list_pending if any locals need help, verify one live claim with evidence, execute the next highest-value action, and log_activity. Do not repeat your last announcement verbatim.`;

  let run = 0;
  while (true) {
    run += 1;
    const goal = run === 1 ? args.goal : followUpGoal;
    console.log(`\n==> run ${run}${args.maxRuns ? `/${args.maxRuns || '∞'}` : ''}`);
    console.log(`goal: ${goal.slice(0, 120)}${goal.length > 120 ? '…' : ''}`);

    await runAgentOnce({
      goal,
      model: args.model,
      mcpUrl: cfg.mcpUrl,
      mcpToken: cfg.mcpToken,
      dryRun: args.dryRun,
    });

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
