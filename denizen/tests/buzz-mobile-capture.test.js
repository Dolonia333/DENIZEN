'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const buzz = fs.readFileSync(path.join(ROOT, 'src', 'buzz-capture.js'), 'utf8');

describe('Buzz mobile capture', () => {
  it('skips display capture on phone and keeps the picker on the gesture', () => {
    assert.match(buzz, /function isPhoneUi\(/);
    assert.match(buzz, /isPhoneUi\(\) \|\| !navigator\.mediaDevices\?\.getDisplayMedia/);
    assert.match(buzz, /pickImageFile\(\{ crop: true \}\)/);
    assert.match(buzz, /Keep the file picker on the same turn as the tap/);
  });

  it('does not auto-dismiss the ring after a touch lift', () => {
    assert.match(buzz, /function useHoverDismiss\(/);
    assert.match(buzz, /pointer: coarse/);
    assert.match(buzz, /hover: none/);
    assert.match(buzz, /if \(!useHoverDismiss\(\)\) return;/);
  });

  it('supports touch crop and mic-only meet on phone', () => {
    assert.match(buzz, /pointerdown/);
    assert.match(buzz, /setPointerCapture/);
    assert.match(buzz, /startMicOnlyMeeting/);
    assert.match(buzz, /Recording on this mic/);
  });

  it('hides desktop-only ring actions and lets taps through the FAB', () => {
    assert.match(buzz, /if \(!isPhoneUi\(\)\)/);
    assert.match(buzz, /data-act="desktop"/);
    assert.match(buzz, /pointer-events: none !important/);
    assert.match(buzz, /z-index: 2147483645/);
    assert.match(buzz, /pointerup/);
    assert.match(buzz, /syncRingActions/);
    const corner = fs.readFileSync(path.join(ROOT, 'src', 'corner-hud-autohide.js'), 'utf8');
    assert.match(corner, /denizen-buzz-ring-open[\s\S]*?pointer-events: none !important/);
    assert.doesNotMatch(
      corner,
      /html\.denizen-buzz-ring-open #denizen-phone-fab[\s\S]*?pointer-events: auto !important/,
    );
  });
});
