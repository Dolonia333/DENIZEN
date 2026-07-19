'use strict';

/**
 * Stripe wiring for Discord guild Pro subscriptions + one-time pet purchases.
 *
 * Mirrors denizen-crm-stripe.js: raw `fetch` to the Stripe REST API (no SDK).
 * Guild plans → denizen-guild-plans; pet entitlements → denizen-guild-pets.
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_PRO / STRIPE_PRICE_ULTRA / STRIPE_PRICE_PET
 *   STRIPE_GUILD_WEBHOOK_SECRET (falls back to STRIPE_WEBHOOK_SECRET)
 *   DENIZEN_PUBLIC_URL / DENIZEN_URL
 */

const crypto = require('node:crypto');
const guildPlans = require('./denizen-guild-plans');
const guildPets = require('./denizen-guild-pets');

const ALLOWED_STATUSES = new Set([
  'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid',
]);

function publicBaseUrl() {
  return String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

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
    'metadata[product]': 'guild_plan',
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
    console.error(`[guild-billing] checkout create failed for guild ${gid}: ${err?.message || err}`);
    return { ok: false, error: 'checkout_failed' };
  }
}

async function createPetCheckout({ guildId, discordUserId, giftToUserId } = {}) {
  const priceId = String(process.env.STRIPE_PRICE_PET || '');
  if (!priceId) return { ok: false, error: 'pet_price_not_configured' };
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'stripe_not_configured' };

  const gid = String(guildId || '').trim();
  const buyer = String(discordUserId || '').trim();
  if (!gid || !buyer) return { ok: false, error: 'missing_ids' };

  const beneficiary = String(giftToUserId || buyer).trim() || buyer;
  const base = publicBaseUrl();
  const params = {
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    client_reference_id: `${gid}:${beneficiary}`,
    'metadata[product]': 'pet',
    'metadata[guild_id]': gid,
    'metadata[buyer_id]': buyer,
    'metadata[beneficiary_id]': beneficiary,
    success_url: `${base}/discord-map/?guildId=${encodeURIComponent(gid)}&pet=success`,
    cancel_url: `${base}/discord-map/?guildId=${encodeURIComponent(gid)}&pet=cancel`,
  };

  try {
    const session = await stripeRequest('POST', '/checkout/sessions', params);
    return { ok: true, url: session.url, id: session.id };
  } catch (err) {
    console.error(`[guild-billing] pet checkout failed for ${gid}/${buyer}: ${err?.message || err}`);
    return { ok: false, error: 'checkout_failed' };
  }
}

async function afterPlanPersisted(guildId) {
  if (!guildId) return;
  try {
    const plan = await guildPlans.getGuildPlan(guildId);
    await guildPets.syncProGrantPool(guildId, plan.active === true);
  } catch (err) {
    console.error(`[guild-billing] syncProGrantPool failed for ${guildId}: ${err?.message || err}`);
  }
}

const STRIPE_SIG_TOLERANCE_SEC = 300;

function verifyStripeSignature(rawBody, signatureHeader, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || !signatureHeader) return false;
  let ts = null;
  const sigs = [];
  for (const part of String(signatureHeader).split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') ts = v;
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!ts || !sigs.length) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > STRIPE_SIG_TOLERANCE_SEC) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  for (const sig of sigs) {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) return true;
    } catch { /* next */ }
  }
  return false;
}

async function handleGuildBillingWebhook(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_GUILD_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
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
      const product = obj.metadata?.product || '';
      if (obj.mode === 'payment' || product === 'pet') {
        const guildId = obj.metadata?.guild_id;
        const beneficiary = obj.metadata?.beneficiary_id || obj.metadata?.buyer_id;
        const buyer = obj.metadata?.buyer_id || beneficiary;
        if (!guildId || !beneficiary) return { ok: true, ignored: type };
        if (product && product !== 'pet') return { ok: true, ignored: type };
        const result = await guildPets.grantFromPurchase({
          guildId: String(guildId),
          userId: String(beneficiary),
          stripeSessionId: obj.id || null,
          stripePaymentIntent: obj.payment_intent || null,
          grantedBy: buyer && buyer !== beneficiary ? String(buyer) : null,
          source: buyer && beneficiary && buyer !== beneficiary ? 'gift' : 'purchase',
        });
        if (!result.ok && result.error === 'persist_failed') {
          return { ok: false, error: 'persist_failed' };
        }
        return { ok: true, handled: 'pet_purchase' };
      }

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
        const item = sub?.items?.data?.[0];
        const priceId = item?.price?.id;
        const plan = planForPrice(priceId);
        patch.status = mapStatus(sub?.status);
        patch.price_id = priceId || undefined;
        patch.plan = plan || undefined;
        patch.current_period_end = unixToIso(item?.current_period_end ?? sub?.current_period_end);
        if (!plan) {
          console.error(`[guild-billing] guild ${guildId}: active subscription ${subId} maps to no known plan (price ${priceId}). Check STRIPE_PRICE_PRO / STRIPE_PRICE_ULTRA.`);
        }
      }

      const stored = await guildPlans.setGuildPlanFromStripe(patch);
      if (stored === null && guildPlans.dbConfigured()) return { ok: false, error: 'persist_failed' };
      await afterPlanPersisted(String(guildId));
      return { ok: true, handled: type };
    }

    if (type === 'customer.subscription.updated') {
      let guildId = obj.metadata?.guild_id;
      if (!guildId) guildId = await guildPlans.findGuildBySubscription(obj.id);
      if (!guildId) return { ok: true, ignored: type };

      const item = obj.items?.data?.[0];
      const priceId = item?.price?.id;
      const plan = planForPrice(priceId);
      const patch = {
        guild_id: String(guildId),
        status: mapStatus(obj.status),
        price_id: priceId || undefined,
        stripe_customer_id: obj.customer || undefined,
        stripe_subscription_id: obj.id || undefined,
        current_period_end: unixToIso(item?.current_period_end ?? obj.current_period_end),
      };
      if (plan) patch.plan = plan;
      else if (priceId) console.error(`[guild-billing] guild ${guildId}: subscription ${obj.id} updated to unrecognized price ${priceId}; plan left unchanged.`);
      const stored = await guildPlans.setGuildPlanFromStripe(patch);
      if (stored === null && guildPlans.dbConfigured()) return { ok: false, error: 'persist_failed' };
      await afterPlanPersisted(String(guildId));
      return { ok: true, handled: type };
    }

    if (type === 'customer.subscription.deleted') {
      let guildId = obj.metadata?.guild_id;
      if (!guildId) guildId = await guildPlans.findGuildBySubscription(obj.id);
      if (!guildId) return { ok: true, ignored: type };

      const stored = await guildPlans.setGuildPlanFromStripe({
        guild_id: String(guildId),
        plan: 'free',
        status: 'canceled',
        stripe_subscription_id: obj.id || undefined,
      });
      if (stored === null && guildPlans.dbConfigured()) return { ok: false, error: 'persist_failed' };
      await afterPlanPersisted(String(guildId));
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
  createPetCheckout,
  handleGuildBillingWebhook,
};
