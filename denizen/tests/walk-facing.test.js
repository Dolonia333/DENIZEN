'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { chooseFacing } = require('../src/walk-facing');

describe('walk-facing', () => {
  it('keeps the current facing when a shove is only a little sideways', () => {
    const a = chooseFacing('right', 90, 40, { now: 1000, wasMoving: true });
    assert.equal(a.facing, 'right');
    assert.equal(a.moving, true);
  });

  it('turns once the new axis is clearly ahead and then holds', () => {
    const turn = chooseFacing('right', 20, 90, { now: 1000, holdUntil: 0, wasMoving: true });
    assert.equal(turn.facing, 'down');
    const held = chooseFacing('down', 90, 20, { now: 1100, holdUntil: turn.holdUntil, wasMoving: true });
    assert.equal(held.facing, 'down');
  });

  it('does not drop the walk cycle on a one-frame speed dip', () => {
    const dipped = chooseFacing('left', -6, 0, { now: 500, wasMoving: true });
    assert.equal(dipped.moving, true);
    assert.equal(dipped.facing, 'left');
    const stopped = chooseFacing('left', 0, 0, { now: 600, wasMoving: true });
    assert.equal(stopped.moving, false);
  });
});
