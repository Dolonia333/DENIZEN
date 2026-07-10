'use strict';

/**
 * Player chat via local Claude Code CLI (`claude -p`) + denizen-claude MCP on the operator PC.
 *
 * Routing (first match wins):
 *   1. Spawn CLAUDE_BIN on this machine (dev server on PC)
 *   2. POST CLAUDE_CLI_BRIDGE_URL (PC bridge — see infra/run-claude-cli-chat-bridge.py)
 *   3. Mesh job claude_cli_chat → CLAUDE_CLI_MESH_NODE (PC compute node worker)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_CHAT_TIMEOUT_MS) || 180_000;
const POLL_MS = 350;

function defaultClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === 'win32') {
    const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
    if (fs.existsSync(local)) return local;
    return 'claude';
  }
  return 'claude';
}

function claudeBinAvailable(bin = defaultClaudeBin()) {
  try {
    if (bin === 'claude' || bin === 'claude.exe') return true;
    return fs.existsSync(bin);
  } catch (_) {
    return false;
  }
}

function formatMessagesForPrompt(messages = []) {
  return messages.map((m) => {
    const role = String(m.role || m.from || 'user').toLowerCase();
    const label = role === 'assistant' || role === 'npc' ? 'Claude' : 'CEO';
    const text = String(m.content || m.text || '').trim();
    return `${label}: ${text}`;
  }).filter((line) => line.length > 6).join('\n');
}

function buildPlayerChatPrompt(systemPrompt, messages, latestUserLine = '') {
  const history = formatMessagesForPrompt(messages);
  const tail = String(latestUserLine || '').trim();
  return (
    `${String(systemPrompt || '').trim()}\n\n`
    + 'You are Claude in the Denizen pixel office. The CEO is chatting with you in-game. '
    + 'Use the denizen-claude MCP server when you need live office tools '
    + '(get_status, announce_in_office, run_skill, log_activity, mentor tools).\n\n'
    + (history ? `## Recent chat\n${history}\n\n` : '')
    + `## Latest message from CEO\n${tail || '(empty)'}\n\n`
    + 'Reply in character — concise, helpful, no markdown fences unless needed. '
    + 'Answer simple questions directly (including whether you are subscription Claude CLI vs local LM). '
    + 'Do not mention that you are a CLI unless asked.'
  );
}

function runClaudeCliPrompt(prompt, opts = {}) {
  const claudeBin = opts.claudeBin || defaultClaudeBin();
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const cwd = opts.cwd || path.join(__dirname, '..');

  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--append-system-prompt',
      String(opts.appendSystemPrompt
        || 'You have denizen-claude MCP. Use tools when the CEO asks for office actions.')];
    const proc = spawn(claudeBin, args, {
      cwd,
      windowsHide: true,
      env: process.env,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Claude CLI chat timed out'));
    }, timeoutMs);
    proc.stdout?.on('data', (c) => { stdout += c; });
    proc.stderr?.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = stdout.trim();
      if (!out) {
        reject(new Error(stderr.trim() || `Claude CLI exited ${code} with no output`));
        return;
      }
      resolve(out);
    });
  });
}

async function runViaBridge(opts = {}) {
  const base = String(opts.bridgeUrl || process.env.CLAUDE_CLI_BRIDGE_URL || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('CLAUDE_CLI_BRIDGE_URL not set');
  const url = base.endsWith('/chat') ? base : `${base}/chat`;
  const token = String(opts.bridgeToken || process.env.CLAUDE_CLI_BRIDGE_TOKEN || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      system_prompt: opts.systemPrompt || '',
      messages: opts.messages || [],
      timeout_ms: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(Math.max(10000, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS) + 5000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `Bridge HTTP ${res.status}`);
  }
  const text = String(body.text || '').trim();
  if (!text) throw new Error('Claude CLI bridge returned empty text');
  return text;
}

async function waitForMeshJob(jobId, timeoutMs) {
  const computeQueue = require('./denizen-compute-queue');
  const deadline = Date.now() + Math.max(5000, timeoutMs);
  while (Date.now() < deadline) {
    const job = await computeQueue.getJobById(jobId);
    if (!job) throw new Error('claude_cli_chat job disappeared');
    if (job.status === 'done') {
      const text = String(job.result?.text || job.result?.content || '').trim();
      if (!text) throw new Error('claude_cli_chat job returned no text');
      return text;
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'claude_cli_chat job failed');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('claude_cli_chat timed out waiting for PC node');
}

async function runViaMesh(opts = {}) {
  const computeQueue = require('./denizen-compute-queue');
  if (!computeQueue.isEnabled?.()) throw new Error('Compute queue disabled');
  const target = String(
    opts.meshNodeId
    || process.env.CLAUDE_CLI_MESH_NODE
    || process.env.CLAUDE_CLI_MESH_MACHINE_ID
    || '',
  ).trim();
  if (!target) throw new Error('CLAUDE_CLI_MESH_NODE not set');

  const job = await computeQueue.enqueueJob({
    jobType: 'claude_cli_chat',
    priority: opts.priority === 'high' ? 95 : 85,
    payload: {
      target_machine_id: target,
      system_prompt: opts.systemPrompt || '',
      messages: opts.messages || [],
      timeout_ms: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      source: 'player_chat',
    },
  });
  if (!job?.id) throw new Error('Failed to enqueue claude_cli_chat');
  return waitForMeshJob(job.id, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
}

/**
 * Complete a player-chat turn via Claude CLI (local, bridge, or mesh).
 */
