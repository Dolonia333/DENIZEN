'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/map-engine.js');

const engine = global.window.DenizenMapEngine;

describe('desk lip and foot hitbox', () => {
  it('a wide desk blocks its full width and only a shallow lip', () => {
    const bounds = engine.resolveCollisionBounds({ type: 'surface' }, 96, 64);
    assert.equal(bounds.width, 96);
    assert.equal(bounds.height, 12);
    assert.equal(bounds.offsetY, 52);
  });

  it('an XP frame keeps the hitbox on the feet', () => {
    const foot = engine.footBodyForFrame(32, 48);
    assert.ok(foot.offsetY >= 32, 'body stays in the lower half of the frame');
    assert.equal(foot.offsetY + foot.height, 48);
    assert.equal(foot.offsetX + foot.width / 2, 16);
  });
});
