#!/usr/bin/env node
'use strict';

/**
 * WS load soak — open N synthetic /agent-ws connections and report stats.
 *
 * Usage:
 *   node scripts/ws-load-soak.js
 *   WS_URL=ws://<NAS_IP>:8889/agent-ws COUNT=50 node scripts/ws-load-soak.js
 */

const WebSocket = require('ws');

const TARGET = (process.env.WS_URL || process.env.SPECTATE_WS_URL || (console.error('Set WS_URL'), process.exit(1))).trim();
const COUNT = Math.max(1, Number(process.env.COUNT) || 50);
const RAMP_MS = Number(process.env.RAMP_MS) || 40;
const HOLD_MS = Number(process.env.HOLD_MS) || 15000;
const HEALTH_URL = (process.env.HEALTH_URL || TARGET.replace(/^ws/i, 'http').replace(/\/agent-ws$/, '/api/health')).trim();

const stats = {
  opened: 0,
  closed: 0,
  errors: 0,
  messages: 0,
  capacity: 0,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHealth() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10000) });
    return res.ok ? res.json() : null;
  } catch (_) {
    return null;
  }
}

async function main() {
  console.log('==> ws-load-soak');
  console.log(`    target: ${TARGET}`);
  console.log(`    count:  ${COUNT}`);

  const before = await fetchHealth();
  if (before?.ws) {
    console.log(`    health before: agent=${before.ws.agent} max=${before.ws.max} util=${before.ws.utilization}`);
  }

  const sockets = [];
  for (let i = 0; i < COUNT; i += 1) {
    await sleep(RAMP_MS);
    const ws = new WebSocket(TARGET);
    ws.on('open', () => { stats.opened += 1; });
    ws.on('message', () => { stats.messages += 1; });
    ws.on('error', () => { stats.errors += 1; });
    ws.on('close', (code) => {
      stats.closed += 1;
      if (code === 1013) stats.capacity += 1;
    });
    sockets.push(ws);
  }

  await sleep(HOLD_MS);

  const during = await fetchHealth();
  if (during?.ws) {
    console.log(`    health during: agent=${during.ws.agent} max=${during.ws.max} util=${during.ws.utilization}`);
  }
  if (during?.worldPubsub?.metrics) {
    console.log(`    pubsub: published=${during.worldPubsub.metrics.published} received=${during.worldPubsub.metrics.received} lagMs=${during.worldPubsub.metrics.lastLagMs}`);
  }

  const openDuringHold = sockets.filter((ws) => ws.readyState === WebSocket.OPEN).length;
  const dropDuringHold = COUNT - openDuringHold;
  const dropRate = COUNT > 0 ? dropDuringHold / COUNT : 0;

  for (const ws of sockets) {
    try { ws.close(1000, 'soak done'); } catch (_) {}
  }
  await sleep(500);

  console.log('    stats:', {
    ...stats,
    openDuringHold,
    dropDuringHold,
    dropRate: Number(dropRate.toFixed(4)),
  });

  if (dropRate > 0.05 && stats.capacity === 0) {
    console.error('WARN: >5% disconnect during hold without capacity code');
    process.exit(1);
  }
  console.log('==> ws-load-soak OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
