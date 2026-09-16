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

  it('falls back to mic dictate when browser speech fails and keeps the file input attached', () => {
    assert.match(buzz, /abandonSpeechForMic/);
    assert.match(buzz, /Clear the half-started speech session/);
    assert.match(buzz, /document\.body\.appendChild\(input\)/);
    assert.match(buzz, /captureGen/);
    assert.match(buzz, /speechSession/);
  });

  it('keeps Buzz note dismissible above the phone FAB on mobile', () => {
    assert.match(buzz, /denizen-buzz-note-open/);
    assert.match(buzz, /z-index: 2147483646/);
    assert.match(buzz, /data-note="discard"/);
    assert.match(buzz, /aria-label="Close note"/);
    assert.match(buzz, /pointerup is reliable on iOS \(same pattern as the ring\)/);
    const corner = fs.readFileSync(path.join(ROOT, 'src', 'corner-hud-autohide.js'), 'utf8');
    assert.match(corner, /denizen-buzz-note-open[\s\S]*?pointer-events: none !important/);
  });

  it('labels ring actions and uses kind-specific Buzz note chrome', () => {
    assert.match(buzz, /bz-act-label/);
    assert.match(buzz, /function noteChrome/);
    assert.match(buzz, /label: 'Shot'/);
    assert.match(buzz, /label: 'Record'/);
    assert.match(buzz, /title: 'Screenshot'/);
    assert.match(buzz, /title: 'Meet'/);
    assert.match(buzz, /title: 'Say'/);
    assert.match(buzz, /title: 'Record'/);
    assert.match(buzz, /showBuzzToast/);
    assert.match(buzz, /Shorter than Meet/);
  });
});
