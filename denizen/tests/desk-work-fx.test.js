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
    // Already seated must still bring the loop back if it stopped.
    assert.match(src, /isSeatedAtDesk\(npcKey, deskId\)[\s\S]{0,400}!this\._deskWork\.has\(npcKey\)[\s\S]{0,200}_startDeskWorkLoop/);
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

  it('maps agent status onto the seven gem kinds, pulse only when blocked', () => {
    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    const start = mgr.indexOf('const STATUS_GEM_KIND = {');
    const end = mgr.indexOf('const SKILL_PENDING_STALE_MS');
    assert.ok(start >= 0 && end > start, 'STATUS_GEM_KIND missing');
    const kind = mgr.slice(start, end);
    const expectKind = {
      working: ['working', 'task_override', 'reading'],
      talking: ['talking', 'collaborating', 'ceo_conversation'],
      break: ['break', 'coffee_run', 'tending'],
      meeting: ['meeting'],
      blocked: ['blocked', 'waiting', 'waiting_on_skill'],
      error: ['error'],
      idle: ['idle', 'wandering'],
    };
    for (const [gem, statuses] of Object.entries(expectKind)) {
      for (const status of statuses) {
        assert.match(kind, new RegExp(`${status}:\\s*'${gem}'`), `${status} → ${gem}`);
      }
    }
    const gemFor = mgr.slice(
      mgr.indexOf('_statusGemFor(agent, now = Date.now())'),
      mgr.indexOf('_setStatusGemPulse(dot, on)')
    );
    assert.match(gemFor, /status === 'error'/);
    assert.match(gemFor, /_isAgentBlocked\(agent, now\)/);
    assert.match(gemFor, /_skillCastUntil/);
    assert.match(gemFor, /pulse:\s*kind\s*===\s*'blocked'/);
    assert.doesNotMatch(gemFor, /pulse:\s*kind\s*!==\s*'blocked'/);
  });

  it('clutter kinds are light/clear none, medium one prop, heavy both', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/agent-actions.js'), 'utf8');
    const start = src.indexOf('_deskClutterKinds(npcKey, load) {');
    assert.ok(start >= 0, '_deskClutterKinds missing');
    const fn = src.slice(start, start + 700);
    assert.match(fn, /load !== 'medium' && load !== 'heavy'/);
    assert.match(fn, /return \[\]/);
    assert.match(fn, /vfx_desk_papers/);
    assert.match(fn, /vfx_coffee_mug/);
    assert.match(fn, /slice\(0,\s*load === 'heavy' \? 2 : 1\)/);
    // Only a seated desk gets props; stand-up and a missing desk clear them.
    assert.match(src, /const kinds = deskSprite \? this\._deskClutterKinds/);
    assert.match(src, /if \(!kinds\.length\) \{\s*this\._clearDeskClutter/);
  });

  it('desk clutter skips cubicle walls and the desk’s own setup, retries a missed prop', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/agent-actions.js'), 'utf8');
    const occStart = src.indexOf('\n  _deskOccluders(desk, sit, npc)');
    const occEnd = src.indexOf('\n  _deskSurfaceUnder(desk, x, y)');
    assert.ok(occStart >= 0 && occEnd > occStart, 'occluder method missing');
    const occ = src.slice(occStart, occEnd);
    assert.match(occ, /type === 'partition'/);
    assert.match(occ, /divider\|partition/);
    assert.match(occ, /_isOwnDeskSetup/);
    const ownStart = src.indexOf('\n  _isOwnDeskSetup(it, deskSprite, deskInstanceId)');
    const ownEnd = src.indexOf('\n  _spriteAlphaAt(sprite, wx, wy)');
    assert.ok(ownStart >= 0 && ownEnd > ownStart, 'own-setup helper missing');
    const own = src.slice(ownStart, ownEnd);
    assert.match(own, /desk_setup\|monitor\|laptop\|keyboard/);
    assert.match(own, /parentInstanceId === deskInstanceId/);
    // A null/destroyed prop must not stick in the kept prefix.
    assert.match(src, /if \(!kept \|\| kept\.active === false\) break/);
  });

  it('seeds first-paint desk workload showcase for clutter + gem variety', () => {
    const mgr = fs.readFileSync(path.join(ROOT, 'src/agent-office-manager.js'), 'utf8');
    const start = mgr.indexOf('_seedDeskWorkloadShowcase(seatedKeys = [])');
    assert.ok(start >= 0, 'showcase seed missing');
    const fn = mgr.slice(start, start + 1600);
    assert.match(fn, /_lastSkillAt/);
    assert.match(fn, /_taskLabel = 'queue'/);
    assert.match(fn, /_skillPendingSince = now/);
    assert.match(fn, /status = 'talking'/);
    assert.match(fn, /status = 'working'/);
    // A sticky waiting_on_skill status would pulse amber for the whole session.
    assert.doesNotMatch(fn, /status = 'waiting_on_skill'/);
    assert.match(mgr, /this\._seedDeskWorkloadShowcase\(seatedKeys\)/);
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
