#!/usr/bin/env node
'use strict';

/**
 * Bouncer + security visualization smoke test.
 *
 * Usage:
 *   node scripts/smoke-bouncer-e2e.js
 *   DENIZEN_URL=https://denizen.dolonia.cloud node scripts/smoke-bouncer-e2e.js
 *   FOLLOWER_URL=https://spectate.dolonia.cloud node scripts/smoke-bouncer-e2e.js
 */

const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const BASE = (process.env.DENIZEN_URL || process.env.PRIMARY_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const FOLLOWER = (process.env.FOLLOWER_URL || '').replace(/\/+$/, '');
const INVESTIGATION_URL = (process.env.BOUNCER_INVESTIGATION_URL || '').replace(/\/+$/, '');
const INTERNAL_TOKEN = (process.env.DENIZEN_INTERNAL_API_TOKEN || '').trim();
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 25000;

function smokeHeaders() {
  return INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {};
}

let failed = 0;

function pass(label) {
  console.log(`  OK  ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(` FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function isPublicSpectateHost(host) {
  return /spectate/i.test(host);
}

async function getJson(url, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: smokeHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function waitForSecurityThreat(wsUrl, expectDetail, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch (_) {}
      reject(new Error(`timeout waiting for threat on ${wsUrl}`));
    }, timeoutMs);

    const onMessage = (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type !== 'threat') return;
        if (expectDetail && !String(msg.detail || '').includes(expectDetail)) return;
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      } catch (_) {}
    };

    ws.on('open', () => {
      ws.on('message', onMessage);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runSecurityWsThreatTest(wsUrl, detail, triggerUrl, timeoutMs) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`security-ws open timeout: ${wsUrl}`)), timeoutMs);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (err) => { clearTimeout(t); reject(err); });
  });

  const threatPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { ws.terminate(); } catch (_) {}
      reject(new Error(`timeout waiting for threat on ${wsUrl}`));
    }, timeoutMs);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type !== 'threat') return;
        if (detail && !String(msg.detail || '').includes(detail)) return;
        clearTimeout(t);
        ws.close();
        resolve(msg);
      } catch (_) {}
    });
  });

  const res = await fetch(triggerUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: smokeHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    try { ws.close(); } catch (_) {}
    throw new Error(`security-test HTTP ${res.status}`);
  }
  return threatPromise;
}

async function runAgentWsThreatTest(wsUrl, detail, triggerUrl, timeoutMs) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`agent-ws open timeout: ${wsUrl}`)), timeoutMs);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (err) => { clearTimeout(t); reject(err); });
  });

  const threatPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { ws.terminate(); } catch (_) {}
      reject(new Error(`timeout waiting for threat on ${wsUrl}`));
    }, timeoutMs);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type !== 'threat') return;
        if (detail && !String(msg.detail || '').includes(detail)) return;
        clearTimeout(t);
        ws.close();
        resolve(msg);
      } catch (_) {}
    });
  });

  const res = await fetch(triggerUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: smokeHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    try { ws.close(); } catch (_) {}
    throw new Error(`security-test HTTP ${res.status}`);
  }
  return threatPromise;
}

async function checkHealth(host, label) {
  const health = await getJson(`${host}/api/health`);
  if (!health.ok) {
    fail(`${label} /api/health`, `HTTP ${health.status}`);
    return null;
  }
  pass(`${label} /api/health`);
  const b = health.data?.bouncer;
  if (!b) {
    fail(`${label} bouncer health block`, 'missing');
  } else {
    pass(`${label} bouncer.patrolEnabled=${b.patrolEnabled} relayOnly=${b.relayOnly}`);
    if (b.investigationConfigured) {
      pass(`${label} investigation URL configured`);
    } else if (!b.relayOnly && !b.wslLocal) {
      fail(`${label} investigation`, 'BOUNCER_INVESTIGATION_URL not set on non-WSL host');
    }
  }
  const secClients = health.data?.ws?.security ?? health.data?.wsClients?.security;
  if (typeof secClients === 'number') {
    pass(`${label} security ws clients=${secClients}`);
  }
  return health.data;
}

