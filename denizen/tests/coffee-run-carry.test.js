'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Coffee run carry-through delivery', () => {
  it('goToCoffee holds a mug and can hand it off to a desk', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /goToCoffee\(npcKey,\s*opts\s*=\s*\{\}\)/);
    assert.match(actions, /holdMs/);
    assert.match(actions, /_holdCoffeeMug/);
    assert.match(actions, /mode:\s*'carry'/);
    assert.match(actions, /deliverCoffeeMug\(/);
    assert.match(actions, /_ensureDeskProp\(/);
  });

  it('ambient coffee favor carries mug until delivery and logs the floor strip', () => {
    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /goToCoffee\(runner\.npcKey,\s*\{\s*holdMs:\s*null,\s*carry:\s*true\s*\}\)/);
    assert.match(mgr, /deliverCoffeeMug/);
    assert.match(mgr, /Coffee run for/);
    assert.match(mgr, /Asked .* for a coffee run/);
    assert.match(mgr, /DenizenFloorStrip/);
  });

  it('cache busters bumped for coffee carry', () => {
    const html = read('index.html');
    assert.match(html, /agent-actions\.js\?v=floorBounds1/);
    assert.match(html, /agent-office-manager\.js\?v=engineTools3/);
  });
});
