'use strict';

const os = require('node:os');
const { normalizeBaseUrl } = require('./lm-studio-probe');

const DEFAULT_PORT = Number(process.env.LM_STUDIO_PORT) || 1234;

function isLoopbackUrl(url) {
  const u = String(url || '').toLowerCase();
  return /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(u);
}

/** Prefer Tailscale (100.x) then first private LAN IPv4. */
function pickAdvertiseHost(extra = {}) {
  const explicit = String(
    extra.advertise_host
    || extra.advertiseHost
    || process.env.LM_STUDIO_ADVERTISE_HOST
    || '',
  ).trim();
  if (explicit) return explicit;

  const nets = os.networkInterfaces();
  const candidates = [];
  for (const ifaces of Object.values(nets)) {
    for (const addr of ifaces || []) {
      if (!addr || addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push(addr.address);
    }
  }
  const tailscale = candidates.find((ip) => /^100\.\d+\.\d+\.\d+$/.test(ip));
  if (tailscale) return tailscale;
  const lan = candidates.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return lan || candidates[0] || null;
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

module.exports = {
  DEFAULT_PORT,
  isLoopbackUrl,
  pickAdvertiseHost,
  buildAdvertiseUrl,
  resolveRouterLmUrl,
  enrichLmStudioBlock,
};
