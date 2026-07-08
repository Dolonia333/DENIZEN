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
  if (isHostOperatorIp(s)) return true;
  if (s === 'filesystem' || s === 'internal' || s === 'local' || s === 'test') return true;
  return false;
}

module.exports = {
  normalizeIp,
  isLocalOrLoopback,
  isHostOperatorIp,
  hostOperatorIps,
  isInternalThreatSource,
};
