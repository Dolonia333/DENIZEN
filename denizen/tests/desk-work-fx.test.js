'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('live office desk work FX', () => {
  it('preloads paper stack + coffee mug textures for desk clutter', () => {
    const office = fs.readFileSync(path.join(ROOT, 'office-scene.js'), 'utf8');
    assert.match(office, /vfx_desk_papers/);
    assert.match(office, /papers_stack_small\.png/);
    assert.match(office, /vfx_coffee_mug/);
    assert.ok(
      fs.existsSync(path.join(ROOT, 'assets/modern_office/named/papers_stack_small.png')),
      'papers_stack_small.png missing'
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, 'assets/limezu/animated/coffee.png')),
      'coffee.png missing'
    );
  });

  it('wires sit → typing + desk work loop; stand → stop loop + clear clutter', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/agent-actions.js'), 'utf8');
    assert.match(src, /_sitAtDeskNow[\s\S]*_showTypingIndicator[\s\S]*_startDeskWorkLoop/);
    assert.match(src, /_startDeskWorkLoop\(/);
    assert.match(src, /_stopDeskWorkLoop\(/);
    assert.match(src, /setDeskClutter\(/);
    assert.match(src, /_clearDeskClutter\(/);
    assert.match(src, /_deskClutterKinds\(/);
    assert.match(src, /Hmm\./);
    // Stand-up must tear desk FX down before removing sit state.
    const stand = src.match(/_standUpNpc\([\s\S]*?_sittingNpcs\.delete\(npcKey\)/);
    assert.ok(stand, '_standUpNpc missing');
    assert.match(stand[0], /_stopDeskWorkLoop\(npcKey\)/);
    assert.match(stand[0], /_clearDeskClutter\(npcKey\)/);
    assert.match(stand[0], /_hideTypingIndicator\(npcKey\)/);
  });

  it('status gems use a fixed seven-meaning palette with blocked pulse', () => {
    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    assert.match(mgr, /STATUS_GEM_COLORS\s*=\s*\{/);
    for (const kind of ['working', 'talking', 'break', 'meeting', 'blocked', 'error', 'idle']) {
      assert.match(mgr, new RegExp(`${kind}:\\s*0x[0-9a-fA-F]+`));
    }
    assert.match(mgr, /_statusGemFor\(/);
    assert.match(mgr, /pulse:\s*kind\s*===\s*'blocked'/);
    assert.match(mgr, /_setStatusGemPulse\(/);
    assert.match(mgr, /_deskLoadFor\(/);
    assert.match(mgr, /setDeskClutter\?\.\(npcKey,\s*this\._deskLoadFor/);
    // No noisy task-scrap HUD labels.
    assert.match(mgr, /Task scraps were tiny gray floaters/);
  });

  it('seeds first-paint desk workload showcase for clutter + gem variety', () => {
    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    assert.match(mgr, /_seedDeskWorkloadShowcase\(/);
    assert.match(mgr, /waiting_on_skill/);
    assert.match(mgr, /_lastSkillAt/);
  });

  it('desk load maps idle/break → clear; blocked/error/multi-task → heavy', () => {
    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    const start = mgr.indexOf('_deskLoadFor(agent, npcKey, now = Date.now(), gem = null)');
    assert.ok(start >= 0, '_deskLoadFor missing');
    const fn = mgr.slice(start, start + 900);
    assert.match(fn, /kind === 'idle' \|\| kind === 'break'/);
    assert.match(fn, /return 'clear'/);
    assert.match(fn, /return 'heavy'/);
    assert.match(fn, /return 'medium'/);
    assert.match(fn, /return 'light'/);
  });
});
