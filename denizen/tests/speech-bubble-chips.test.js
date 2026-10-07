'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Compact readable speech bubbles', () => {
  it('uses short high-contrast chips with side-then-up collision', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /maxChars = isThought \? 28 : 36/);
    assert.match(actions, /Segoe UI, system-ui/);
    assert.match(actions, /maxLines:\s*2/);
    assert.match(actions, /setShadow/);
    assert.match(actions, /sideCandidates/);
    assert.match(actions, /Nudge up when another live bubble/);
    assert.match(actions, /xOff/);
  });

  it('cache-busts the bubble chip pass', () => {
    const html = read('index.html');
    assert.match(html, /agent-actions\.js\?v=bubbleChip1/);
  });
});
