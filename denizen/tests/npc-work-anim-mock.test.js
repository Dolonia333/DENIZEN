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
    assert.match(html, /pourOntoPlant|tip \+ pour|Pour plant/i);
    assert.match(html, /Writing code/);
    assert.match(html, /mug_cup|coffee_cup_only|holdMugAtMouth/);

    const assets = [
      'assets/Abby.png',
      'assets/modern_office/named/plant_floor_leafy.png',
      'assets/modern_office/named/coffee_machine_desk.png',
      'assets/limezu/animated/coffee.png',
      'assets/limezu/animated/coffee_cup_only.png',
      'assets/limezu/ext/singles/17_garden/ME_Singles_Garden_16x16_Green_Watering_Can_Left_Full.png',
      'assets/limezu/ext/singles/17_garden/ME_Singles_Garden_16x16_Green_Watering_Can_Left_Empty.png',
      'vendor/phaser/phaser.min.js',
    ];
    for (const rel of assets) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    }
  });

  it('waterPlant pours with tipped can and goToCoffee picks up mug', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/agent-actions.js'), 'utf8');
    assert.match(src, /_flashWateringCan/);
    assert.match(src, /💦/);
    assert.match(src, /vfx_watering_can/);
    assert.match(src, /vfx_watering_can_empty/);
    assert.match(src, /_flashCoffeeMug/);
    assert.match(src, /vfx_coffee_mug/);
    assert.match(src, /vfx_mug_steam/);
    assert.match(src, /angle:\s*-28/);

    const office = fs.readFileSync(path.join(ROOT, 'office-scene.js'), 'utf8');
    assert.match(office, /vfx_watering_can_empty/);
    assert.match(office, /vfx_coffee_mug/);
  });
});
