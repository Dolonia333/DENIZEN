'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const api = require('../src/discord-avatar');

describe('discord-avatar', () => {
  let dir;
  let store;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-avatar-'));
    store = new api.AvatarStore({ dir });
  });

  after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  it('defaultAvatar is stable for a user id', () => {
    const a = api.defaultAvatar('111');
    const b = api.defaultAvatar('111');
    assert.equal(a.premade, b.premade);
    assert.equal(a.mode, 'premade');
  });

  it('normalizeAvatar clamps and validates', () => {
    const av = api.normalizeAvatar({
      mode: 'layers',
      body: 'not-real',
      hair: { set: 'short', index: 999 },
      outfit: { set: 'outfits', index: -3 },
      tint: { hair: '#f0f', clothes: 'nope' },
    }, '1');
    assert.equal(av.body, 'light');
    // hair_short is a 50x6 variant catalog → indices clamp to 0..299
    assert.equal(av.hair.index, 299);
    assert.equal(av.outfit.index, 0);
    assert.equal(av.tint.hair, '#ff00ff');
    assert.equal(av.tint.clothes, null);
  });

  it('randomAvatar returns valid modes', () => {
    const av = api.randomAvatar('42');
    assert.ok(av.mode === 'premade' || av.mode === 'layers');
    assert.ok(av.premade.startsWith('npc_'));
  });

  it('store set/get bumps rev and writes json', () => {
    const a = store.set('12345', { mode: 'premade', premade: 'npc_m2' });
    assert.equal(a.premade, 'npc_m2');
    assert.ok(a.rev >= 1);
    const b = store.get('12345');
    assert.equal(b.premade, 'npc_m2');
    const c = store.set('12345', { ...b, premade: 'npc_f1' });
    assert.ok(c.rev > b.rev);
  });

  it('bakeSheet produces PNG for premade and layers', async () => {
    const premade = api.normalizeAvatar({ mode: 'premade', premade: 'npc_m1' }, '1');
    const buf1 = await api.bakeSheet(premade);
    assert.ok(buf1.length > 500);
    assert.equal(buf1[0], 0x89);
    assert.equal(buf1[1], 0x50); // P of PNG

    const layered = api.normalizeAvatar({
      mode: 'layers',
      body: 'light',
      hair: { set: 'short', index: 1 },
      outfit: { set: 'shirt', index: 2 },
    }, '2');
    const buf2 = await api.bakeSheet(layered);
    assert.ok(buf2.length > 500);
  });

  it('ensureBaked writes png file', async () => {
    const av = await api.ensureBaked(store, '777', {
      mode: 'premade',
      premade: 'npc_f2',
    });
    assert.ok(store.hasPng('777'));
    assert.ok(av.rev >= 1);
    const png = store.readPng('777');
    assert.ok(png && png.length > 500);
  });

  it('clientAvatar exposes sheetUrl', () => {
    const av = api.defaultAvatar('99');
    const c = api.clientAvatar(av, '99');
    assert.match(c.sheetUrl, /\/api\/discord\/avatar\/99\.png/);
  });

  it('normalize keeps pet field; pets are not guild-plan gated', () => {
    const freeFeat = api.planFeatures('free');
    assert.equal(freeFeat.companionPet, false);
    const paidFeat = api.planFeatures('pro');
    assert.equal(paidFeat.companionPet, false);

    const withPet = api.normalizeAvatar({
      mode: 'premade',
      premade: 'npc_m1',
      pet: { kind: 'dog', enabled: true },
    }, 'pet1');
    assert.equal(withPet.pet.kind, 'dog');
    assert.equal(withPet.pet.enabled, true);

    // Guild plan no longer strips pets — entitlement is checked elsewhere
    const kept = api.enforceAvatarPlan(withPet, 'pet1', { plan: 'free' });
    assert.equal(kept.avatar.pet.kind, 'dog');
    assert.equal(kept.avatar.pet.enabled, true);
    assert.ok(!kept.locked.includes('companionPet'));

    const client = api.clientAvatar(kept.avatar, 'pet1');
    assert.equal(client.pet.kind, 'dog');
  });

  it('seasonal unlocks include halloween in October', () => {
    const events = api.getActiveEvents(new Date(Date.UTC(2026, 9, 15))); // Oct
    assert.ok(events.some((e) => e.id === 'halloween'));
    const unlocks = api.resolveUnlocks({});
    // resolveUnlocks uses real now — just ensure API shape
    assert.ok(Array.isArray(unlocks));
  });

  it('boosters unlock golden headsets; non-boosters do not', () => {
    const free = api.resolveUnlocks({});
    assert.ok(!free.includes('role:booster'));
    const boost = api.resolveUnlocks({ isBooster: true });
    assert.ok(boost.includes('role:booster'));
    const hats = api.filterByUnlock(api.HAT_SETS, free).map((h) => h.id);
    assert.ok(!hats.includes('headsets'));
    const boostHats = api.filterByUnlock(api.HAT_SETS, boost).map((h) => h.id);
    assert.ok(boostHats.includes('headsets'));
  });

  it('applyBoosterGoldenHeadset equips headsets + gold tint', () => {
    const base = api.defaultAvatar('booster1');
    const { avatar, applied, note } = api.applyBoosterGoldenHeadset(base, { isBooster: true });
    assert.equal(applied, true);
    assert.match(note, /golden headset/i);
    assert.equal(avatar.hat.set, 'headsets');
    assert.equal(avatar.hat.source, 'role:booster');
    assert.equal(avatar.tint.hat, api.BOOSTER_GOLD || api.BOOSTER_HEADSET_GOLD);
    // Headset now overlays on a premade base (bakePremade → compositeHat) so the
    // character stays consistent across poses; only promote to layers with no
    // premade to sit the hat on.
    assert.equal(avatar.mode, base.premade ? 'premade' : 'layers');
    assert.ok(avatar.unlocks.includes('role:booster'));
  });

  it('store: a write from another process (second store, same dir) is seen without restart', () => {
    // The web server and bot sidecar each hold their own AvatarStore on the
    // same directory — simulate with two instances.
    const storeA = new api.AvatarStore({ dir });
    const storeB = new api.AvatarStore({ dir });
    storeA.set('crossproc', { mode: 'premade', premade: 'npc_m3' });
    assert.equal(storeB.get('crossproc').premade, 'npc_m3'); // first read
    // "Process A" saves a new look; B's mem cache must invalidate via mtime.
    const bumped = storeA.set('crossproc', { mode: 'premade', premade: 'npc_f5' });
    // Ensure mtime actually differs even on coarse filesystem clocks
    const p = path.join(dir, 'crossproc.json');
    fs.utimesSync(p, new Date(), new Date(Date.now() + 2000));
    const seen = storeB.get('crossproc');
    assert.equal(seen.premade, 'npc_f5');
    assert.equal(seen.rev, bumped.rev);
  });

  it('ensurePngOnDemand: single-flight shares one bake, 404s for unsaved users', async () => {
    const storeX = new api.AvatarStore({ dir });
    assert.equal(await api.ensurePngOnDemand(storeX, '424242424242'), null); // no saved look
    storeX.set('777', { mode: 'premade', premade: 'npc_m4' });
    const [a, b, c] = await Promise.all([
      api.ensurePngOnDemand(storeX, '777'),
      api.ensurePngOnDemand(storeX, '777'),
      api.ensurePngOnDemand(storeX, '777'),
    ]);
    assert.ok(Buffer.isBuffer(a) && a.length > 1000);
    assert.ok(a.equals(b) && b.equals(c), 'concurrent requests share one result');
    assert.ok(storeX.hasPng('777'), 'png persisted');
  });

  it('catalog counts expose full 2D variant ranges and defaults never pick specials', () => {
    const hats = api.HAT_SETS.find((h) => h.id === 'hats');
    assert.equal(hats.count, 400); // 50 cols x 8 rows
    const shortHair = api.HAIR_SETS.find((h) => h.id === 'short');
    assert.equal(shortHair.count, 300); // 50 x 6
    const outfits = api.OUTFIT_SETS.find((o) => o.id === 'outfits');
    assert.equal(outfits.count, 650); // 50 x 13
    // Ghost/skeleton are opt-in, never a hash default
    for (let i = 0; i < 200; i += 1) {
      const av = api.defaultAvatar(`user-${i}`);
      const meta = api.PREMADES.find((p) => p.id === av.premade);
      assert.ok(meta && !meta.special, `default premade ${av.premade} must not be special`);
    }
  });

  it('bakeSheet: row-variant indices select different art (2D catalog addressing)', async () => {
    const base = {
      mode: 'layers', body: 'light',
      hair: { set: 'short', index: 0 },
      outfit: { set: 'outfits', index: 0 },
      pants: { index: 0 }, hat: { set: 'none' },
    };
    const a = await api.bakeSheet(base);
    const b = await api.bakeSheet({ ...base, hat: { set: 'hats', index: 107 } });
    const c = await api.bakeSheet({ ...base, hat: { set: 'hats', index: 7 } });
    assert.notDeepEqual(a, b, 'row-2 hat variant must change the bake');
    assert.notDeepEqual(b, c, 'different hat rows must differ');
  });

  it('applyBoosterGoldenHeadset sits headset on a premade base (consistent poses)', () => {
    // normalizeAvatar always supplies a default premade, so boosters overlay
    // the headset on the premade instead of the pose-morphing layered path.
    const base = { mode: 'layers', body: 'light', hair: { set: 'short', index: 0 }, outfit: { set: 'shirt', index: 0 } };
    const { avatar } = api.applyBoosterGoldenHeadset(base, { isBooster: true }, { force: true });
    assert.equal(avatar.mode, 'premade');
    assert.ok(avatar.premade, 'premade base present');
    assert.equal(avatar.hat.set, 'headsets');
  });

  it('applyRoleCosmetics detects premiumSince as booster', () => {
    const member = {
      premiumSince: new Date(),
      permissions: { has: () => false },
      roles: { cache: new Map() },
    };
    const { avatar, roles, applied } = api.applyRoleCosmetics(api.defaultAvatar('x'), member);
    assert.equal(roles.isBooster, true);
    assert.equal(applied, true);
    assert.equal(avatar.hat.set, 'headsets');
  });

  it('bakeSheet includes golden headset layers', async () => {
    const { avatar } = api.applyBoosterGoldenHeadset(
      { mode: 'layers', body: 'light', hair: { set: 'short', index: 0 }, outfit: { set: 'shirt', index: 0 } },
      { isBooster: true },
    );
    const buf = await api.bakeSheet(avatar);
    assert.ok(buf.length > 500);
  });

  it('free plan forces premade — strips hair/clothes/hats', () => {
    const gated = api.enforceAvatarPlan({
      mode: 'layers',
      body: 'dark',
      hair: { set: 'long', index: 5 },
      outfit: { set: 'outfits', index: 9 },
      hat: { set: 'hats', index: 2 },
      tint: { hair: '#ff0000', clothes: '#00ff00' },
      premade: 'npc_f3',
    }, 'u1', { plan: 'free' });
    assert.equal(gated.avatar.mode, 'premade');
    assert.equal(gated.avatar.premade, 'npc_f3');
    assert.equal(gated.avatar.body, 'dark'); // free skin tone kept
    assert.equal(gated.avatar.hat.set, 'none');
    assert.equal(gated.features.free, true);
    assert.ok(gated.locked.includes('layers'));
  });

  it('paid plan allows layers and clothes', () => {
    const gated = api.enforceAvatarPlan({
      mode: 'layers',
      body: 'dark',
      hair: { set: 'long', index: 5 },
      outfit: { set: 'outfits', index: 9 },
      premade: 'npc_m1',
    }, 'u2', { plan: 'community' });
    assert.equal(gated.avatar.mode, 'layers');
    assert.equal(gated.avatar.outfit.index, 9);
    assert.equal(gated.features.clothes, true);
    assert.equal(gated.features.hairStyle, true);
  });

  it('free catalog hides hair/outfit options', () => {
    const cat = api.publicCatalogForPlan('free', []);
    assert.equal(cat.hairSets.length, 0);
    assert.equal(cat.outfitSets.length, 0);
    assert.ok(cat.premades.length >= 30);
    assert.ok(cat.monetization.paid.includes('clothes'));
  });
});
