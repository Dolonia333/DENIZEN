'use strict';

// Premium event-hook gating: passive hooks (antinuke/antiraid/community) must
// run only for guilds with an active plan, while free-module hooks and DMs pass
// through untouched. Stubs Supabase via global.fetch: guild PAID has a pro row,
// guild FREE has none.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

const PAID = '1000';
const FREE = '2000';

global.fetch = async (url) => {
  const u = String(url);
  const gid = decodeURIComponent((u.split('guild_id=eq.')[1] || '').split('&')[0]);
  const row = gid === PAID ? [{ guild_id: PAID, plan: 'pro', status: 'active' }] : [];
  return { ok: true, status: 200, json: async () => row };
};

// Must set env + stub fetch before requiring (guild-plans reads env at load).
const { _gatedHook: gatedHook, _extractGuildId: extractGuildId } = require(
  path.resolve(__dirname, '..', 'src', 'modules', 'load-modules.js'),
);

test('extractGuildId pulls the id from each event arg shape', () => {
  assert.strictEqual(extractGuildId([{ guildId: 'g1' }]), 'g1');            // interaction / audit evt
  assert.strictEqual(extractGuildId([{ guild: { id: 'g2' } }]), 'g2');      // member / message
  assert.strictEqual(extractGuildId([{ message: { guild: { id: 'g3' } } }, {}]), 'g3'); // reaction
  assert.strictEqual(extractGuildId([{}, { guild: { id: 'g4' } }]), 'g4');  // (oldMember, newMember)
  assert.strictEqual(extractGuildId([null, 'x', 5]), null);                 // DM / no guild
});

test('premium hook is SKIPPED for a free guild', async () => {
  let ran = false;
  const wrapped = gatedHook('security', async () => { ran = true; });
  await wrapped({ guildId: FREE });
  assert.strictEqual(ran, false, 'antinuke/antiraid hook must not run for an unpaid guild');
});

test('premium hook RUNS for a paid guild', async () => {
  let ran = false;
  const wrapped = gatedHook('security', async () => { ran = true; });
  await wrapped({ guildId: PAID });
  assert.strictEqual(ran, true, 'premium hook runs when the guild has an active plan');
});

test('free-module hook is returned untouched (never gated, no DB hit)', async () => {
  const original = async () => 'ok';
  const wrapped = gatedHook('moderation', original);
  assert.strictEqual(wrapped, original, 'free modules pass through the same function reference');
});

test('premium hook runs when there is no guild context (DM)', async () => {
  let ran = false;
  const wrapped = gatedHook('community', async () => { ran = true; });
  await wrapped(null);
  assert.strictEqual(ran, true, 'no guild → gating does not apply');
});

test('gated hook return value propagates (for onInteraction handled flag)', async () => {
  const wrapped = gatedHook('community', async () => true);
  assert.strictEqual(await wrapped({ guildId: PAID }), true);
  assert.strictEqual(await wrapped({ guildId: FREE }), undefined, 'skipped hook returns undefined → loop continues');
});
