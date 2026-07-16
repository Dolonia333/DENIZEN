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
    assert.equal(av.hair.index, 49);
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

  it('seasonal unlocks include halloween in October', () => {
    const events = api.getActiveEvents(new Date(Date.UTC(2026, 9, 15))); // Oct
    assert.ok(events.some((e) => e.id === 'halloween'));
    const unlocks = api.resolveUnlocks({});
    // resolveUnlocks uses real now — just ensure API shape
    assert.ok(Array.isArray(unlocks));
  });
});
