#!/usr/bin/env node
'use strict';
const WebSocket = require('ws');

const PRIMARY = (process.env.PRIMARY_URL || 'http://192.168.1.237:8888').replace(/\/+$/, '');
const FOLLOWER = (process.env.FOLLOWER_URL || 'http://192.168.1.237:8889').replace(/\/+$/, '');
const detail = `relay-smoke-${Date.now()}`;

function waitThreat(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { try { ws.terminate(); } catch (_) {} reject(new Error('timeout')); }, 12000);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'threat' && String(msg.detail || '').includes(detail)) {
          clearTimeout(t); ws.close(); resolve(msg);
        }
      } catch (_) {}
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

(async () => {
  const followerWs = FOLLOWER.replace(/^http/i, 'ws') + '/security-ws';
  console.log('follower ws:', followerWs);
  const waiter = waitThreat(followerWs);
  const res = await fetch(`${PRIMARY}/security-test?type=scan_probe&force=1&source=203.0.113.88&detail=${encodeURIComponent(detail)}`);
  console.log('primary trigger', res.status, await res.json());
  const msg = await waiter;
  console.log('OK relayed threat', msg.threatId, msg.category);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
