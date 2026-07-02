'use strict';

/**
 * Format LLM provider errors into short, readable messages for telemetry and logs.
 * Accepts an Error, a string, or a provider response fragment; never throws.
 */

function formatProviderError(err) {
  if (err == null) return 'unknown provider error';
  if (typeof err === 'string') return err.slice(0, 300);
  if (err instanceof Error) {
    const code = err.code ? ` [${err.code}]` : '';
    return `${err.message || 'provider error'}${code}`.slice(0, 300);
  }
  if (typeof err === 'object') {
    const msg = err.error?.message || err.message || err.error || err.statusText;
    const status = err.status || err.statusCode;
    const parts = [];
    if (status) parts.push(`HTTP ${status}`);
    if (msg) parts.push(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
    if (parts.length) return parts.join(': ').slice(0, 300);
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch (_) {
      return 'unserializable provider error';
    }
  }
  return String(err).slice(0, 300);
}

module.exports = { formatProviderError };
