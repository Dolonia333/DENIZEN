'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('npc-work-anim-mock', () => {
  it('ships the demo page and required assets', () => {
    const page = path.join(ROOT, 'tools/npc-work-anim-mock.html');
    assert.ok(fs.existsSync(page), 'demo html missing');
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /NPC work anim mock/i);
    assert.match(html, /watering can/i);
    assert.match(html, /Writing code/);
    assert.match(html, /coffee_steam/);

    const assets = [
      'assets/Abby.png',
      'assets/modern_office/named/plant_floor_leafy.png',
      'assets/limezu/animated/coffee.png',
      'assets/limezu/ext/singles/17_garden/ME_Singles_Garden_16x16_Green_Watering_Can_Left_Full.png',
      'vendor/phaser/phaser.min.js',
    ];
    for (const rel of assets) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    }
  });

  it('waterPlant uses splash emoji and can helper', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/agent-actions.js'), 'utf8');
    assert.match(src, /_flashWateringCan/);
    assert.match(src, /💦/);
    assert.match(src, /vfx_watering_can/);
  });
});
