'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WalletStore, isoWeekKey } = require('../src/core/wallet-store');
const { generateRedeemCode, normalizeCode, isValidCodeFormat } = require('../src/modules/economy/redeem-util');

function tmpWallet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-wallet-phase4-'));
  return { dir, wallet: new WalletStore({ dir, startBalance: 100 }) };
}

test('redeem-util generates well-formed unique codes', () => {
  const a = generateRedeemCode();
  const b = generateRedeemCode();
  assert.match(a, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.notEqual(a, b);
  assert.equal(normalizeCode(' abc-123 '), 'ABC-123');
  assert.equal(isValidCodeFormat(a), true);
  assert.equal(isValidCodeFormat('bad code'), false);
});

test('WalletStore redeem lifecycle: create, redeem, exhaust, delete', () => {
  const { dir, wallet: w } = tmpWallet();
  const g = 'guild-redeem';

  const created = w.createRedeem(g, { amount: 50, maxUses: 2, code: 'WELCOME-50', createdBy: 'staff1' });
  assert.equal(created.ok, true);
  assert.equal(created.code, 'WELCOME-50');

  // Duplicate code rejected
  const dupe = w.createRedeem(g, { amount: 10, code: 'WELCOME-50', createdBy: 'staff1' });
  assert.equal(dupe.ok, false);

  // First user redeems successfully
  const r1 = w.redeemCode(g, 'userA', 'welcome-50'); // lower-case input normalizes
  assert.equal(r1.ok, true);
  assert.equal(r1.amount, 50);
  assert.equal(w.getBalance(g, 'userA'), 150);

  // Same user cannot redeem twice
  const r1Again = w.redeemCode(g, 'userA', 'WELCOME-50');
  assert.equal(r1Again.ok, false);

  // Second (different) user can redeem — maxUses is 2
  const r2 = w.redeemCode(g, 'userB', 'WELCOME-50');
  assert.equal(r2.ok, true);

  // Uses exhausted for a third user
  const r3 = w.redeemCode(g, 'userC', 'WELCOME-50');
  assert.equal(r3.ok, false);
  assert.match(r3.error, /no uses left/i);

  // Invalid code
  const bad = w.redeemCode(g, 'userD', 'NOPE-0000');
  assert.equal(bad.ok, false);

  // Listing + deletion
  const list = w.listRedeems(g);
  assert.equal(list.length, 1);
  const del = w.deleteRedeem(g, 'welcome-50');
  assert.equal(del.ok, true);
  assert.equal(w.listRedeems(g).length, 0);
  assert.equal(w.deleteRedeem(g, 'welcome-50').ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('WalletStore.getHistory filters by credits vs duels', () => {
  const { dir, wallet: w } = tmpWallet();
  const g = 'guild-history';

  w.add(g, 'u1', 25, { reason: 'test_credit' });
  w.escrowPair(g, 'u1', 'u2', 10);
  w.recordDuelResult(g, 'u1', 'u2', { wager: 10 });
  w.createRedeem(g, { amount: 5, code: 'HIST-CODE', createdBy: 'staff' });
  w.redeemCode(g, 'u3', 'HIST-CODE');

  const all = w.getHistory(g, { limit: 15 });
  assert.ok(all.length >= 5);

  const duels = w.getHistory(g, { type: 'duels', limit: 15 });
  assert.ok(duels.every((h) => h.type === 'duel' || h.type === 'escrow'));
  assert.ok(duels.some((h) => h.type === 'duel'));

  const credits = w.getHistory(g, { type: 'credits', limit: 15 });
  assert.ok(credits.every((h) => h.type !== 'duel' && h.type !== 'escrow'));
  assert.ok(credits.some((h) => h.type === 'redeem'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('WalletStore weekly reset + addWeeklyWin roll over on new ISO week', () => {
  const { dir, wallet: w } = tmpWallet();
  const g = 'guild-weekly';

  assert.equal(w.getWeeklyWins(g, 'u1'), 0);
  w.addWeeklyWin(g, 'u1');
  w.addWeeklyWin(g, 'u1');
  assert.equal(w.getWeeklyWins(g, 'u1'), 2);

  const thisWeek = isoWeekKey(new Date());
  assert.equal(w.load(g).weekKey, thisWeek);

  // Simulate an old week key on disk — ensureWeeklyReset should roll it over.
  const data = w.load(g);
  data.weekKey = '2000-W01';
  data.weeklyDuelWins = { u1: 99 };
  w.save(g);

  assert.equal(w.getWeeklyWins(g, 'u1'), 0);
  assert.equal(w.load(g).weekKey, thisWeek);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('WalletStore.addChatDrip caps daily earnings per user', () => {
  const { dir, wallet: w } = tmpWallet();
  const g = 'guild-drip';

  const r1 = w.addChatDrip(g, 'u1', 40);
  assert.equal(r1.credited, 40);
  assert.equal(r1.capped, false);
  assert.equal(w.getBalance(g, 'u1'), 140);

  const r2 = w.addChatDrip(g, 'u1', 40);
  assert.equal(r2.credited, 40);
  assert.equal(w.getBalance(g, 'u1'), 180);

  // Only 20 left before hitting the 100/day cap — request for 40 gets clipped.
  const r3 = w.addChatDrip(g, 'u1', 40);
  assert.equal(r3.credited, 20);
  assert.equal(r3.capped, true);
  assert.equal(w.getBalance(g, 'u1'), 200);

  // Fully capped now.
  const r4 = w.addChatDrip(g, 'u1', 5);
  assert.equal(r4.credited, 0);
  assert.equal(r4.capped, true);
  assert.equal(w.getBalance(g, 'u1'), 200);
  assert.equal(w.chatDripRemaining(g, 'u1'), 0);

  // A different user is unaffected.
  const other = w.addChatDrip(g, 'u2', 30);
  assert.equal(other.credited, 30);

  fs.rmSync(dir, { recursive: true, force: true });
});
