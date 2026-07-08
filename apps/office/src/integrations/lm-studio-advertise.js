'use strict';

const os = require('node:os');
const { normalizeBaseUrl } = require('./lm-studio-probe');

const DEFAULT_PORT = Number(process.env.LM_STUDIO_PORT) || 1234;

function isLoopbackUrl(url) {
  const u = String(url || '').toLowerCase();
  return /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(u);
}

function isPrivateLanIp(ip) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(ip || ''));
}

function isTailscaleIp(ip) {
  return /^100\.\d+\.\d+\.\d+$/.test(String(ip || ''));
}

/** Prefer LAN on home mesh (NAS probes .232 directly); Tailscale for remote agents. */
function pickAdvertiseHost(extra = {}) {
  const explicit = String(
    extra.advertise_host
    || extra.advertiseHost
    || process.env.LM_STUDIO_ADVERTISE_HOST
    || '',
  ).trim();
  if (explicit) return explicit;

  const prefer = String(
    process.env.LM_STUDIO_ADVERTISE_PREFER
    || process.env.DENIZEN_MESH_PREFER_LAN
    || 'lan',
  ).trim().toLowerCase();

  const nets = os.networkInterfaces();
  const candidates = [];
  for (const ifaces of Object.values(nets)) {
    for (const addr of ifaces || []) {
      if (!addr || addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push(addr.address);
    }
  }
  const tailscale = candidates.find((ip) => isTailscaleIp(ip));
  const lan = candidates.find((ip) => isPrivateLanIp(ip));
  if (prefer === 'tailscale') {
    return tailscale || lan || candidates[0] || null;
  }
  return lan || tailscale || candidates[0] || null;
}

function buildAdvertiseUrl(host, port = DEFAULT_PORT) {
  if (!host) return null;
  return normalizeBaseUrl(`http://${host}:${port}`);
}

/**
 * Router URL for a fleet/desktop heartbeat (never publish loopback to remote primary).
 */
function resolveRouterLmUrl(machine = {}, lm = {}) {
  const local = normalizeBaseUrl(
    lm.url
    || lm.local_url
    || machine.lm_studio_url
    || '',
  );
  const advertised = normalizeBaseUrl(
    lm.advertise_url
    || lm.advertiseUrl
    || machine.lm_studio_advertise_url
    || '',
  );

  if (advertised && !isLoopbackUrl(advertised)) return advertised;

  if (local && !isLoopbackUrl(local)) return local;

  if (local && isLoopbackUrl(local) && lm.reachable) {
    const host = pickAdvertiseHost(machine);
    const built = buildAdvertiseUrl(host);
    if (built) return built;
  }

  return local || advertised || null;
}

function enrichLmStudioBlock(lmStudio, extra = {}) {
  if (!lmStudio || typeof lmStudio !== 'object') return lmStudio;
  if (!lmStudio.reachable) return lmStudio;

  const localUrl = normalizeBaseUrl(lmStudio.url || lmStudio.local_url || '');
  const portMatch = String(localUrl || '').match(/:(\d+)$/);
  const port = portMatch ? Number(portMatch[1]) : DEFAULT_PORT;
  const advertiseUrl = buildAdvertiseUrl(pickAdvertiseHost(extra), port);

  return {
    ...lmStudio,
    local_url: localUrl || lmStudio.url || null,
    advertise_url: advertiseUrl,
    models_count: Array.isArray(lmStudio.models) ? lmStudio.models.length : 0,
  };
}

function isTailscaleUrl(url) {
  try {
    const host = new URL(String(url || '')).hostname;
    return isTailscaleIp(host);
  } catch (_) {
    return false;
  }
}

/**
 * NAS primaries probe fleet nodes over LAN — remap Tailscale advertise URLs when possible.
 */
function preferServerProbeUrl(url, machine = {}) {
  const normalized = url ? normalizeBaseUrl(url) : null;
  if (!normalized || !isTailscaleUrl(normalized)) return normalized;

  const mapRaw = String(process.env.DENIZEN_MESH_LAN_PROBE_URL || '').trim();
  if (mapRaw) return normalizeBaseUrl(mapRaw);

  const remoteRaw = String(process.env.LM_STUDIO_REMOTE_URLS || '').trim();
  if (!remoteRaw) return normalized;
  const lanRemote = remoteRaw.split(',')
    .map((s) => normalizeBaseUrl(s))
    .find((u) => u && !isLoopbackUrl(u) && !isTailscaleUrl(u));
  if (lanRemote && (machine.role === 'desktop' || machine.contributing)) return lanRemote;
  return normalized;
}

module.exports = {
  DEFAULT_PORT,
  isLoopbackUrl,
  isPrivateLanIp,
  isTailscaleIp,
  isTailscaleUrl,
  pickAdvertiseHost,
  buildAdvertiseUrl,
  resolveRouterLmUrl,
  preferServerProbeUrl,
  enrichLmStudioBlock,
};
