'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SlotStore, emptyGuild, computeEndTime } = require('../src/modules/slots/slot-store');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-store-'));
  return { store: new SlotStore({ dir }), dir };
}

describe('SlotStore', () => {
  it('ensure creates empty guild file with defaults', () => {
    const { store, dir } = tmpStore();
    const data = store.ensure('g1');
    assert.deepEqual(Object.keys(data).sort(), Object.keys(emptyGuild()).sort());
    assert.ok(fs.existsSync(path.join(dir, 'g1.json')));
  });

  it('upsert, get, and remove slots', () => {
    const { store } = tmpStore();
    const entry = {
      channelId: 'c1',
      userId: 'u1',
      endtime: computeEndTime(7, 'd'),
      pingCount: 0,
      maxPings: 3,
      createdAt: 1,
      createdBy: 'admin',
      warnings: 0,
      held: false,
      name: 'slot-one',
    };
    store.upsertSlot('g1', entry);
    assert.deepEqual(store.getSlot('g1', 'c1'), entry);
    assert.deepEqual(store.getSlotByUser('g1', 'u1'), entry);
    assert.equal(store.listSlots('g1').length, 1);

    const removed = store.removeSlot('g1', 'c1');
    assert.deepEqual(removed, entry);
    assert.equal(store.getSlot('g1', 'c1'), null);
  });

  it('blacklist set, check, and clear', () => {
    const { store } = tmpStore();
    assert.equal(store.isBlacklisted('g1', 'u9'), false);
    store.setBlacklist('g1', 'u9', { reason: 'spam', by: 'mod' });
    assert.equal(store.isBlacklisted('g1', 'u9'), true);
    const row = store.clearBlacklist('g1', 'u9');
    assert.equal(row.reason, 'spam');
    assert.equal(store.isBlacklisted('g1', 'u9'), false);
  });

  it('redeem lifecycle: create, redeem, exhaust, delete', () => {
    const { store } = tmpStore();
    const redeem = store.createRedeem('g1', {
      code: 'TESTCODE',
      duration: 30,
      unit: 'd',
      pings: 2,
      categoryIndex: 1,
      maxUses: 2,
      createdBy: 'admin',
    });
    assert.equal(redeem.code, 'TESTCODE');
    assert.equal(store.listRedeems('g1').length, 1);

    const r1 = store.redeemCode('g1', 'u1', 'TESTCODE');
    assert.equal(r1.error, undefined);
    assert.equal(r1.uses, 1);
    assert.ok(r1.redeemedBy.u1);

    const dup = store.redeemCode('g1', 'u1', 'TESTCODE');
    assert.equal(dup.error, 'already_redeemed');

    const r2 = store.redeemCode('g1', 'u2', 'TESTCODE');
    assert.equal(r2.uses, 2);

    const exhausted = store.redeemCode('g1', 'u3', 'TESTCODE');
    assert.equal(exhausted.error, 'exhausted');

    const deleted = store.deleteRedeem('g1', 'TESTCODE');
    assert.equal(deleted.code, 'TESTCODE');
    assert.equal(store.listRedeems('g1').length, 0);
  });

  it('redeemCode returns not_found for missing code', () => {
    const { store } = tmpStore();
    assert.equal(store.redeemCode('g1', 'u1', 'NOPE').error, 'not_found');
  });
});

describe('computeEndTime', () => {
  it('adds days and months from now', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(computeEndTime(1, 'd'), now + 86400);
    assert.equal(computeEndTime(1, 'm'), now + 30 * 86400);
  });

  it('rejects invalid unit', () => {
    assert.throws(() => computeEndTime(1, 'y'), /invalid unit/);
  });
});
