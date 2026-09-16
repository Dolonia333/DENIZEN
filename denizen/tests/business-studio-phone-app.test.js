'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Business Studio phone app', () => {
  it('ships as its own full-page app at /business-studio/', () => {
    const html = read('business-studio/index.html');
    assert.match(html, /Business Studio/);
    assert.match(html, /dz-bs:/);
    assert.match(html, /window\.storage/);
    assert.match(html, /Back to office/);
    assert.match(html, /dz-app-chrome/);
    assert.match(html, /dz_sid/);
    assert.match(html, /body\.classList\.add\('standalone'\)/);
  });

  it('registers Business Studio as a navigate app like CRM + Studio Board', () => {
    const src = read('src/denizen-phone-ui.js');
    assert.match(src, /id: 'businessstudio'/);
    assert.match(src, /type: 'navigate'/);
    assert.match(src, /url: '\/business-studio\/'/);
    assert.match(src, /PRIORITY_GRID_IDS = \[[^\]]*businessstudio/);
    assert.match(src, /SESSION_HANDOFF_NAV_IDS = new Set\(\[[^\]]*businessstudio/);
    assert.match(src, /LAYOUT_VERSION = 8/);
    assert.doesNotMatch(src, /renderBusinessStudioApp/);
    assert.doesNotMatch(src, /dzp-businessstudio-frame/);
  });

  it('serves /business-studio/ from the Denizen server', () => {
    const srv = read('server.js');
    assert.match(srv, /urlPath === '\/business-studio'/);
    assert.match(srv, /business-studio/);
    assert.match(srv, /Location: '\/business-studio\/'/);
    assert.match(srv, /Phone app navigates here like CRM \+ Studio Board/);
  });

  it('bumps the phone UI cache buster for Business Studio', () => {
    const idx = read('index.html');
    assert.match(idx, /denizen-phone-ui\.js\?v=phone\d+\w*/);
  });

  it('keeps classic Lean Canvas grid on mobile (no card stack)', () => {
    const html = read('business-studio/index.html');
    assert.match(html, /lean-stage/);
    assert.match(html, /data-fit-design-width="860"/);
    assert.match(html, /fitBoardToStage/);
    // Must not collapse the tablet into a column of cards on phone
    assert.doesNotMatch(
      html,
      /@media \(max-width:900px\)\{\s*\.lean-canvas\{\s*display:flex;flex-direction:column/,
    );
    assert.match(html, /Full 9-box canvas/);
  });

  it('keeps sales-cycle hub-and-spoke on mobile (scaled, not stacked)', () => {
    const html = read('business-studio/index.html');
    assert.match(html, /sc-map-stage/);
    assert.match(html, /data-fit-design-width="640"/);
    assert.doesNotMatch(html, /\.sc-spokes\{display:none\}/);
    assert.doesNotMatch(
      html,
      /\.sc-hub,\.sc-role\{position:relative;left:auto!important/,
    );
  });
});
