#!/usr/bin/env node
'use strict';

/**
 * DENIZEN Fleet Dashboard
 * Real-time terminal control center for the 3-node autonomous mesh.
 *
 * Usage: node scripts/fleet-dashboard.js
 * Refresh every 1.5s. Ctrl-C to exit.
 *
 * Monitors:
 * - Fleet health from data/fleet-telemetry/node-*.json (Tailscale visible)
 * - Global friction & backlog from data/autonomy-backlog.jsonl + nas-friction
 * - Live events derived from current state
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FLEET_DIR = path.join(DATA_DIR, 'fleet-telemetry');
const BACKLOG_FILE = path.join(DATA_DIR, 'autonomy-backlog.jsonl');
const NAS_FRICTION_FILE = path.join(DATA_DIR, 'nas-friction.jsonl');
const DELEGATED_DIR = path.join(DATA_DIR, 'delegated-tasks');

const REFRESH_MS = 1500;
let logLines = [];

function color(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function readJsonlSafe(p, limit = 100) {
  try {
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function getFleetHealth() {
  const health = {};
  if (!fs.existsSync(FLEET_DIR)) return health;
  const files = fs.readdirSync(FLEET_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const data = readJsonSafe(path.join(FLEET_DIR, f));
    if (data) {
      const node = data.node || f.replace(/^node-/, '').replace(/\.json$/, '');
      health[node] = {
        loadPct: data.loadPct || 0,
        memUsedPct: data.memUsedPct || 0,
        storagePct: data.storagePct || 0,
        high: !!data.high,
        ts: data.ts,
        status: data.high ? 'COOLDOWN' : 'ACTIVE'
      };
    }
  }
  return health;
}

function getBacklogState() {
  const entries = readJsonlSafe(BACKLOG_FILE, 50);
  const pending = entries.filter(e => !e.status || e.status === 'pending' || e.status === 'in_progress');
  pending.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.friction_score || 0) - (a.friction_score || 0));
  const inProgress = pending.filter(e => e.status === 'in_progress');
  const escalated = entries.filter(e => e.status === 'failed_escalated').slice(-3);
  return { pending: pending.slice(0, 8), inProgress, escalated };
}

function getTopFriction() {
  const backlog = readJsonlSafe(BACKLOG_FILE, 30);
  const nas = readJsonlSafe(NAS_FRICTION_FILE, 20);
  const scores = {};

  // From backlog
  backlog.forEach(e => {
    if (e.domain && (e.friction_score || e.priority)) {
      const key = e.domain;
      scores[key] = (scores[key] || 0) + (e.friction_score || (e.priority * 3) || 0);
    }
  });

  // From NAS
  nas.forEach(n => {
    const key = `nas_${n.domain || 'general'}`;
    scores[key] = (scores[key] || 0) + (n.severity || 5);
  });

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([d, s]) => ({ domain: d, score: Math.round(s) }));
}

function getRecentEvents() {
  const now = Date.now();
  const events = [];

  // Current locks
  const backlog = readJsonlSafe(BACKLOG_FILE, 20);
  backlog.forEach(e => {
    if (e.status === 'in_progress' && e.acquired_by) {
      events.push(`[${new Date().toLocaleTimeString()}] LOCK: ${e.acquired_by} acquired ${e.domain || e.id}`);
    }
    if (e.status === 'delegated' || e.delegated_from) {
      events.push(`[${new Date().toLocaleTimeString()}] DELEGATE: ${e.domain} → ${e.delegated_to || 'peer'}`);
    }
  });

  // Cooldowns from fleet
  const health = getFleetHealth();
  Object.entries(health).forEach(([node, h]) => {
    if (h.high || h.status === 'COOLDOWN') {
      events.push(`[${new Date().toLocaleTimeString()}] COOLDOWN: ${node} (load=${h.loadPct}%)`);
    }
  });

  // Recent NAS
  const nas = readJsonlSafe(NAS_FRICTION_FILE, 5);
  nas.slice(-3).forEach(n => {
    events.push(`[${new Date(n.ts).toLocaleTimeString()}] NAS: ${n.domain} sev=${n.severity} ${n.note || ''}`);
  });

  // Keep rolling log
  logLines.push(...events);
  if (logLines.length > 12) logLines = logLines.slice(-12);

  return logLines;
}

function render() {
  clearScreen();
  const health = getFleetHealth();
  const backlog = getBacklogState();
  const friction = getTopFriction();
  const events = getRecentEvents();

  // Header
  console.log(color('╔════════════════════════════════════════════════════════════════════════════╗', 36));
  console.log(color('║  DENIZEN FLEET DASHBOARD  —  Real-Time Mesh Control Center                ║', 36));
  console.log(color(`║  Last refresh: ${new Date().toLocaleTimeString()}   |   Press Ctrl-C to exit                           ║`, 36));
  console.log(color('╚════════════════════════════════════════════════════════════════════════════╝', 36));
  console.log('');

  // Fleet Health Matrix
  console.log(color('┌─ FLEET HEALTH MATRIX ─────────────────────────────────────────────────────┐', 32));
  console.log(color('│ Node          │ Load% │ Mem% │ Disk% │ Status     │ Last Seen            │', 32));
  console.log(color('├───────────────┼───────┼───────┼───────┼────────────┼──────────────────────┤', 32));

  const nodes = Object.keys(health).length ? Object.keys(health) : ['nas', 'laptop', 'edge'];
  nodes.forEach(node => {
    const h = health[node] || { loadPct: 0, memUsedPct: 0, storagePct: 0, status: 'UNKNOWN', ts: '—' };
    const statusColor = h.status === 'COOLDOWN' ? 31 : (h.loadPct > 70 ? 33 : 32);
    const last = h.ts ? new Date(h.ts).toLocaleTimeString() : '—';
    const line = `│ ${node.padEnd(13)} │ ${String(h.loadPct).padStart(5)} │ ${String(h.memUsedPct).padStart(5)} │ ${String(h.storagePct).padStart(5)} │ ${color(h.status.padEnd(10), statusColor)} │ ${last.padEnd(20)} │`;
    console.log(color(line, 32));
  });
  console.log(color('└───────────────────────────────────────────────────────────────────────────┘', 32));
  console.log('');

  // Global Friction
  console.log(color('┌─ GLOBAL FRICTION TRACKER (top hot domains) ───────────────────────────────┐', 35));
  if (friction.length === 0) {
    console.log(color('│ No significant friction detected. Mesh is calm.                         │', 35));
  } else {
    friction.forEach(f => {
      const bar = '█'.repeat(Math.min(20, Math.floor(f.score / 3)));
      const line = `│ ${f.domain.padEnd(20)} ${String(f.score).padStart(3)} ${bar.padEnd(20)} │`;
      console.log(color(line, f.score > 30 ? 31 : (f.score > 15 ? 33 : 32)));
    });
  }
  console.log(color('└───────────────────────────────────────────────────────────────────────────┘', 35));
  console.log('');

  // Live Backlog & Mutex
  console.log(color('┌─ LIVE BACKLOG & MUTEX STATE ──────────────────────────────────────────────┐', 34));
  if (backlog.pending.length === 0) {
    console.log(color('│ Backlog empty. All systems nominal.                                       │', 34));
  } else {
    console.log(color('│ ID / Domain                    │ Prio │ Friction │ Status / Lock          │', 34));
    backlog.pending.forEach(item => {
      const id = (item.domain || item.id || '').slice(0, 28).padEnd(30);
      const prio = String(item.priority || 0).padStart(4);
      const fric = String(item.friction_score || 0).padStart(8);
      let lock = item.status || 'pending';
      if (item.acquired_by) lock += ` by ${item.acquired_by}`;
      if (item.status === 'failed_escalated') lock = color(lock, 31);
      const line = `│ ${id} │ ${prio} │ ${fric} │ ${lock.padEnd(22)} │`;
      console.log(color(line, 34));
    });
  }
  if (backlog.escalated && backlog.escalated.length) {
    console.log(color('│ ESCALATED: ' + backlog.escalated.map(e => e.id).join(', '), 31));
  }
  console.log(color('└───────────────────────────────────────────────────────────────────────────┘', 34));
  console.log('');

  // Mesh Cross-Talk Log
  console.log(color('┌─ MESH CROSS-TALK LOG (live events) ───────────────────────────────────────┐', 36));
  if (events.length === 0) {
    console.log(color('│ No recent events.                                                       │', 36));
  } else {
    events.slice(-8).forEach(line => {
      let c = 36;
      if (line.includes('COOLDOWN') || line.includes('COOLDOWN')) c = 31;
      if (line.includes('DELEGATE') || line.includes('delegated')) c = 33;
      if (line.includes('LOCK') || line.includes('acquired')) c = 32;
      console.log(color(`│ ${line.padEnd(75)} │`, c));
    });
  }
  console.log(color('└───────────────────────────────────────────────────────────────────────────┘', 36));
  console.log('');

  console.log(color('Legend: ', 90) + color('GREEN=healthy', 32) + '  ' + color('YELLOW=warning', 33) + '  ' + color('RED=critical/cooldown', 31));
  console.log(color('Data sources: fleet-telemetry/*.json + autonomy-backlog.jsonl + nas-friction.jsonl', 90));
}

function start() {
  console.log(color('Starting DENIZEN Fleet Dashboard... (Ctrl-C to quit)', 36));
  setInterval(() => {
    try {
      render();
    } catch (e) {
      console.error('Render error:', e.message);
    }
  }, REFRESH_MS);

  // Initial render
  setTimeout(render, 200);
}

if (require.main === module) {
  start();
}

module.exports = { render, getFleetHealth, getBacklogState };
