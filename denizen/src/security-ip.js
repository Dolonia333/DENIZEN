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

/** Dev / local triggers — do not spawn robbers or run Kali. */
function isInternalThreatSource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return false;
  if (isLocalOrLoopback(s)) return true;
  return s === 'filesystem' || s === 'internal' || s === 'local';
}

module.exports = { normalizeIp, isLocalOrLoopback, isInternalThreatSource };
