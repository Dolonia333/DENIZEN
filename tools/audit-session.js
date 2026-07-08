/**
 * audit-session.js — show all user messages + tool calls in a session transcript
 * Usage: node audit-session.js [sessionId]
 * If no sessionId given, lists all sessions.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'projects'
);

function listSessions() {
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  const sessions = [];
  for (const dir of dirs) {
    const files = fs.readdirSync(path.join(SESSIONS_DIR, dir))
      .filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      sessions.push({ project: dir, file: f, id: f.replace('.jsonl', '') });
    }
  }
  return sessions;
}

function auditSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch(_) {}
  }

  console.log(`\n=== AUDIT: ${path.basename(filePath)} ===\n`);

  for (const e of events) {
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '??:??:??';

    // User messages (could be human or agent-injected)
    if (e.type === 'user' && e.message?.content) {
      const content = typeof e.message.content === 'string'
        ? e.message.content.slice(0, 120)
        : '[tool result]';
      if (typeof e.message.content === 'string') {
        console.log(`[${ts}] 👤 USER MSG: ${content}`);
      }
    }

    // Queue operations (shows when messages were enqueued)
    if (e.type === 'queue-operation' && e.operation === 'enqueue') {
      const content = String(e.content || '').slice(0, 120);
      console.log(`[${ts}] 📥 QUEUED:   ${content}`);
    }

    // Tool calls made by assistant (what the AI did)
    if (e.message?.content && Array.isArray(e.message.content)) {
      for (const block of e.message.content) {
        if (block.type === 'tool_use') {
          const args = JSON.stringify(block.input || {}).slice(0, 80);
          console.log(`[${ts}] 🔧 TOOL:     ${block.name}(${args})`);
        }
      }
    }

    // Computer-use typing specifically
    if (e.message?.content && Array.isArray(e.message.content)) {
      for (const block of e.message.content) {
        if (block.type === 'tool_use' && block.name?.includes('type')) {
          console.log(`[${ts}] ⌨️  TYPED:    ${JSON.stringify(block.input?.text || '').slice(0, 100)}`);
        }
      }
    }
  }
}

// Main
const sessions = listSessions();
const arg = process.argv[2];

if (!arg) {
  console.log('Available sessions:\n');
  sessions.forEach((s, i) => console.log(`  ${i}: ${s.id}  (${s.project})`));
  console.log('\nRun: node audit-session.js <sessionId>');
} else {
  const match = sessions.find(s => s.id.includes(arg) || s.file.includes(arg));
  if (!match) {
    // Try as direct path
    if (fs.existsSync(arg)) return auditSession(arg);
    console.error('Session not found:', arg);
    process.exit(1);
  }
  auditSession(path.join(SESSIONS_DIR, match.project, match.file));
}
