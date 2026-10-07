'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('NPC wander must not teleport', () => {
  it('think "work" walks home instead of instant seating', () => {
    const src = read('src/agent-office-manager.js');
    const workCase = src.match(/case 'work':[\s\S]*?break;/);
    assert.ok(workCase, 'expected work decision case');
    assert.match(workCase[0], /useComputer\([^)]*assignedDesk/);
    assert.doesNotMatch(workCase[0], /useComputer\([^;]*instant:\s*true/);
  });

  it('_trySeatAtDesk does not force instant seating', () => {
    const scene = read('office-scene.js');
    const fn = scene.match(/_trySeatAtDesk\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fn, 'expected _trySeatAtDesk');
    assert.match(fn[0], /useComputer\([^)]*assignedDesk/);
    assert.doesNotMatch(fn[0], /useComputer\([^;]*instant:\s*true/);
  });

  it('immobile watchdog prefers nearby findWalkableNear over office-wide sample', () => {
    const scene = read('office-scene.js');
    assert.match(scene, /_immobileStrikes/);
    assert.match(scene, /findWalkableNear\(npc\.x,\s*npc\.y,\s*48\)/);
    assert.doesNotMatch(
      scene,
      /_immobileStrikes[\s\S]{0,800}sampleSafeWalkTarget\(npc\.x,\s*npc\.y,\s*200/
    );
  });

  it('boot seating and teleportToDesk may still use instant', () => {
    const manager = read('src/agent-office-manager.js');
    const actions = read('src/agent-actions.js');
    assert.match(manager, /useComputer\(npcKey,\s*agent\.assignedDesk,\s*\{\s*instant:\s*true\s*\}\)/);
    assert.match(actions, /teleportToDesk[\s\S]*instant:\s*true/);
  });

  it('cache busters bumped for the walk-home / map-awareness fixes', () => {
    const html = read('index.html');
    assert.match(html, /agent-office-manager\.js\?v=headTrack1/);
    assert.match(html, /office-scene\.js\?v=deskLife1/);
    assert.match(html, /pathfinding\.js\?v=aislePad1/);
  });
});
