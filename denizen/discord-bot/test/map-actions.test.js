'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveFood,
  actionFromReaction,
  FOOD_CHOICES,
  FOOD_KEYS,
} = require('../src/map-actions');

describe('map-actions', () => {
  it('resolves food aliases and random', () => {
    assert.equal(resolveFood('pizza').key, 'foodPizza');
    assert.equal(resolveFood('burger').key, 'foodBurger');
    assert.equal(resolveFood('Ice Cream').key, 'foodIceCream');
    assert.equal(resolveFood('').ok, true);
    assert.ok(FOOD_KEYS.includes(resolveFood('').key));
    assert.equal(resolveFood('xyzzy').ok, false);
  });

  it('slash choices stay within Discord limit', () => {
    assert.ok(FOOD_CHOICES.length <= 25);
    assert.ok(FOOD_CHOICES.length >= 15);
  });

  it('maps reaction emoji to emote/eat', () => {
    assert.deepEqual(actionFromReaction({ name: 'wave' }), { kind: 'emote', pose: 'wave' });
    assert.deepEqual(actionFromReaction({ name: '😂' }), { kind: 'emote', pose: 'snicker' });
    assert.deepEqual(actionFromReaction({ name: 'pizza' }), {
      kind: 'eat', pose: 'eat', food: 'foodPizza',
    });
    assert.deepEqual(actionFromReaction({ name: '🍕' }), {
      kind: 'eat', pose: 'eat', food: 'foodPizza',
    });
    assert.equal(actionFromReaction({ name: '👍' }), null);
  });
});
