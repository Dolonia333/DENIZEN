'use strict';

const crypto = require('node:crypto');
const crmPortal = require('./denizen-crm-portal');
const crmStore = require('./denizen-crm-store');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function publicBaseUrl() {
  const base = String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
  return base;
}

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

async function stripeRequest(method, path, params = {}) {
  if (!STRIPE_SECRET) throw new Error('stripe_not_configured');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function quoteAmountCents(quote) {
  const monthly = Number(quote?.monthlyTotal) || 0;
  const onetime = Number(quote?.onetimeTotal) || 0;
  const total = monthly + onetime;
  return Math.max(50, Math.round(total * 100));
}

async function createPortalCheckout(token) {
  const found = await crmPortal.findQuoteByToken(token);
  if (!found || found.expired) return { ok: false, error: 'invalid_or_expired' };

  const quote = found.quote;
  if (quote.portalPaidAt) return { ok: false, error: 'already_paid' };

  const amount = quoteAmountCents(quote);
  const base = publicBaseUrl();
  const portalPath = `/crm/#/portal/${encodeURIComponent(token)}`;

  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: `${base}${portalPath}?paid=1`,
    cancel_url: `${base}${portalPath}?cancelled=1`,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': amount,
    'line_items[0][price_data][product_data][name]': `${quote.recommendedPackage || 'Proposal'} — ${quote.company || quote.clientName}`,
    'line_items[0][price_data][product_data][description]': `Monthly ${quote.monthlyTotal || 0} + one-time ${quote.onetimeTotal || 0}`,
    'metadata[portal_token]': token,
    'metadata[org_id]': found.orgId,
    'metadata[quote_id]': String(quote.id),
    customer_email: quote.clientEmail || undefined,
  });

  return { ok: true, url: session.url, sessionId: session.id, configured: true };
}

async function markQuotePaid(orgId, quoteId, token, detail) {
  const row = await crmStore.getWorkspace(orgId);
  const state = { ...(row?.state || {}) };
  const quotes = [...(state.quotes || [])];
  const idx = quotes.findIndex((q) =>
    String(q?.portalToken) === String(token) || Number(q?.id) === Number(quoteId),
  );
  if (idx < 0) return { ok: false, error: 'quote_not_found' };

  const paidAt = new Date().toISOString();
  let q = {
    ...quotes[idx],
    portalPaidAt: paidAt,
    status: quotes[idx].status === 'won' ? 'won' : 'paid',
  };
  const activity = Array.isArray(q.portalActivity) ? [...q.portalActivity] : [];
  activity.unshift({ type: 'paid', at: paidAt, note: detail || 'Stripe payment completed' });
  q = { ...q, portalActivity: activity.slice(0, 100) };
  quotes[idx] = q;
  state.quotes = quotes;

  const auditLog = Array.isArray(state.auditLog) ? [...state.auditLog] : [];
  auditLog.unshift({
    id: nextId(auditLog),
    user: q.clientName || 'Client',
    action: 'paid',
    entity: 'quote',
    entityName: q.recommendedPackage || `Quote ${q.id}`,
    at: paidAt,
  });
  state.auditLog = auditLog.slice(0, 500);

  await crmStore.upsertWorkspace(orgId, state, null, { ifUpdatedAt: row?.updated_at || null });
  return { ok: true, quote: q };
}

function verifyStripeSignature(rawBody, signatureHeader) {
  // Fail closed: a missing secret or header is never treated as "verified".
  if (!STRIPE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = String(signatureHeader).split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;
  const payload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function handleStripeWebhook(rawBody, signatureHeader) {
  if (!STRIPE_SECRET) return { ok: true, skipped: true, reason: 'stripe_not_configured' };
  // Stripe is live but no webhook secret is set — refuse to act on unverifiable
  // events rather than trusting a forgeable "payment completed" payload.
  if (!STRIPE_WEBHOOK_SECRET) {
    return { ok: false, error: 'webhook_secret_not_configured' };
  }
  if (!verifyStripeSignature(rawBody, signatureHeader)) {
    return { ok: false, error: 'invalid_signature' };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  const type = event?.type || '';
  if (type === 'checkout.session.completed') {
    const session = event.data?.object || {};
    const token = session.metadata?.portal_token;
    const orgId = session.metadata?.org_id;
    const quoteId = session.metadata?.quote_id;
    if (token && orgId) {
      await markQuotePaid(orgId, quoteId, token, `Stripe session ${session.id}`);
      return { ok: true, handled: 'checkout.session.completed' };
    }
  }

  return { ok: true, ignored: type || 'unknown' };
}

function stripeConfigured() {
  return Boolean(STRIPE_SECRET);
}

module.exports = {
  createPortalCheckout,
  handleStripeWebhook,
  markQuotePaid,
  stripeConfigured,
  quoteAmountCents,
};
