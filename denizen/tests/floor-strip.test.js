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
  it('keeps lines on the frame and opens the matching thread', () => {
    const strip = read('src/floor-strip.js');
    assert.match(strip, /STRIP_ID = 'denizen-floor-strip'/);
    assert.match(strip, /openWithNpc\(key, name, \{ walk: false \}\)/);
    assert.match(strip, /The floor is quiet/);
    const actions = read('src/agent-actions.js');
    assert.match(actions, /DenizenFloorStrip\?\.push/);
    assert.match(actions, /\$\{who\} → \$\{toName\}/);
    assert.match(actions, /setDeskStatus\(npcKey, status/);
    assert.match(actions, /yOff: 54/);
  });

  it('puts director failure on Abby instead of a top banner', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /DenizenFloorStrip\?\.pin/);
    assert.match(mgr, /Can’t reach the model/);
    assert.doesNotMatch(mgr, /position:fixed', 'top:10px'/);
  });
});
