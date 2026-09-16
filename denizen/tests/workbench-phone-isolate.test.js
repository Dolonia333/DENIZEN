'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rail = fs.readFileSync(path.join(ROOT, 'src', 'work-rail.js'), 'utf8');
const chip = fs.readFileSync(path.join(ROOT, 'src', 'office-hq', 'office-level-chip.js'), 'utf8');
const phone = fs.readFileSync(path.join(ROOT, 'src', 'denizen-phone-ui.js'), 'utf8');

describe('Workbench phone isolate', () => {
  it('mounts a separate phone rail and does not sync laptop open state', () => {
    assert.match(rail, /denizen-work-rail-phone/);
    assert.match(rail, /PHONE_RAIL_ID/);
    assert.match(rail, /desktopOpenBeforePhone/);
    assert.match(rail, /Does not open, close, or steal the laptop sidebar/);
    assert.match(rail, /function mountPhone/);
    assert.match(rail, /function unmountPhone/);
    assert.match(rail, /buildPhoneChrome/);
    assert.doesNotMatch(
      rail,
      /function mountPhone[\s\S]*?host\.appendChild\(railEl\)/,
    );
  });

  it('phone Workbench uses Abby/Crew/Inbox tabs in the phone shell', () => {
    assert.match(rail, /role="tablist" aria-label="Workbench tabs"/);
    assert.match(phone, /id: 'workbench'/);
    assert.match(phone, /renderWorkbenchApp/);
    assert.match(phone, /mountPhone/);
  });

  it('hides Levels when the laptop workbench rail is extended', () => {
    assert.match(
      chip,
      /html\.denizen-work-rail-open:not\(\.denizen-phone\) #\$\{CHIP_ID\}[\s\S]*?display: none !important/,
    );
  });
});
