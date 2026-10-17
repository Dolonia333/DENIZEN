'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function loadRuntime() {
  delete require.cache[require.resolve('../src/scene-runtime.js')];
  global.window = global.window || {};
  delete global.window.DenizenSceneRuntime;
  // Minimal DOM stubs used by boot error paths / preferCanvas.
  global.document = global.document || {
    getElementById: () => null,
  };
  require('../src/scene-runtime.js');
  return global.window.DenizenSceneRuntime;
}

describe('DenizenSceneRuntime', () => {
  let rt;

  beforeEach(() => {
    rt = loadRuntime();
  });

  it('exports the frozen public surface', () => {
    assert.ok(rt);
    assert.equal(rt.version, 1);
    assert.equal(rt.LAYERS.GROUND, 0);
    assert.equal(rt.LAYERS.ACTORS, 30);
    assert.equal(rt.LAYERS.HUD, 1000);
    assert.equal(rt.CULL_CHUNK, 512);
    assert.deepEqual(rt.FROZEN_COMMANDS, [
      'spawn', 'navigate', 'walkTo', 'use', 'interact', 'speak', 'broadcast', 'setBlockers',
    ]);
    assert.equal(typeof rt.boot, 'function');
    assert.equal(typeof rt.installChunkCulling, 'function');
    assert.equal(typeof rt.setupAtlas, 'function');
    assert.ok(rt.discordAdapter);
  });

  it('preferCanvasRenderer defaults to Canvas unless ?webgl=1', () => {
    const prev = global.window.location;
    global.window.location = { search: '' };
    assert.equal(rt.preferCanvasRenderer(), true);
    global.window.location = { search: '?webgl=1' };
    assert.equal(rt.preferCanvasRenderer(), false);
    global.window.location = prev;
  });

  it('buildGameConfig applies light-perf FPS and loader caps', () => {
    global.Phaser = { CANVAS: 0, AUTO: 1 };
    const { config, useCanvas } = rt.buildGameConfig({
      scene: [],
      forceCanvas: true,
      perf: { light: true, targetFps: 30 },
      allowMissingParent: true,
      parent: 'game-container',
    });
    assert.equal(useCanvas, true);
    assert.equal(config.type, 0);
    assert.equal(config.width, 1280);
    assert.equal(config.height, 720);
    assert.equal(config.roundPixels, true);
    assert.equal(config.loader.maxParallelDownloads, 4);
    assert.equal(config.fps.target, 30);
    assert.equal(config.physics.default, 'arcade');
    delete global.Phaser;
  });

  it('depthFor / applyLayer map layer names', () => {
    assert.equal(rt.depthFor('actors'), 30);
    assert.equal(rt.depthFor('HUD'), 1000);
    const obj = { depth: null, setDepth(d) { this.depth = d; } };
    rt.applyLayer(obj, 'furniture');
    assert.equal(obj.depth, 20);
  });

  it('command bus registers aliases navigate↔walkTo and use↔interact', () => {
    let seen = null;
    rt.registerCommand('navigate', (p) => { seen = p; return { ok: true, via: 'nav' }; });
    const walk = rt.commands.walkTo({ x: 10, y: 20 });
    assert.equal(walk.ok, true);
    assert.deepEqual(seen, { x: 10, y: 20 });

    let used = null;
    rt.registerCommand('use', (p) => { used = p; return { ok: true }; });
    const interact = rt.dispatch('interact', { id: 'desk' });
    assert.equal(interact.ok, true);
    assert.deepEqual(used, { id: 'desk' });
  });

  it('dispatch returns unknown for unwired commands', () => {
    const res = rt.dispatch('broadcast', { hello: 1 });
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown command/);
  });

  it('atlasPlanKey matches full-world planKey shape', () => {
    assert.equal(rt.atlasPlanKey('limezu/ext/foo-bar.png'), 'cp_limezu_ext_foo_bar_png');
  });

  it('installChunkCulling buckets static objects and hides distant ones', () => {
    const mk = (x, y, opts = {}) => ({
      x, y,
      width: opts.width || 16,
      height: opts.height || 16,
      visible: true,
      type: opts.type || 'Image',
    });
    const player = mk(100, 100, { type: 'Sprite' });
    const near = mk(50, 50);
    const far = mk(5000, 5000);
    const wide = mk(200, 200, { width: 600 });

    const scene = {
      children: { list: [player, near, far, wide] },
      cameras: {
        main: {
          worldView: { x: 0, y: 0, right: 400, bottom: 300 },
        },
      },
    };

    const meta = rt.installChunkCulling(scene, { movers: [player] });
    assert.ok(meta.buckets >= 1);
    assert.equal(near.visible, true, 'near chunk should be visible after first update');
    assert.equal(far.visible, false, 'far chunk stays hidden');
    assert.equal(wide.visible, true, 'oversize objects opt out and stay visible');
    assert.equal(player.visible, true);

    // Move camera to far chunk
    scene.cameras.main.worldView = { x: 4800, y: 4800, right: 5200, bottom: 5200 };
    rt.updateChunkCulling(scene, true);
    assert.equal(far.visible, true);
    assert.equal(near.visible, false);
  });

  it('discordAdapter defers when map is not booted', () => {
    const res = rt.discordAdapter.dispatch('spawn', { x: 1, y: 2 });
    assert.equal(res.ok, false);
    assert.equal(res.deferred, true);
    assert.equal(rt.discordAdapter.isLive(), false);
  });

  it('discordAdapter.spawn calls scene.spawnChar when live', () => {
    const calls = [];
    global.window.__DenizenMapGame = {
      scene: {
        getScenes: () => [{
          spawnChar(...args) { calls.push(args); return { sp: true }; },
        }],
      },
    };
    const res = rt.discordAdapter.dispatch('spawn', {
      x: 12, y: 34, sheet: 'hero', idle: 'hero_idle', label: 'Ada',
    });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 12);
    assert.equal(calls[0][1], 34);
    assert.equal(calls[0][2], 'hero');
    delete global.window.__DenizenMapGame;
  });
});
