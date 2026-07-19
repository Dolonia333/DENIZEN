'use strict';
/**
 * Shared helpers for security-monitor IP classification.
 */

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let s = ip.trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

/** Loopback / same-machine traffic — not an external attacker. */
function isLocalOrLoopback(ip) {
  const n = normalizeIp(ip);
  if (!n) return false;
  if (n === '::1' || n === '127.0.0.1' || n === 'localhost' || n === '0.0.0.0') return true;
  if (n.startsWith('127.')) return true;
  return false;
}

/**
 * RFC1918 private / link-local ranges — devices inside our own network (the
 * host's LAN, other machines on it, the reverse-proxy tunnel). Real external
 * attackers arrive as public IPs (or the X-Forwarded-For client IP through
 * Cloudflare), never as 10./172.16-31./192.168./169.254. Internal traffic
 * (e.g. a browser's WebSocket reconnect storm) must not be dramatized as an
 * attack — the threat is still logged, just not turned into robbers/Kali.
 */
function isPrivateLan(ip) {
  const n = normalizeIp(ip);
  if (!n) return false;
  if (n.startsWith('10.') || n.startsWith('192.168.') || n.startsWith('169.254.')) return true;
  const m = n.match(/^172\.(\d{1,3})\./);
  if (m) { const o = Number(m[1]); if (o >= 16 && o <= 31) return true; }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe8') || n.startsWith('fe9') || n.startsWith('fea') || n.startsWith('feb')) return true;
  return false;
}

function hostOperatorIps() {
  const raw = String(process.env.DENIZEN_HOST_IP || process.env.DENIZEN_MESH_BROWSER_HOST || '').trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map(normalizeIp).filter(Boolean);
}

/** This machine's LAN/Tailscale IP — game server self-traffic, not an external attacker. */
function isHostOperatorIp(ip) {
  const n = normalizeIp(ip);
  if (!n) return false;
  return hostOperatorIps().includes(n);
}

/** Dev / local triggers — do not spawn robbers or run Kali (unless force). */
function isInternalThreatSource(source, opts = {}) {
  if (opts.force) return false;
  const s = String(source || '').trim().toLowerCase();
  if (!s) return false;
  if (isLocalOrLoopback(s)) return true;
  if (isPrivateLan(s)) return true;
  if (isHostOperatorIp(s)) return true;
  if (s === 'filesystem' || s === 'internal' || s === 'local' || s === 'test') return true;
  return false;
}

module.exports = {
  normalizeIp,
  isLocalOrLoopback,
  isPrivateLan,
  isHostOperatorIp,
  hostOperatorIps,
  isInternalThreatSource,
};
