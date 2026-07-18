'use strict';

/**
 * Stripe *subscription* wiring for gating premium Discord-bot modules per guild.
 *
 * Mirrors denizen-crm-stripe.js: raw `fetch` to the Stripe REST API (no SDK),
 * URLSearchParams form bodies, HMAC-SHA256 webhook signature verification via
 * node:crypto. Entitlements are persisted through denizen-guild-plans, which
 * owns the denizen_guild_plans table — this module only translates Stripe
 * events into setGuildPlanFromStripe() upserts.
 *
 * Env:
 *   STRIPE_SECRET_KEY            Stripe secret (Bearer auth)
 *   STRIPE_PRICE_PRO            price id for the 'pro' plan
 *   STRIPE_PRICE_ULTRA         price id for the 'ultra' plan
 *   STRIPE_GUILD_WEBHOOK_SECRET webhook signing secret (falls back to
 *   STRIPE_WEBHOOK_SECRET)       the shared STRIPE_WEBHOOK_SECRET)
 *   DENIZEN_PUBLIC_URL / DENIZEN_URL  base for success/cancel redirects
 */

const crypto = require('node:crypto');
const guildPlans = require('./denizen-guild-plans');

// Stripe subscription statuses we accept; anything else collapses to 'incomplete'.
const ALLOWED_STATUSES = new Set([
  'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid',
]);

function publicBaseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

/** Map a Stripe price id to our plan tier via env, or null if unrecognized. */
function planForPrice(priceId) {
  const id = String(priceId || '');
  if (!id) return null;
  if (process.env.STRIPE_PRICE_PRO && id === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (process.env.STRIPE_PRICE_ULTRA && id === process.env.STRIPE_PRICE_ULTRA) return 'ultra';
  return null;
}

function priceForPlan(plan) {
  if (plan === 'pro') return process.env.STRIPE_PRICE_PRO || '';
  if (plan === 'ultra') return process.env.STRIPE_PRICE_ULTRA || '';
  return '';
}

function mapStatus(status) {
  const s = String(status || '');
  return ALLOWED_STATUSES.has(s) ? s : 'incomplete';
}

function unixToIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString();
}

async function stripeRequest(method, path, params = {}) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('stripe_not_configured');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
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

/**
 * Create a Stripe Checkout Session (mode=subscription) for a guild upgrading to
 * `plan`. Returns { ok:true, url, id } or a graceful { ok:false, error }.
 */
async function createGuildSubscriptionCheckout({ guildId, plan, discordUserId } = {}) {
  const priceId = priceForPlan(plan);
  if (!priceId) return { ok: false, error: 'unknown_plan' };
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'stripe_not_configured' };

  const base = publicBaseUrl();
  const gid = String(guildId || '');
  const params = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    client_reference_id: gid,
    'metadata[guild_id]': gid,
    'metadata[plan]': plan,
    'subscription_data[metadata][guild_id]': gid,
    success_url: `${base}/discord-map/?billing=success`,
    cancel_url: `${base}/discord-map/?billing=cancel`,
  };
  if (discordUserId) {
    params['metadata[discord_user_id]'] = String(discordUserId);
  }

  try {
    const session = await stripeRequest('POST', '/checkout/sessions', params);
    return { ok: true, url: session.url, id: session.id };
  } catch (err) {
    return { ok: false, error: err?.message || 'stripe_error' };
  }
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  // Fail closed: a missing secret or header is never treated as "verified".
  if (!secret || !signatureHeader) return false;
  const parts = String(signatureHeader).split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;
  const payload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify + process a guild-billing webhook. Upserts guild entitlements via
 * denizen-guild-plans. Never throws — a malformed event returns { ok:false }.
 */
async function handleGuildBillingWebhook(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_GUILD_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  // No secret → refuse to act on a forgeable, unverifiable payload.
  if (!secret) return { ok: false, error: 'webhook_secret_not_configured' };
  if (!verifyStripeSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, error: 'bad_signature' };
  }

  try {
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: 'invalid_json' };
    }

    const type = event?.type || '';
    const obj = event?.data?.object || {};

    if (type === 'checkout.session.completed') {
      if (obj.mode !== 'subscription') return { ok: true, ignored: type };
      const guildId = obj.metadata?.guild_id || obj.client_reference_id;
      if (!guildId) return { ok: true, ignored: type };

      const subId = obj.subscription;
      const patch = {
        guild_id: String(guildId),
        stripe_customer_id: obj.customer || undefined,
        stripe_subscription_id: subId || undefined,
      };
      if (obj.metadata?.discord_user_id) {
        patch.linked_user_id = String(obj.metadata.discord_user_id);
      }

      if (subId) {
        const sub = await stripeRequest('GET', `/subscriptions/${encodeURIComponent(subId)}`);
        const priceId = sub?.items?.data?.[0]?.price?.id;
        patch.status = mapStatus(sub?.status);
        patch.price_id = priceId || undefined;
        patch.plan = planForPrice(priceId) || undefined;
        patch.current_period_end = unixToIso(sub?.current_period_end);
      }

      await guildPlans.setGuildPlanFromStripe(patch);
      return { ok: true, handled: type };
    }

    if (type === 'customer.subscription.updated') {
      const guildId = obj.metadata?.guild_id;
      if (!guildId) return { ok: true, ignored: type };

      const priceId = obj.items?.data?.[0]?.price?.id;
      await guildPlans.setGuildPlanFromStripe({
        guild_id: String(guildId),
        status: mapStatus(obj.status),
        plan: planForPrice(priceId) || undefined,
        price_id: priceId || undefined,
        stripe_customer_id: obj.customer || undefined,
        stripe_subscription_id: obj.id || undefined,
        current_period_end: unixToIso(obj.current_period_end),
      });
      return { ok: true, handled: type };
    }

    if (type === 'customer.subscription.deleted') {
      const guildId = obj.metadata?.guild_id;
      if (!guildId) return { ok: true, ignored: type };

      await guildPlans.setGuildPlanFromStripe({
        guild_id: String(guildId),
        plan: 'free',
        status: 'canceled',
        stripe_subscription_id: obj.id || undefined,
      });
      return { ok: true, handled: type };
    }

    return { ok: true, ignored: type || 'unknown' };
  } catch (err) {
    return { ok: false, error: err?.message || 'webhook_error' };
  }
}

module.exports = {
  planForPrice,
  createGuildSubscriptionCheckout,
  handleGuildBillingWebhook,
};
