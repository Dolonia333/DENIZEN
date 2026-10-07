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
    assert.match(html, /pourOntoPlant|Pour/);
    assert.match(html, /Coffee_Machine_Front/);
    assert.match(html, /desk_setup_monitors_pc|desk_setup/);
    assert.match(html, /whiteboard_medium|board_blank/);
    assert.match(html, /whiteboard_line_chart|board_drawn/);
    assert.match(html, /mug_cup|coffee_cup_only|holdMugAtMouth/);
    assert.match(html, /sceneDesk|startDeskWork/);
    assert.match(html, /sceneSkill|sceneBoard|sceneShip/);
    // Must not load the misnamed desk-phone asset as the coffee machine
    assert.doesNotMatch(html, /load\.image\([^)]*coffee_machine_desk/);

    const assets = [
      'assets/Abby.png',
      'assets/modern_office/named/plant_floor_leafy.png',
      'assets/limezu/ext/singles/20_subway_and_train_station/ME_Singles_Subway_and_Train_Station_16x16_Coffee_Machine_Front.png',
      'assets/modern_office/named/desk_setup_monitors_pc.png',
      'assets/modern_office/named/whiteboard_medium.png',
      'assets/modern_office/named/whiteboard_line_chart.png',
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
    assert.match(src, /vfx_coffee_cup/);
    assert.match(src, /angle:\s*-28/);
    assert.match(src, /_flashSkillCast/);
    assert.match(src, /_flashBoardReveal/);
    assert.match(src, /_flashShipBeat/);

    const office = fs.readFileSync(path.join(ROOT, 'office-scene.js'), 'utf8');
    assert.match(office, /vfx_watering_can_empty/);
    assert.match(office, /vfx_coffee_mug/);
    assert.match(office, /vfx_coffee_cup/);

    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    assert.match(mgr, /_flashSkillCast/);
    assert.match(mgr, /_flashShipBeat/);
  });
});
