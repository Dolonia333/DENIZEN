'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = readFileSync(
  path.join(__dirname, '..', 'src', 'device-profile.js'),
  'utf8',
);

function runProfile(width, height, touch = false) {
  const listeners = {};
  const root = {
    classList: {
      _c: new Set(),
      toggle(name, on) {
        if (on) this._c.add(name);
        else this._c.delete(name);
      },
      contains(name) { return this._c.has(name); },
    },
    dataset: {},
    style: { setProperty() {} },
  };
  const window = {
    innerWidth: width,
    innerHeight: height,
    addEventListener(name, fn) { listeners[name] = fn; },
    setTimeout(fn) { fn(); },
    dispatchEvent() {},
    matchMedia(q) {
      return { matches: touch && q.includes('coarse') };
    },
    DenizenDeviceProfile: null,
    __DenizenDeviceProfile: null,
  };
  window.document = { documentElement: root };
  if (touch) {
    window.navigator = { maxTouchPoints: 1 };
    window.ontouchstart = true;
  } else {
    window.navigator = { maxTouchPoints: 0 };
  }
  vm.runInNewContext(SOURCE, { window, document: window.document });
  return { profile: window.DenizenDeviceProfile.get(), root };
}

describe('device-profile', () => {
  it('detects desktop', () => {
    const { profile, root } = runProfile(1440, 900, false);
    assert.equal(profile.tier, 'desktop');
    assert.equal(profile.isDesktop, true);
    assert.equal(root.classList.contains('denizen-desktop'), true);
    assert.equal(root.classList.contains('denizen-phone'), false);
  });

  it('sizes iPhone 14 landscape for readable panels', () => {
    const { profile, root } = runProfile(844, 390, true);
    assert.equal(profile.tier, 'phone');
    assert.equal(profile.isCompactPhone, false);
    assert.equal(root.classList.contains('denizen-phone'), true);
    assert.ok(profile.panelMaxWidth >= 540, `expected readable width, got ${profile.panelMaxWidth}`);
    assert.ok(profile.panelMaxWidth <= 660, `expected capped width, got ${profile.panelMaxWidth}`);
    assert.ok(profile.panelMaxWidth / profile.width >= 0.62);
    assert.ok(profile.panelMaxWidth / profile.width <= 0.82);
  });

  it('detects compact phone (iPhone SE)', () => {
    const { profile } = runProfile(667, 375, true);
    assert.equal(profile.tier, 'phone-compact');
    assert.ok(profile.panelMaxWidth >= 500);
    assert.ok(profile.panelMaxWidth <= 580);
  });

  it('detects tablet', () => {
    const { profile, root } = runProfile(1024, 768, true);
    assert.equal(profile.tier, 'tablet');
    assert.equal(profile.isTablet, true);
    assert.equal(root.classList.contains('denizen-tablet'), true);
  });

  it('treats touch laptop with fine pointer as desktop', () => {
    const listeners = {};
    const root = {
      classList: {
        _c: new Set(),
        toggle(name, on) { if (on) this._c.add(name); else this._c.delete(name); },
        contains(name) { return this._c.has(name); },
      },
      dataset: {},
      style: { setProperty() {} },
    };
    const window = {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener(name, fn) { listeners[name] = fn; },
      setTimeout(fn) { fn(); },
      dispatchEvent() {},
      matchMedia() { return { matches: false }; },
      DenizenDeviceProfile: null,
      __DenizenDeviceProfile: null,
      navigator: { maxTouchPoints: 10 },
      ontouchstart: true,
    };
    window.document = { documentElement: root };
    vm.runInNewContext(SOURCE, { window, document: window.document });
    const profile = window.DenizenDeviceProfile.get();
    assert.equal(profile.tier, 'desktop');
    assert.equal(profile.isDesktop, true);
    assert.equal(root.classList.contains('denizen-desktop'), true);
  });
});
