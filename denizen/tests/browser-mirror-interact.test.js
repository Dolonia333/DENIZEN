'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  INTERACT_MODES,
  normalizeInteractMode,
  buildPointInstruction,
  interactModeHint,
} = require('../src/browser-mirror-interact');

describe('browser-mirror-interact', () => {
  it('normalizes modes', () => {
    assert.deepEqual(INTERACT_MODES, ['watch', 'drive', 'point']);
    assert.equal(normalizeInteractMode('DRIVE'), 'drive');
    assert.equal(normalizeInteractMode('nope'), 'watch');
  });

  it('builds a point instruction with coords and request', () => {
    const text = buildPointInstruction({
      x: 120.4,
      y: 88.9,
      text: 'click the Apply button',
      url: 'https://example.com/jobs',
      title: 'Jobs',
      query: 'remote engineer',
    });
    assert.match(text, /\(120, 89\)/);
    assert.match(text, /click the Apply button/);
    assert.match(text, /https:\/\/example\.com\/jobs/);
    assert.match(text, /remote engineer/);
    assert.match(text, /Screenshot first/);
  });

  it('returns empty instruction without text', () => {
    assert.equal(buildPointInstruction({ x: 1, y: 2, text: '  ' }), '');
  });

  it('explains each mode', () => {
    assert.match(interactModeHint('watch'), /Watch/i);
    assert.match(interactModeHint('drive'), /Drive/i);
    assert.match(interactModeHint('point'), /Point/i);
  });
});
