'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WalletStore } = require('../src/core/wallet-store');
const { resolveRps, flipCoin } = require('../src/modules/minigames');

test('resolveRps rock beats scissors', () => {
  const r = resolveRps('rock', 'scissors');
  assert.equal(r.winner, 'a');
  assert.match(r.note, /Rock/);
});

test('resolveRps paper beats rock', () => {
  const r = resolveRps('paper', 'rock');
  assert.equal(r.winner, 'a');
});

test('resolveRps scissors beats paper', () => {
  const r = resolveRps('scissors', 'paper');
  assert.equal(r.winner, 'a');
});

test('resolveRps same pick is draw', () => {
  const r = resolveRps('rock', 'rock');
  assert.equal(r.winner, null);
  assert.match(r.note, /draw/i);
});

test('resolveRps b wins when a loses', () => {
  const r = resolveRps('rock', 'paper');
  assert.equal(r.winner, 'b');
});

test('flipCoin returns heads or tails', () => {
  const results = new Set();
  for (let i = 0; i < 50; i += 1) {
    results.add(flipCoin());
  }
  assert.ok(results.has('heads'));
  assert.ok(results.has('tails'));
  for (const v of results) {
    assert.ok(v === 'heads' || v === 'tails');
  }
});

test('WalletStore escrow + payPot minigame path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-minigames-'));
  const w = new WalletStore({ dir, startBalance: 100 });
  const g = 'guild1';

  assert.equal(w.getBalance(g, 'a'), 100);
  assert.equal(w.getBalance(g, 'b'), 100);

  const esc = w.escrowPair(g, 'a', 'b', 25);
  assert.equal(esc.ok, true);
  assert.equal(w.getBalance(g, 'a'), 75);
  assert.equal(w.getBalance(g, 'b'), 75);

  w.payPot(g, 'b', 50, { matchId: 'test-cf', game: 'coinflip' });
  assert.equal(w.getBalance(g, 'b'), 125);
  assert.equal(w.getBalance(g, 'a'), 75);

  w.refundEscrow(g, 'a', 'b', 10, { matchId: 'test-draw', reason: 'rps_draw' });
  assert.equal(w.getBalance(g, 'a'), 85);
  assert.equal(w.getBalance(g, 'b'), 135);

  fs.rmSync(dir, { recursive: true, force: true });
});
