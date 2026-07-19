'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WalletStore } = require('../src/core/wallet-store');

describe('wallet SlotBot ops pack', () => {
  function tmpWallet() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-wallet-'));
    return new WalletStore({ dir, startBalance: 100 });
  }

  it('blacklist blocks detection and clears', () => {
    const w = tmpWallet();
    assert.equal(w.isBlacklisted('g1', 'u1'), false);
    w.setBlacklist('g1', 'u1', { by: 'staff', reason: 'abuse' });
    assert.equal(w.isBlacklisted('g1', 'u1'), true);
    assert.equal(w.getBlacklistEntry('g1', 'u1').reason, 'abuse');
    const cleared = w.clearBlacklist('g1', 'u1', { by: 'staff' });
    assert.equal(cleared.ok, true);
    assert.equal(w.isBlacklisted('g1', 'u1'), false);
  });

  it('warns accumulate and clear', () => {
    const w = tmpWallet();
    const a = w.addWarn('g1', 'u1', { by: 's', reason: 'one' });
    const b = w.addWarn('g1', 'u1', { by: 's', reason: 'two' });
    assert.equal(a.count, 1);
    assert.equal(b.count, 2);
    assert.equal(w.getWarns('g1', 'u1').length, 2);
    assert.equal(w.clearWarns('g1', 'u1').cleared, 2);
    assert.equal(w.getWarns('g1', 'u1').length, 0);
  });

  it('persists win streaks and ranks weekly winners', () => {
    const w = tmpWallet();
    assert.equal(w.addWinStreak('g1', 'w1'), 1);
    assert.equal(w.addWinStreak('g1', 'w1'), 2);
    w.breakStreak('g1', 'w1');
    assert.equal(w.getStreak('g1', 'w1'), 0);
    assert.equal(w.getDuelStats('g1', 'w1').bestStreak, 2);

    w.addWeeklyWin('g1', 'w1');
    w.addWeeklyWin('g1', 'w1');
    w.addWeeklyWin('g1', 'w2');
    const weekly = w.topWeeklyWins('g1', 5);
    assert.equal(weekly[0].userId, 'w1');
    assert.equal(weekly[0].wins, 2);
  });

  it('history filters by user', () => {
    const w = tmpWallet();
    w.transfer('g1', 'a', 'b', 10, { reason: 'pay' });
    w.add('g1', 'c', 5, { reason: 'bonus' });
    const aHist = w.getHistory('g1', { userId: 'a', limit: 10 });
    assert.ok(aHist.some((h) => h.type === 'transfer'));
    assert.ok(!aHist.some((h) => h.userId === 'c'));
  });
});
