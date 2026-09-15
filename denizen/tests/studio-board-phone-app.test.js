'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Studio Board phone app', () => {
  it('ships the agency tracker HTML with storage shim and embed mode', () => {
    const html = read('studio-board.html');
    assert.match(html, /Studio Board/);
    assert.match(html, /dz-sb:/);
    assert.match(html, /window\.storage/);
    assert.match(html, /html\.embed/);
    assert.match(html, /setView|viewtab|Calendar|Board|My Day/i);
  });

  it('registers Studio Board on the Denizen phone home screen', () => {
    const src = read('src/denizen-phone-ui.js');
    assert.match(src, /id: 'studioboard'/);
    assert.match(src, /Studio Board/);
    assert.match(src, /renderStudioBoardApp/);
    assert.match(src, /\/studio-board\.html\?embed=1/);
    assert.match(src, /PRIORITY_GRID_IDS = \[[^\]]*studioboard/);
    assert.match(src, /dzp-studioboard-frame/);
  });

  it('bumps the phone UI cache buster for Studio Board', () => {
    const idx = read('index.html');
    assert.match(idx, /denizen-phone-ui\.js\?v=phone34studioboard/);
  });
});
