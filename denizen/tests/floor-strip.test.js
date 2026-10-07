'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('floor conversation strip', () => {
  it('keeps lines under the map canvas and opens the matching thread', () => {
    const strip = read('src/floor-strip.js');
    assert.match(strip, /STRIP_ID = 'denizen-floor-strip'/);
    assert.match(strip, /openWithNpc\(key, name, \{ walk: false \}\)/);
    assert.match(strip, /map\.insertAdjacentElement\('afterend'/);
    assert.match(strip, /has-lines/);
    assert.match(strip, /raw\.from \|\| raw\.name/);
    assert.doesNotMatch(strip, /The floor is quiet/);
    const actions = read('src/agent-actions.js');
    assert.match(actions, /DenizenFloorStrip\?\.push/);
    assert.match(actions, /\$\{who\} → \$\{toName\}/);
    assert.match(actions, /setDeskStatus\(npcKey, status/);
    assert.match(actions, /yOff: 54/);
  });

  it('does not replace in-world NPC speech bubbles', () => {
    const strip = read('src/floor-strip.js');
    const actions = read('src/agent-actions.js');
    assert.match(strip, /speech bubbles .* are separate/i);
    assert.match(actions, /_showSpeechBubble/);
    assert.match(actions, /Nudge up when another live bubble/);
  });

  it('puts director failure on Abby instead of a top banner', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /DenizenFloorStrip\?\.pin/);
    assert.match(mgr, /Can’t reach the model/);
    assert.doesNotMatch(mgr, /position:fixed', 'top:10px'/);
  });
});
