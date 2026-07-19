'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WalletStore } = require('../src/core/wallet-store');
const { resolveRound, hpBar } = require('../src/modules/pvp');

test('resolveRound Attack beats Feint', () => {
  const r = resolveRound('attack', 'feint');
  assert.equal(r.bDmg, 28);
  assert.equal(r.aDmg, 0);
});

test('resolveRound Guard beats Attack', () => {
  const r = resolveRound('guard', 'attack');
  assert.equal(r.bDmg, 14);
  assert.equal(r.aDmg, 0);
});

test('resolveRound same move chips both', () => {
  const r = resolveRound('attack', 'attack');
  assert.equal(r.aDmg, 8);
  assert.equal(r.bDmg, 8);
});

test('hpBar renders', () => {
  assert.match(hpBar(100), /100\/100/);
  assert.match(hpBar(0), /0\/100/);
});

test('WalletStore start balance, claim, escrow, pot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-wallet-'));
  const w = new WalletStore({ dir, startBalance: 100 });
  const g = 'guild1';
  assert.equal(w.getBalance(g, 'a'), 100);
  assert.equal(w.getBalance(g, 'b'), 100);
  assert.equal(w.canClaimDaily(g, 'a'), true);
  w.markClaimed(g, 'a');
  w.add(g, 'a', 50, { reason: 'daily_claim' });
  assert.equal(w.getBalance(g, 'a'), 150);
  assert.equal(w.canClaimDaily(g, 'a'), false);

  const esc = w.escrowPair(g, 'a', 'b', 40);
  assert.equal(esc.ok, true);
  assert.equal(w.getBalance(g, 'a'), 110);
  assert.equal(w.getBalance(g, 'b'), 60);
  w.payPot(g, 'a', 80);
  assert.equal(w.getBalance(g, 'a'), 190);

  w.setHold(g, 'b', Date.now() + 60_000);
  assert.equal(w.isHeld(g, 'b'), true);
  w.clearHold(g, 'b');
  assert.equal(w.isHeld(g, 'b'), false);

  w.recordDuelResult(g, 'a', 'b', { wager: 40 });
  const stats = w.getDuelStats(g, 'a');
  assert.equal(stats.wins, 1);
  assert.equal(w.getDuelStats(g, 'b').losses, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