async function checkSecurityTest(host, label, marker, opts = {}) {
  const retries = Number(opts.retries ?? 0);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const attemptLabel = attempt ? `${label} (retry ${attempt})` : label;
    const ok = await checkSecurityTestOnce(host, attemptLabel, marker, opts);
    if (ok) return;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function checkSecurityTestOnce(host, label, marker, opts = {}) {
  const wsBase = host.replace(/^http/i, 'ws');
  const useAgentWs = !!opts.useAgentWs;
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  const wsUrl = useAgentWs ? `${wsBase}/agent-ws` : `${wsBase}/security-ws`;
  const detail = `smoke-${marker}-${Date.now()}`;
  const sourceOctet = 50 + (marker.length % 150);
  const triggerHost = opts.triggerHost || host;
  const triggerUrl = `${triggerHost}/security-test?type=scan_probe&severity=high&force=1&source=203.0.113.${sourceOctet}&detail=${encodeURIComponent(detail)}`;
  const channel = useAgentWs ? 'agent-ws' : 'security-ws';

  try {
    const msg = useAgentWs
      ? await runAgentWsThreatTest(wsUrl, detail, triggerUrl, timeoutMs)
      : await runSecurityWsThreatTest(wsUrl, detail, triggerUrl, timeoutMs);
    pass(`${label} /security-test triggered (${triggerHost})`);
    if (msg?.category !== 'scan_probe') {
      fail(`${label} ${channel} threat`, `unexpected category ${msg?.category}`);
      return;
    }
    pass(`${label} ${channel} received threat (${msg.threatId || 'no-id'})`);
    return true;
  } catch (err) {
    fail(`${label} ${channel} threat`, err?.message || String(err));
    return false;
  }
}

async function checkInvestigationAgent() {
  if (!INVESTIGATION_URL) return;
  const health = await getJson(`${INVESTIGATION_URL}/api/health`);
  if (!health.ok || !health.data?.ok) {
    fail('investigation agent /api/health', `HTTP ${health.status}`);
    return;
  }
  pass(`investigation agent wsl=${health.data.wsl}`);
}

async function main() {
  console.log('==> smoke-bouncer-e2e');
  console.log(`    primary: ${BASE}`);
  if (FOLLOWER) console.log(`    follower: ${FOLLOWER}`);

  try {
    await checkHealth(BASE, 'primary');
    await checkInvestigationAgent();
    await checkSecurityTest(BASE, 'primary', 'primary');

    if (FOLLOWER) {
      await checkHealth(FOLLOWER, 'follower');
      const isSpectateFollower = isPublicSpectateHost(FOLLOWER);
      const triggerHost = isSpectateFollower ? BASE : FOLLOWER;
      if (isSpectateFollower) {
        const strictSecurityWs = /^(1|true|yes)$/i.test(String(process.env.SMOKE_STRICT_SECURITY_WS || ''));
        if (strictSecurityWs) {
          await checkSecurityTest(FOLLOWER, 'follower', 'follower-security', {
            triggerHost,
            timeoutMs: 25000,
          });
        } else {
          console.log('  SKIP follower security-ws (public spectate; agent-ws is canonical relay path)');
        }
        await checkSecurityTest(FOLLOWER, 'follower', 'follower-agent', {
          useAgentWs: true,
          triggerHost,
          timeoutMs: 35000,
          retries: 1,
        });
      } else {
        await checkSecurityTest(FOLLOWER, 'follower', 'follower', {
          triggerHost,
          timeoutMs: TIMEOUT_MS,
        });
      }
    }
  } catch (err) {
    fail('unexpected', err?.message || String(err));
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll bouncer smoke checks passed');
  process.exit(failed ? 1 : 0);
}

main();
