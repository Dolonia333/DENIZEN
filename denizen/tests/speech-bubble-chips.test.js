'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Compact readable speech bubbles', () => {
  it('uses hi-res chips, hides nameplate while speaking, side-then-up collision', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /maxChars = isThought \? 28 : 34/);
    assert.match(actions, /Segoe UI, system-ui/);
    assert.match(actions, /hide the white nameplate/i);
    assert.match(actions, /_setNameplateVisible\(npcKey, false\)/);
    assert.match(actions, /_clearSpeechBubble/);
    assert.match(actions, /setResolution\(3\)/);
    assert.match(actions, /fontSize: isThought \? '12px' : '14px'/);
    assert.match(actions, /setScale\(0\.5\)/);
    assert.match(actions, /sideCandidates/);
    assert.match(actions, /Nudge up when another live bubble/);
    assert.match(actions, /worldView/);
    assert.match(actions, /xOff/);
    assert.doesNotMatch(actions, /maxLines:\s*2/);
  });

  it('cache-busts the bubble chip pass', () => {
    const html = read('index.html');
    assert.match(html, /agent-actions\.js\?v=floorBounds1/);
  });
});
