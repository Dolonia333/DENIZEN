'use strict';

const denizenDb = require('./denizen-db.js');

class DenizenCreditsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DenizenCreditsError';
    this.code = code;
  }
}

function isEnabled() {
  return Boolean(denizenDb.enabled);
}

function toSafeInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata;
}

function normalizeReason(reason) {
  const value = String(reason || '').trim();
  if (!value) {
    throw new DenizenCreditsError('reason required', 'BAD_INPUT');
  }
  return value.slice(0, 200);
}

function normalizePositiveAmount(amount, fieldName) {
  const value = toSafeInteger(amount, NaN);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DenizenCreditsError(`${fieldName} must be a positive integer`, 'BAD_INPUT');
  }
  return value;
}

async function getIdentityCreditsRow(identityId) {
  if (!isEnabled() || !identityId) return null;
  const rows = await denizenDb._get(
    `denizen_user_identities?select=id,credits_balance&id=eq.${encodeURIComponent(identityId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function getBalance(identityId) {
  const row = await getIdentityCreditsRow(identityId);
  return toSafeInteger(row?.credits_balance, 0);
}

async function appendLedgerEntry({
  identityId,
  delta,
  balanceAfter,
  reason,
  jobId = null,
  metadata = {},
} = {}) {
  if (!isEnabled() || !identityId) return null;
  const rows = await denizenDb._post(
    'denizen_credits_ledger',
    {
      identity_id: identityId,
      delta: toSafeInteger(delta, 0),
      balance_after: toSafeInteger(balanceAfter, 0),
      reason: normalizeReason(reason),
      job_id: jobId || null,
      metadata: normalizeMetadata(metadata),
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function listLedger(identityId, limit = 50) {
  if (!isEnabled() || !identityId) return [];
  const safeLimit = Math.max(1, Math.min(500, toSafeInteger(limit, 50)));
  const rows = await denizenDb._get(
    `denizen_credits_ledger?select=*&identity_id=eq.${encodeURIComponent(identityId)}&order=created_at.desc&limit=${safeLimit}`,
  );
  return rows || [];
}

async function applyDelta({
  identityId,
  delta,
  reason,
  jobId = null,
  metadata = {},
  maxRetries = 5,
} = {}) {
  if (!isEnabled()) {
    throw new DenizenCreditsError('DenizenDb disabled', 'DB_DISABLED');
  }
  if (!identityId) {
    throw new DenizenCreditsError('identityId required', 'BAD_INPUT');
  }
  const normalizedDelta = toSafeInteger(delta, NaN);
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    throw new DenizenCreditsError('delta must be a non-zero integer', 'BAD_INPUT');
  }
  const normalizedReason = normalizeReason(reason);
  const normalizedMetadata = normalizeMetadata(metadata);

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const current = await getIdentityCreditsRow(identityId);
    if (!current?.id) {
      throw new DenizenCreditsError('Identity not found', 'NOT_FOUND');
    }

    const currentBalance = toSafeInteger(current.credits_balance, 0);
    const nextBalance = currentBalance + normalizedDelta;
    if (nextBalance < 0) {
      return {
        ok: false,
        error: 'INSUFFICIENT_CREDITS',
        balance: currentBalance,
        delta: normalizedDelta,
      };
    }

    const rows = await denizenDb._patch(
      `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}&credits_balance=eq.${encodeURIComponent(currentBalance)}`,
      { credits_balance: nextBalance },
      { prefer: 'return=representation' },
    );

    if (!rows?.length) continue;

    const ledger = await appendLedgerEntry({
      identityId,
      delta: normalizedDelta,
      balanceAfter: nextBalance,
      reason: normalizedReason,
      jobId,
      metadata: normalizedMetadata,
    });

    return {
      ok: true,
      identity_id: identityId,
      delta: normalizedDelta,
      balance: nextBalance,
      ledger: ledger || null,
    };
  }

  throw new DenizenCreditsError('Balance update conflict; retry', 'CONFLICT');
}

async function awardCredits(identityId, amount, reason, opts = {}) {
  const normalizedAmount = normalizePositiveAmount(amount, 'amount');
  return applyDelta({
    identityId,
    delta: normalizedAmount,
    reason,
    jobId: opts.jobId || null,
    metadata: opts.metadata || {},
  });
}

async function spendCredits(identityId, amount, reason, opts = {}) {
  const normalizedAmount = normalizePositiveAmount(amount, 'amount');
  return applyDelta({
    identityId,
    delta: -normalizedAmount,
    reason,
    jobId: opts.jobId || null,
    metadata: opts.metadata || {},
  });
}

module.exports = {
  DenizenCreditsError,
  isEnabled,
  getIdentityCreditsRow,
  getBalance,
  appendLedgerEntry,
  listLedger,
  applyDelta,
  awardCredits,
  spendCredits,
};
