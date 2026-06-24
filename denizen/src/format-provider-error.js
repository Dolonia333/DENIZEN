'use strict';

/**
 * Normalize provider errors for telemetry — Node's AggregateError hides the
 * real ECONNREFUSED when localhost resolves to both ::1 and 127.0.0.1.
 */
function formatProviderError(err) {
  if (!err) return 'Unknown error';
  if (err instanceof AggregateError || err?.name === 'AggregateError') {
    const nested = Array.isArray(err.errors) ? err.errors : [];
    const parts = nested
      .map((e) => e?.code || e?.message || String(e))
      .filter(Boolean);
    if (parts.length) return `Connection failed (${parts.join('; ')})`;
  }
  if (err?.code && err?.message) return `${err.code}: ${err.message}`;
  return err.message || String(err);
}

module.exports = { formatProviderError };
