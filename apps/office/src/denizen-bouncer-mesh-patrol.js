'use strict';

const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

const DEFAULT_PORTS = [80, 443, 1234];
const DEFAULT_TIMEOUT_MS = 2000;

function normalizeHost(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.replace(/^\[|\]$/g, '');
}

function parseUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(String(raw));
  } catch (_) {
    return null;
  }
}

function normalizePorts(nodeInfo, parsedUrl) {
  const explicit = Array.isArray(nodeInfo?.ports) ? nodeInfo.ports : null;
  const source = explicit && explicit.length
    ? explicit
    : (parsedUrl?.port ? [Number(parsedUrl.port)] : DEFAULT_PORTS);
  const unique = new Set();
  for (const item of source) {
    const port = Number(item);
    if (!Number.isFinite(port)) continue;
    if (port < 1 || port > 65535) continue;
    unique.add(port);
  }
  return [...unique];
}

function resolveHealthUrl(nodeInfo, parsedUrl, host) {
  const rawHealth = String(nodeInfo?.health_url || nodeInfo?.healthUrl || '').trim();
  if (rawHealth) return rawHealth;
  if (parsedUrl && /^https?:$/i.test(parsedUrl.protocol)) {
    return new URL('/health', parsedUrl).toString();
  }
  if (host) {
    return `http://${host}:1234/health`;
  }
  return null;
}

function probeTcpPort(host, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (open, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({
        port,
        open: !!open,
        elapsed: Date.now() - started,
        detail: detail ? String(detail).slice(0, 180) : '',
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (err) => finish(false, err?.code || err?.message || 'error'));
    socket.connect(port, host);
  });
}

function probeHealthUrl(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const handler = /^https:/i.test(url) ? https : http;
    const req = handler.request(url, { method: 'GET' }, (res) => {
      const statusCode = Number(res.statusCode) || 0;
      const healthy = statusCode > 0 && statusCode < 500;
      res.resume();
      if (settled) return;
      settled = true;
      resolve({
        ok: healthy,
        statusCode,
        elapsed: Date.now() - started,
        detail: `status=${statusCode}`,
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        statusCode: 0,
        elapsed: Date.now() - started,
        detail: err?.code || err?.message || 'request_error',
      });
    });
    req.end();
  });
}

async function runNodePatrol(nodeInfo = {}) {
  const start = Date.now();
  const parsedUrl = parseUrl(nodeInfo.url || nodeInfo.node_url || nodeInfo.base_url);
  const nodeId = String(
    nodeInfo.node_id
    || nodeInfo.nodeId
    || nodeInfo.id
    || nodeInfo.machine_id
    || nodeInfo.host
    || nodeInfo.url
    || 'unknown-node',
  );
  const host = normalizeHost(nodeInfo.host || parsedUrl?.hostname);

  if (!host) {
    return {
      ok: false,
      nodeId,
      summary: `Mesh patrol failed: missing host for ${nodeId}`,
      openPorts: [],
      elapsed: Date.now() - start,
    };
  }

  const ports = normalizePorts(nodeInfo, parsedUrl);
  const timeoutMs = Math.max(500, Number(nodeInfo.timeout_ms || nodeInfo.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const portResults = await Promise.all(ports.map((port) => probeTcpPort(host, port, timeoutMs)));
  const openPorts = portResults
    .filter((r) => r.open)
    .map((r) => ({
      port: String(r.port),
      service: r.port === 1234 ? 'lm-studio' : 'tcp',
      state: 'open',
    }));

  const healthUrl = resolveHealthUrl(nodeInfo, parsedUrl, host);
  const health = healthUrl ? await probeHealthUrl(healthUrl, timeoutMs) : null;
  const ok = openPorts.length > 0 || !!health?.ok;
  const elapsed = Date.now() - start;
  const summaryParts = [
    `Mesh node patrol ${nodeId}`,
    `Host: ${host}`,
    `Open ports: ${openPorts.map((p) => p.port).join(', ') || 'none'}`,
  ];
  if (health) {
    summaryParts.push(`Health ${health.ok ? 'UP' : 'DOWN'} (${health.detail})`);
  }
  summaryParts.push(`Elapsed: ${elapsed}ms`);

  return {
    ok,
    nodeId,
    summary: summaryParts.join(' | '),
    openPorts,
    elapsed,
    health,
    probes: portResults,
  };
}

module.exports = {
  runNodePatrol,
  probeTcpPort,
};
