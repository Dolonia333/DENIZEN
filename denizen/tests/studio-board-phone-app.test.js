'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Studio Board phone app', () => {
  it('ships as its own full-page app at /studio-board/', () => {
    const html = read('studio-board/index.html');
    assert.match(html, /Studio Board/);
    assert.match(html, /dz-sb:/);
    assert.match(html, /window\.storage/);
    assert.match(html, /Back to office/);
    assert.match(html, /dz-app-chrome/);
  });

  it('registers Studio Board as a navigate app like CRM', () => {
    const src = read('src/denizen-phone-ui.js');
    assert.match(src, /id: 'studioboard'/);
    assert.match(src, /type: 'navigate'/);
    assert.match(src, /url: '\/studio-board\/'/);
    assert.match(src, /PRIORITY_GRID_IDS = \[[^\]]*studioboard/);
    assert.doesNotMatch(src, /renderStudioBoardApp/);
    assert.doesNotMatch(src, /dzp-studioboard-frame/);
  });

  it('serves /studio-board/ from the Denizen server', () => {
    const srv = read('server.js');
    assert.match(srv, /urlPath === '\/studio-board'/);
    assert.match(srv, /studio-board/);
    assert.match(srv, /Location: '\/studio-board\/'/);
  });

  it('bumps the phone UI cache buster for Studio Board', () => {
    const idx = read('index.html');
    assert.match(idx, /denizen-phone-ui\.js\?v=phone\d+\w*/);
  });

  it('keeps the calendar in frame on phone with a compact shell', () => {
    const html = read('studio-board/index.html');
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /@media \(max-width:720px\)/);
    assert.match(html, /\.view\{[\s\S]*?min-height:0[\s\S]*?overflow:auto/);
    assert.match(html, /board-overview/);
    assert.match(html, /phone-pulse/);
    assert.match(html, /syncPhoneChrome/);
    assert.match(html, /env\(safe-area-inset-bottom/);
    assert.match(html, /\.sharedbadge,\.presence-strip,\.people-strip\{display:none/);
  });
});
