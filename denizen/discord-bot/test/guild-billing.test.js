'use strict';

// Guild-billing hardening regression tests. Stubs the Stripe API and Supabase
// PostgREST behind global.fetch and exercises the entitlement + webhook chain:
// signature replay defense, multi-v1 (secret rotation), current_period_end from
// the item level, past_due grace, and cancel-by-subscription-id fallback.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // denizen/
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_PRICE_PRO = 'price_pro';
process.env.STRIPE_PRICE_ULTRA = 'price_ultra';
process.env.STRIPE_GUILD_WEBHOOK_SECRET = 'whsec_test';

const db = new Map();
let stripeSubStatus = 'active';
const stripeItem = { price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 };

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/v1/subscriptions/')) {
    return { ok: true, status: 200, json: async () => ({ id: 'sub_1', status: stripeSubStatus, items: { data: [stripeItem] } }) };
  }
  if (u.includes('/rest/v1/denizen_guild_plans') && (!opts.method || opts.method === 'GET')) {
    if (u.includes('stripe_subscription_id=eq.')) {
      const sub = decodeURIComponent(u.split('stripe_subscription_id=eq.')[1].split('&')[0]);
      const found = [...db.values()].find((r) => r.stripe_subscription_id === sub);
      return { ok: true, status: 200, json: async () => (found ? [{ guild_id: found.guild_id }] : []) };
    }
    const gid = decodeURIComponent(u.split('guild_id=eq.')[1].split('&')[0]);
    const row = db.get(gid);
    return { ok: true, status: 200, json: async () => (row ? [row] : []) };
  }
  if (u.includes('/rest/v1/denizen_guild_plans') && opts.method === 'POST') {
    const body = JSON.parse(opts.body);
    const merged = { ...(db.get(body.guild_id) || {}), ...body };
    db.set(body.guild_id, merged);
    return { ok: true, status: 200, json: async () => [merged] };
  }
  throw new Error('unexpected fetch: ' + u);
};

const billing = require(path.join(ROOT, 'src/denizen-guild-billing.js'));
const plans = require(path.join(ROOT, 'src/denizen-guild-plans.js'));

const sign = (body, secret, ts = Math.floor(Date.now() / 1000)) =>
  `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex')}`;

const GID = '111';
const checkoutEvt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { guild_id: GID }, customer: 'cus_1', subscription: 'sub_1' } } });

test('signed checkout grants pro; premium module allowed', async () => {
  const r = await billing.handleGuildBillingWebhook(checkoutEvt, sign(checkoutEvt, 'whsec_test'));
  assert.strictEqual(r.ok, true);
  plans.invalidate(GID);
  assert.strictEqual(await plans.isModuleAllowed(GID, 'security'), true);
  assert.ok(db.get(GID).current_period_end, 'current_period_end persisted from item level');
});

test('replayed stale-timestamp event is rejected', async () => {
  const oldTs = Math.floor(Date.now() / 1000) - 600;
  const r = await billing.handleGuildBillingWebhook(checkoutEvt, sign(checkoutEvt, 'whsec_test', oldTs));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'bad_signature');
});

test('multi-v1 header (secret rotation) is accepted', async () => {
  const ts = Math.floor(Date.now() / 1000);
  const real = crypto.createHmac('sha256', 'whsec_test').update(`${ts}.${checkoutEvt}`, 'utf8').digest('hex');
  const r = await billing.handleGuildBillingWebhook(checkoutEvt, `t=${ts},v1=deadbeef,v1=${real}`);
  assert.strictEqual(r.ok, true);
});

test('wrong-secret signature is rejected', async () => {
  const r = await billing.handleGuildBillingWebhook(checkoutEvt, sign(checkoutEvt, 'wrong_secret'));
  assert.strictEqual(r.error, 'bad_signature');
});

test('past_due within paid period keeps premium (grace window)', async () => {
  stripeSubStatus = 'past_due';
  const upd = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', metadata: { guild_id: GID }, items: { data: [stripeItem] }, customer: 'cus_1' } } });
  const r = await billing.handleGuildBillingWebhook(upd, sign(upd, 'whsec_test'));
  assert.strictEqual(r.ok, true);
  plans.invalidate(GID);
  assert.strictEqual(await plans.isModuleAllowed(GID, 'security'), true);
});

test('cancel without metadata resolves via subscription_id and reverts to free', async () => {
  const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const r = await billing.handleGuildBillingWebhook(del, sign(del, 'whsec_test'));
  assert.strictEqual(r.ok, true);
  plans.invalidate(GID);
  assert.strictEqual(await plans.isModuleAllowed(GID, 'security'), false);
  assert.strictEqual(db.get(GID).plan, 'free');
});

test('free modules are always allowed', async () => {
  assert.strictEqual(await plans.isModuleAllowed(GID, 'moderation'), true);
});
