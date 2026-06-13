'use strict';

const denizenDb = require('./denizen-db');
const crmStore = require('./denizen-crm-store');

const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

const rateHits = new Map();

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function isTokenExpired(validUntil) {
  const t = Date.parse(String(validUntil || ''));
  if (Number.isNaN(t)) return false;
  return Date.now() > t + EXPIRY_GRACE_MS;
}

function checkRate(token) {
  const now = Date.now();
  const hits = (rateHits.get(token) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return { allowed: false, retryAfterMs: RATE_WINDOW_MS - (now - hits[0]) };
  }
  hits.push(now);
  rateHits.set(token, hits);
  // Evict expired token buckets so the map can't grow unbounded over time.
  if (rateHits.size > 2000) {
    for (const [key, times] of rateHits) {
      const live = times.filter((t) => now - t < RATE_WINDOW_MS);
      if (live.length) rateHits.set(key, live);
      else rateHits.delete(key);
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

function publicQuotePayload(quote, branding) {
  if (!quote) return null;
  return {
    id: quote.id,
    clientName: quote.clientName,
    company: quote.company,
    recommendedPackage: quote.recommendedPackage,
    lineItems: quote.lineItems || [],
    monthlyTotal: quote.monthlyTotal,
    onetimeTotal: quote.onetimeTotal,
    validUntil: quote.validUntil,
    status: quote.status,
    portalToken: quote.portalToken,
    portalViewedAt: quote.portalViewedAt,
    portalSignedAt: quote.portalSignedAt,
    portalPaidAt: quote.portalPaidAt || null,
    signatures: quote.portalSignatures || [],
    branding: branding || null,
  };
}

async function syncPortalTokenIndex(orgId, state) {
  if (!orgId || !denizenDb.enabled) return;
  const quotes = Array.isArray(state?.quotes) ? state.quotes : [];
  const tokens = quotes.map((q) => String(q?.portalToken || '').trim()).filter(Boolean);
  try {
    if (tokens.length) {
      const existing = await denizenDb._get(
        `denizen_crm_portal_tokens?select=token&org_id=eq.${encodeURIComponent(orgId)}`,
      ).catch(() => []);
      const existingSet = new Set((existing || []).map((r) => r.token));
      const nextSet = new Set(tokens);
      for (const t of existingSet) {
        if (!nextSet.has(t)) {
          await denizenDb._delete(`denizen_crm_portal_tokens?token=eq.${encodeURIComponent(t)}`).catch(() => {});
        }
      }
    } else {
      await denizenDb._delete(
        `denizen_crm_portal_tokens?org_id=eq.${encodeURIComponent(orgId)}`,
      ).catch(() => {});
    }
    for (const q of quotes) {
      const token = String(q?.portalToken || '').trim();
      if (!token) continue;
      await denizenDb._post(
        'denizen_crm_portal_tokens?on_conflict=token',
        {
          token,
          org_id: orgId,
          quote_id: Number(q.id) || 0,
          valid_until: q.validUntil || null,
          updated_at: new Date().toISOString(),
        },
        { prefer: 'resolution=merge-duplicates' },
      ).catch(() => {});
    }
  } catch (err) {
    console.warn('[CRM Portal] token index sync failed:', err?.message || err);
  }
}

async function findQuoteByToken(token) {
  const t = String(token || '').trim();
  if (!t || !denizenDb.enabled) return null;

  let orgId = null;
  let quoteId = null;
  const rows = await denizenDb._get(
    `denizen_crm_portal_tokens?select=org_id,quote_id,valid_until&token=eq.${encodeURIComponent(t)}&limit=1`,
  ).catch(() => []);
  if (rows?.[0]) {
    orgId = rows[0].org_id;
    quoteId = Number(rows[0].quote_id);
  }

  if (!orgId) {
    const all = await denizenDb._get(
      'denizen_crm_workspaces?select=org_id,state&limit=200',
    ).catch(() => []);
    for (const row of all || []) {
      const quotes = row?.state?.quotes;
      if (!Array.isArray(quotes)) continue;
      const match = quotes.find((q) => String(q?.portalToken) === t);
      if (match) {
        orgId = row.org_id;
        quoteId = Number(match.id);
        await syncPortalTokenIndex(orgId, row.state);
        break;
      }
    }
  }

  if (!orgId) return null;
  const ws = await crmStore.getWorkspace(orgId);
  const state = ws?.state || {};
  const quote = (state.quotes || []).find((q) => String(q?.portalToken) === t || Number(q?.id) === quoteId);
  if (!quote) return null;

  const branding = state.industryConfig ? {
    companyName: state.industryConfig.name || 'Meridian',
    tagline: state.industryConfig.terminology?.company || '',
    accentColor: '#f0b429',
    logoEmoji: state.industryConfig.icon || 'M',
  } : null;

  return { orgId, state, quote, branding, expired: isTokenExpired(quote.validUntil) };
}

function appendPortalActivity(quote, type, note) {
  const activity = Array.isArray(quote.portalActivity) ? [...quote.portalActivity] : [];
  activity.unshift({ type, at: new Date().toISOString(), note: String(note || '') });
  return { ...quote, portalActivity: activity.slice(0, 100) };
}

async function recordPortalEvent(token, eventType, detail) {
  const found = await findQuoteByToken(token);
  if (!found || found.expired) return { ok: false, error: 'invalid_or_expired' };
  const rate = checkRate(token);
  if (!rate.allowed) return { ok: false, error: 'rate_limited', retryAfterMs: rate.retryAfterMs };

  const row = await crmStore.getWorkspace(found.orgId);
  const state = { ...(row?.state || {}) };
  const quotes = [...(state.quotes || [])];
  const idx = quotes.findIndex((q) => String(q?.portalToken) === token);
  if (idx < 0) return { ok: false, error: 'quote_not_found' };

  let q = quotes[idx];
  if (eventType === 'portal_opened' && !q.portalViewedAt) {
    q = { ...q, portalViewedAt: new Date().toISOString() };
  }
  q = appendPortalActivity(q, eventType, detail);
  quotes[idx] = q;
  state.quotes = quotes;

  await crmStore.upsertWorkspace(found.orgId, state, null, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true };
}

async function signQuote(token, signature) {
  const found = await findQuoteByToken(token);
  if (!found) return { ok: false, error: 'invalid_token' };
  if (found.expired) return { ok: false, error: 'expired' };

  const signerName = String(signature?.signerName || '').trim();
  if (!signerName) return { ok: false, error: 'signer_name_required' };

  const row = await crmStore.getWorkspace(found.orgId);
  const state = { ...(row?.state || {}) };
  const quotes = [...(state.quotes || [])];
  const idx = quotes.findIndex((q) => String(q?.portalToken) === token);
  if (idx < 0) return { ok: false, error: 'quote_not_found' };

  const q = quotes[idx];
  const sigs = Array.isArray(q.portalSignatures) ? [...q.portalSignatures] : [];
  const dup = sigs.find((s) =>
    String(s.signerName || '').toLowerCase() === signerName.toLowerCase()
    && String(s.signerEmail || '').toLowerCase() === String(signature.signerEmail || '').toLowerCase(),
  );
  if (dup) return { ok: false, error: 'already_signed' };

  const record = {
    id: `sig_${Date.now().toString(36)}`,
    method: signature.method === 'drawn' ? 'drawn' : 'typed',
    value: String(signature.value || signerName),
    signerName,
    signerEmail: signature.signerEmail || undefined,
    signerRole: signature.signerRole || undefined,
    signedAt: new Date().toISOString(),
    lockedAt: new Date().toISOString(),
    userAgent: String(signature.userAgent || '').slice(0, 300),
    consent: String(signature.consent || ''),
  };
  sigs.push(record);

  let next = {
    ...q,
    portalSignatures: sigs,
    portalSignedAt: q.portalSignedAt || record.signedAt,
    signature: record.value,
    status: q.status === 'won' ? 'won' : 'signed',
  };
  next = appendPortalActivity(next, 'signed', `${record.method} signature by ${signerName}`);
  quotes[idx] = next;
  state.quotes = quotes;

  const auditLog = Array.isArray(state.auditLog) ? [...state.auditLog] : [];
  auditLog.unshift({
    id: nextId(auditLog),
    user: signerName,
    action: 'signed',
    entity: 'quote',
    entityName: q.recommendedPackage || `Quote ${q.id}`,
    at: record.signedAt,
  });
  state.auditLog = auditLog.slice(0, 500);

  await crmStore.upsertWorkspace(found.orgId, state, null, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, signature: record, quote: publicQuotePayload(next, found.branding) };
}

async function getPublicQuote(token) {
  const found = await findQuoteByToken(token);
  if (!found) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    expired: found.expired,
    quote: publicQuotePayload(found.quote, found.branding),
  };
}

module.exports = {
  syncPortalTokenIndex,
  findQuoteByToken,
  getPublicQuote,
  recordPortalEvent,
  signQuote,
  isTokenExpired,
  publicQuotePayload,
};
