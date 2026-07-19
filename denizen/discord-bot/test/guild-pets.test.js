'use strict';

/**
 * Per-server pet entitlements: purchase, gift, Pro grant pool, cancel strips pro_grant.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_PRICE_PRO = 'price_pro';
process.env.STRIPE_PRICE_PET = 'price_pet';
process.env.STRIPE_GUILD_WEBHOOK_SECRET = 'whsec_test';

const plansDb = new Map();
const petsDb = new Map(); // key `${guild}|${user}`

function petKey(g, u) {
  return `${g}|${u}`;
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions') && opts.method === 'POST') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_pet_1', url: 'https://checkout.stripe.test/pet' }),
    };
  }
  if (u.startsWith('https://api.stripe.com/v1/subscriptions/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'sub_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      }),
    };
  }
  if (u.includes('/rest/v1/denizen_guild_plans')) {
    if (!opts.method || opts.method === 'GET') {
      const gid = decodeURIComponent(u.split('guild_id=eq.')[1].split('&')[0]);
      const row = plansDb.get(gid);
      return { ok: true, status: 200, json: async () => (row ? [row] : []) };
    }
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const merged = { ...(plansDb.get(body.guild_id) || {}), ...body };
      if (body.metadata && plansDb.get(body.guild_id)?.metadata) {
        merged.metadata = { ...plansDb.get(body.guild_id).metadata, ...body.metadata };
      }
      plansDb.set(body.guild_id, merged);
      return { ok: true, status: 200, json: async () => [merged] };
    }
  }
  if (u.includes('/rest/v1/denizen_guild_pet_entitlements')) {
    if ((!opts.method || opts.method === 'GET') && u.includes('guild_id=eq.')) {
      const gid = decodeURIComponent(u.split('guild_id=eq.')[1].split('&')[0]);
      const rows = [...petsDb.values()].filter((r) => r.guild_id === gid);
      return { ok: true, status: 200, json: async () => rows };
    }
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const k = petKey(body.guild_id, body.user_id);
      const merged = { ...(petsDb.get(k) || {}), ...body };
      petsDb.set(k, merged);
      return { ok: true, status: 200, json: async () => [merged] };
    }
    if (opts.method === 'DELETE') {
      const gid = decodeURIComponent(u.split('guild_id=eq.')[1].split('&')[0]);
      if (u.includes('source=eq.pro_grant')) {
        for (const [k, r] of [...petsDb.entries()]) {
          if (r.guild_id === gid && r.source === 'pro_grant') petsDb.delete(k);
        }
      } else if (u.includes('user_id=eq.')) {
        const uid = decodeURIComponent(u.split('user_id=eq.')[1].split('&')[0]);
        petsDb.delete(petKey(gid, uid));
      }
      return { ok: true, status: 200, json: async () => [] };
    }
  }
  throw new Error('unexpected fetch: ' + u);
};

// Clear module cache so env + fetch apply
delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-guild-plans.js'))];
delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-guild-pets.js'))];
delete require.cache[require.resolve(path.join(ROOT, 'src/denizen-guild-billing.js'))];

const pets = require(path.join(ROOT, 'src/denizen-guild-pets.js'));
const plans = require(path.join(ROOT, 'src/denizen-guild-plans.js'));
const billing = require(path.join(ROOT, 'src/denizen-guild-billing.js'));

const GID = 'guild_pets_1';

function sign(body) {
  const secret = process.env.STRIPE_GUILD_WEBHOOK_SECRET;
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

test('purchase grants entitlement; gift transfers; target conflict fails', async () => {
  pets.invalidate(GID);
  plans.invalidate(GID);
  petsDb.clear();
  plansDb.clear();

  const bought = await pets.grantFromPurchase({
    guildId: GID,
    userId: 'u1',
    stripeSessionId: 'cs_1',
  });
  assert.equal(bought.ok, true);
  assert.equal(await pets.hasPetEntitlement(GID, 'u1'), true);

  const giftFail = await pets.giftPet({ guildId: GID, fromUserId: 'u1', toUserId: 'u1' });
  assert.equal(giftFail.error, 'self_gift');

  const gift = await pets.giftPet({ guildId: GID, fromUserId: 'u1', toUserId: 'u2' });
  assert.equal(gift.ok, true);
  assert.equal(await pets.hasPetEntitlement(GID, 'u1'), false);
  assert.equal(await pets.hasPetEntitlement(GID, 'u2'), true);
});

test('Pro grant pool assign and revoke; cancel strips pro_grant only', async () => {
  pets.invalidate(GID);
  plans.invalidate(GID);
  petsDb.clear();
  plansDb.clear();

  await plans.setGuildPlanFromStripe({
    guild_id: GID,
    plan: 'pro',
    status: 'active',
    metadata: {},
  });
  await pets.syncProGrantPool(GID, true);
  assert.equal(await pets.getGrantRemaining(GID), 3);

  await pets.grantFromPurchase({ guildId: GID, userId: 'buyer', stripeSessionId: 'cs_b' });

  const g1 = await pets.assignProGrant({ guildId: GID, granterId: 'owner', toUserId: 'a' });
  assert.equal(g1.ok, true);
  assert.equal(g1.remaining, 2);
  const g2 = await pets.assignProGrant({ guildId: GID, granterId: 'owner', toUserId: 'b' });
  assert.equal(g2.remaining, 1);
  const g3 = await pets.assignProGrant({ guildId: GID, granterId: 'owner', toUserId: 'c' });
  assert.equal(g3.remaining, 0);
  const g4 = await pets.assignProGrant({ guildId: GID, granterId: 'owner', toUserId: 'd' });
  assert.equal(g4.error, 'no_grants_left');

  const rev = await pets.revokeProGrant({ guildId: GID, userId: 'a' });
  assert.equal(rev.ok, true);
  assert.ok(rev.remaining >= 1);

  // Cancel Pro — strip grants, keep purchase
  await pets.syncProGrantPool(GID, false);
  assert.equal(await pets.hasPetEntitlement(GID, 'b'), false);
  assert.equal(await pets.hasPetEntitlement(GID, 'buyer'), true);
});

test('pet checkout session create + webhook grants beneficiary', async () => {
  pets.invalidate(GID);
  petsDb.clear();

  const session = await billing.createPetCheckout({
    guildId: GID,
    discordUserId: 'buyer1',
    giftToUserId: 'friend1',
  });
  assert.equal(session.ok, true);
  assert.match(session.url, /checkout\.stripe/);

  const body = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_webhook_pet',
        mode: 'payment',
        payment_intent: 'pi_1',
        metadata: {
          product: 'pet',
          guild_id: GID,
          buyer_id: 'buyer1',
          beneficiary_id: 'friend1',
        },
      },
    },
  });
  const result = await billing.handleGuildBillingWebhook(body, sign(body));
  assert.equal(result.ok, true);
  assert.equal(result.handled, 'pet_purchase');
  assert.equal(await pets.hasPetEntitlement(GID, 'friend1'), true);
});