async function completePlayerChat(opts = {}) {
  const messages = Array.isArray(opts.messages) ? opts.messages : [];
  const latest = [...messages].reverse().find((m) => {
    const role = String(m.role || '').toLowerCase();
    return role === 'user' || !m.role;
  });
  const latestLine = String(latest?.content || latest?.text || opts.userMessage || '').trim();
  const prompt = buildPlayerChatPrompt(opts.systemPrompt, messages, latestLine);
  const runOpts = {
    claudeBin: opts.claudeBin,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    appendSystemPrompt: 'You have denizen-claude MCP. Use tools when the CEO asks for office actions.',
  };

  if (opts.prefer === 'bridge' || (!opts.prefer && process.env.CLAUDE_CLI_BRIDGE_URL)) {
    try {
      return await runViaBridge({ ...opts, systemPrompt: opts.systemPrompt, messages });
    } catch (bridgeErr) {
      if (opts.prefer === 'bridge') throw bridgeErr;
    }
  }

  if (opts.prefer === 'mesh' || process.env.CLAUDE_CLI_MESH_NODE) {
    try {
      return await runViaMesh(opts);
    } catch (meshErr) {
      if (opts.prefer === 'mesh') throw meshErr;
    }
  }

  if (opts.prefer === 'local' || claudeBinAvailable(runOpts.claudeBin)) {
    try {
      return await runClaudeCliPrompt(prompt, runOpts);
    } catch (localErr) {
      if (opts.prefer === 'local') throw localErr;
    }
  }

  if (process.env.CLAUDE_CLI_BRIDGE_URL) {
    return runViaBridge({ ...opts, systemPrompt: opts.systemPrompt, messages });
  }

  if (process.env.CLAUDE_CLI_MESH_NODE) {
    return runViaMesh(opts);
  }

  throw new Error(
    'Claude CLI chat unavailable — run infra/run-claude-cli-chat-bridge.py on your PC '
    + 'and set CLAUDE_CLI_BRIDGE_URL on the server, or set CLAUDE_CLI_MESH_NODE.',
  );
}

module.exports = {
  defaultClaudeBin,
  claudeBinAvailable,
  buildPlayerChatPrompt,
  formatMessagesForPrompt,
  runClaudeCliPrompt,
  runViaBridge,
  runViaMesh,
  completePlayerChat,
};
