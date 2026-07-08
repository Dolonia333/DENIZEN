'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signingSecret(env = process.env) {
  return String(
    env.DENIZEN_STATION_TOKEN_SECRET
    || env.EMAIL_INBOUND_SECRET
    || env.DENIZEN_FLEET_AGENT_TOKEN
    || 'denizen-station-dev-secret',
  );
}

function slugify(value, fallback = 'station') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function randomSuffix(len = 6) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function signPayload(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function encodeToken(payload, env = process.env) {
  const secret = signingSecret(env);
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${signPayload(body, secret)}`;
}

function decodeToken(token, env = process.env) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const secret = signingSecret(env);
  const expected = signPayload(body, secret);
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.identity_id || !payload?.machine_id) return null;
  if (payload.exp && Date.now() > Number(payload.exp)) return null;
  return {
    identityId: String(payload.identity_id),
    machineId: String(payload.machine_id),
    label: String(payload.label || payload.machine_id),
    exp: payload.exp ? Number(payload.exp) : null,
  };
}

function defaultMachineId(identityId, label, hostname) {
  const host = slugify(hostname || os.hostname(), 'device');
  const who = slugify(identityId, 'user').slice(0, 16);
  const name = slugify(label, '');
  const base = name ? `${who}-${name}` : `${who}-${host}`;
  return `${base}-${randomSuffix(4)}`.slice(0, 64);
}

function createStationToken({
  identityId,
  label = '',
  machineId = '',
  ttlMs = DEFAULT_TTL_MS,
  hostname = '',
} = {}, env = process.env) {
  if (!identityId) throw new Error('identity_id required');
  const resolvedMachineId = String(machineId || '').trim()
    || defaultMachineId(identityId, label, hostname);
  const payload = {
    identity_id: String(identityId),
    machine_id: resolvedMachineId,
    label: String(label || resolvedMachineId).trim() || resolvedMachineId,
    exp: Date.now() + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS),
  };
  return {
    station_token: encodeToken(payload, env),
    identity_id: payload.identity_id,
    machine_id: payload.machine_id,
    label: payload.label,
    expires_at: new Date(payload.exp).toISOString(),
  };
}

function buildInstallScript({
  publicUrl,
  bundleUrl,
  agentRoot = '~/denizen-agent',
} = {}) {
  const base = String(publicUrl || '').replace(/\/+$/, '');
  const url = String(bundleUrl || `${base}/api/compute/fleet/agent-bundle.tar.gz`);
  return [
    `mkdir -p ${agentRoot} && cd ${agentRoot}/..`,
    `curl -fsSL -H "X-Station-Token: $STATION_TOKEN" "${url}" | tar xzf -`,
    `chmod +x ${agentRoot}/start.sh`,
    `cd ${agentRoot} && nohup ./start.sh >> agent.log 2>&1 &`,
    'sleep 2 && tail -n 5 agent.log',
  ].join(' && ');
}

function buildProvisionPayload({
  identityId,
  label,
  machineId,
  publicUrl,
  stationToken,
  machine_id,
} = {}) {
  const base = String(publicUrl || '').replace(/\/+$/, '');
  const mid = machine_id || machineId;
  const params = new URLSearchParams({
    machine_id: mid,
    label: label || mid,
    denizen_url: base,
    station_token: stationToken,
  });
  const bundleUrl = `${base}/api/compute/fleet/agent-bundle.tar.gz?${params.toString()}`;
  return {
    ok: true,
    identity_id: identityId,
    machine_id: mid,
    label: label || mid,
    station_token: stationToken,
    public_url: base,
    bundle_url: bundleUrl,
    install_env: `export STATION_TOKEN='${stationToken}'`,
    install_linux: `export STATION_TOKEN='${stationToken}' && ${buildInstallScript({ publicUrl: base, bundleUrl })}`,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  createStationToken,
  decodeToken,
  buildProvisionPayload,
  buildInstallScript,
  defaultMachineId,
};
