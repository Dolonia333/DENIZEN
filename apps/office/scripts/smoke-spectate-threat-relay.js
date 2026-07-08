#!/usr/bin/env node
'use strict';
const WebSocket = require('ws');
const PRIMARY = 'https://denizen.dolonia.cloud';
const SPECTATE_WS = 'wss://spectate.dolonia.cloud/agent-ws';
const detail = `spectate-relay-${Date.now()}`;

(async () => {
  console.log('connect', SPECTATE_WS);
  const ws = new WebSocket(SPECTATE_WS);
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
    setTimeout(() => rej(new Error('open timeout')), 10000);
  });
  console.log('open, triggering primary');
  const got = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no threat in 15s')), 15000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'threat' && String(msg.detail || '').includes(detail)) {
        clearTimeout(t);
        resolve(msg);
      }
    });
  });
  const r = await fetch(`${PRIMARY}/security-test?type=scan_probe&force=1&source=203.0.113.66&detail=${encodeURIComponent(detail)}`);
  console.log('trigger', r.status);
  const msg = await got;
  console.log('OK', msg.threatId, msg.category);
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
