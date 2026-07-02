#!/usr/bin/env node
'use strict';

/**
 * Smoke: primary publishes agent frame → Redis → follower receives.
 *
 * Usage:
 *   PRIMARY_URL=http://127.0.0.1:8888 FOLLOWER_URL=http://127.0.0.1:8889 node scripts/smoke-spectate-relay.js
 */

const { spawnSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PRIMARY = (process.env.PRIMARY_URL || process.env.DENIZEN_PRIMARY_URL || 'http://192.168.1.237:8888').replace(/\/+$/, '');
const FOLLOWER = (process.env.FOLLOWER_URL || process.env.DENIZEN_FOLLOWER_URL || 'http://192.168.1.237:8889').replace(/\/+$/, '');
const FOLLOWER_WS = (process.env.FOLLOWER_WS_URL || FOLLOWER.replace(/^http/i, 'ws') + '/agent-ws').trim();
const SKIP_LIVE = process.env.SKIP_LIVE_RELAY === '1';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function publishSmokeFrame() {
  const infra = path.resolve(__dirname, '../../infra/publish-relay-smoke-nas.py');
  const py = process.env.PYTHON || 'py';
  const proc = spawnSync(py, [infra], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf-8',
    timeout: 30000,
  });
  if (proc.status !== 0) {
    console.warn('WARN: publish-relay-smoke-nas.py failed:', proc.stderr || proc.stdout);
    return false;
  }
  console.log((proc.stdout || '').trim());
  return true;
}

function waitForRelayFrame(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(FOLLOWER_WS);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch (_) {}
      reject(new Error('timeout waiting for relay_smoke_test on follower WS'));
    }, timeoutMs);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'relay_smoke_test') {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  console.log('==> smoke-spectate-relay');
  const primaryHealth = await getJson(`${PRIMARY}/api/health`);
  if (!primaryHealth.ok) {
    console.error('Primary health failed', primaryHealth.status);
    process.exit(1);
  }
  console.log('Primary role:', primaryHealth.data?.server?.role);
  console.log('Primary pubsub:', primaryHealth.data?.worldPubsub);

  const followerHealth = await getJson(`${FOLLOWER}/api/health`);
  if (!followerHealth.ok) {
    console.error('Follower health failed', followerHealth.status);
    process.exit(1);
  }
  console.log('Follower role:', followerHealth.data?.server?.role);
  console.log('Follower pubsub:', followerHealth.data?.worldPubsub);

  if (followerHealth.data?.server?.role !== 'follower') {
    console.warn('WARN: follower not role=follower');
  }

  const runtime = await getJson(`${PRIMARY}/api/public/runtime-config`);
  console.log('Runtime config:', runtime.data);

  const proxied = await getJson(`${FOLLOWER}/api/world-state`);
  if (!proxied.ok) {
    console.error('Follower world-state proxy failed', proxied.status, proxied.data);
    process.exit(1);
  }
  console.log('Follower proxied world-state keys:', Object.keys(proxied.data || {}));

  const wsPrimary = primaryHealth.data?.worldPubsub;
  const wsFollower = followerHealth.data?.worldPubsub;
  if (wsPrimary?.driver !== 'redis' || !wsPrimary?.connected) {
    console.error('Primary Redis pubsub not connected');
    process.exit(1);
  }
  if (wsFollower?.driver !== 'redis' || !wsFollower?.connected) {
    console.error('Follower Redis pubsub not connected');
    process.exit(1);
  }

  if (!SKIP_LIVE) {
    console.log('Live relay test:', FOLLOWER_WS);
    const waiter = waitForRelayFrame();
    await new Promise((r) => setTimeout(r, 500));
    if (!publishSmokeFrame()) {
      console.warn('SKIP live relay — could not publish test frame (set SKIP_LIVE_RELAY=1 to silence)');
    } else {
      const frame = await waiter;
      console.log('OK live relay frame:', frame.type, frame.id);
    }
  }

  console.log('==> smoke-spectate-relay OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
