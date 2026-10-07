'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('NPC map awareness / unstuck', () => {
  it('all NPCs share one OfficePathfinder and get NpcPathFollower', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /new window\.OfficePathfinder/);
    assert.match(scene, /npc\._pathFollower = new window\.NpcPathFollower\(npc, this\._pathfinder\)/);
  });

  it('POI targets snap to walkable tiles instead of raw furniture pixels', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /Never aim at raw furniture pixels/);
    assert.doesNotMatch(
      scene,
      /findWalkableNear\?\.\(spot\.x,\s*spot\.y,\s*40\) \|\| spot/
    );
  });

  it('path give-up does not dwell unless near the destination', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /Path follower returns null on arrival AND on give-up/);
    assert.match(scene, /distLeft <= 28/);
  });

  it('immobile recovery escalates to sampleSafeWalkTarget after repeated strikes', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /strikes >= 2/);
    assert.match(scene, /sampleSafeWalkTarget\(npc\.x,\s*npc\.y,\s*100/);
  });

  it('furniture placement rebuilds _pathfinder (not missing pathfinder hook)', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /scene\._pathfinder\?\.buildFromScene/);
    assert.doesNotMatch(scene, /scene\.pathfinder\?\.rebuildFromScene/);
  });

  it('walkability pad is narrow enough for aisles', () => {
    const pf = read('src/pathfinding.js');
    assert.match(pf, /const pad = 4;/);
    assert.match(pf, /rebuildFromScene\(scene\)/);
  });

  it('cache busters bumped', () => {
    const html = read('index.html');
    assert.match(html, /pathfinding\.js\?v=aislePad1/);
    assert.match(html, /office-scene\.js\?v=mapFill5/);
  });
});
