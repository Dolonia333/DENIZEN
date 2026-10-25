'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const sheets = require('../src/denizen-sprite-sheet');
const engine = require('../src/denizen-mcp-engine-tools');
const officeAct = require('../src/denizen-mcp-office-act');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'data', '_sprite_cut_test');

function writePng(name, width, height, paint) {
  fs.mkdirSync(dir, { recursive: true });
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const px = paint(x, y);
      png.data[i] = px[0];
      png.data[i + 1] = px[1];
      png.data[i + 2] = px[2];
      png.data[i + 3] = px[3];
    }
  }
  fs.writeFileSync(path.join(dir, name), PNG.sync.write(png));
  return `data/_sprite_cut_test/${name}`;
}

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(root, 'data', 'sprite-cuts', 'bleed'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'data', 'sprite-cuts', 'clean'), { recursive: true, force: true });
});

describe('denizen-sprite-sheet', () => {
  it('names XP direction rows without guessing a partial cell', () => {
    const cut = sheets.cutDimensions({ width: 128, height: 192 });
    assert.equal(cut.ok, true);
    assert.equal(cut.kind, 'xp_character');
    assert.equal(cut.frameWidth, 32);
    assert.equal(cut.frameHeight, 48);
    assert.deepEqual(cut.directionRows, ['down', 'left', 'right', 'up']);
    assert.equal(cut.frames[0].direction, 'down');
    assert.equal(cut.frames[4].direction, 'left');
    assert.equal(cut.frames[8].direction, 'right');
    assert.equal(cut.frames[12].direction, 'up');
    assert.equal(cut.frames.length, 16);

    const partial = sheets.cutDimensions({
      width: 30, height: 16, frameWidth: 16, frameHeight: 16,
    });
    assert.equal(partial.ok, false);
    assert.equal(partial.remainderX, 14);
    assert.equal(partial.frames, undefined);
  });

  it('names LimeZu rows right, up, left, down', () => {
    const cut = sheets.cutDimensions({ width: 896, height: 64 });
    assert.equal(cut.kind, 'limezu_character');
    assert.deepEqual(cut.directionRows, ['right', 'up', 'left', 'down']);
    assert.equal(cut.frames[0].anim, 'static');
    assert.equal(cut.frames[0].direction, 'right');
    assert.equal(cut.frames[1].direction, 'up');
    assert.equal(cut.frames[2].direction, 'left');
    assert.equal(cut.frames[3].direction, 'down');
    assert.equal(cut.frames[4].anim, 'static_extra');
    const idle = cut.frames.filter((frame) => frame.row === 1);
    assert.equal(idle[0].anim, 'idle');
    assert.equal(idle[0].direction, 'right');
    assert.equal(idle[6].direction, 'up');
    assert.equal(idle[12].direction, 'left');
    assert.equal(idle[18].direction, 'down');
    assert.equal(idle[24].anim, 'idle_prop');
    assert.match(cut.directionNote, /no separate walk/i);
  });

  it('refuses a seam that splits opaque pixels and keeps the grid on a clean cut', () => {
    const rel = writePng('bleed.png', 32, 16, (x) => (
      x < 24 ? [255, 0, 0, 255] : [0, 0, 0, 0]
    ));
    const split = sheets.cutFile({
      root, relPath: rel, frameWidth: 16, frameHeight: 16,
    });
    assert.equal(split.ok, false);
    assert.equal(split.error, 'frame size cuts through opaque pixels');
    assert.equal(split.bleed[0].axis, 'x');
    assert.equal(split.bleed[0].at, 16);
    assert.equal(split.frames, undefined);

    const cleanRel = writePng('clean.png', 32, 16, (x) => (
      x < 24 ? [0, 200, 0, 255] : [0, 0, 0, 0]
    ));
    const clean = sheets.cutFile({
      root, relPath: cleanRel, frameWidth: 32, frameHeight: 16, saveFrames: true,
    });
    assert.equal(clean.ok, true);
    assert.equal(clean.frameCount, 1);
    assert.equal(clean.frames[0].w, 32);
    assert.equal(clean.frames[0].content.w, 24);
    assert.equal(clean.frames[0].empty, false);
    assert.equal(clean.saved, true);
    const frameFile = fs.readdirSync(path.join(root, clean.outDir)).find((name) => name.endsWith('.png'));
    const framePng = PNG.sync.read(fs.readFileSync(path.join(root, clean.outDir, frameFile)));
    assert.equal(framePng.width, 32);
    assert.equal(framePng.height, 16);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, clean.outDir, 'frames.json'), 'utf8'));
    assert.equal(manifest.frames[0].w, 32);
    assert.equal(manifest.contentIsPaddingOnly, true);
  });

  it('stays inside assets and data', () => {
    const escaped = sheets.cutFile({ root, relPath: 'assets/../../package.json' });
    assert.equal(escaped.ok, false);
    assert.match(escaped.error, /assets\/ or data\//);
    const outside = sheets.cutFile({ root, relPath: '/etc/passwd' });
    assert.equal(outside.ok, false);
  });

  it('the office tool returns the same refusal and does not walk the NPC', () => {
    engine.resetForTests();
    const rel = writePng('tool.png', 32, 16, (x) => (
      x < 24 ? [10, 10, 10, 255] : [0, 0, 0, 0]
    ));
    const cut = engine.callTool({ npc_key: 'lucy' }, 'sprite_sheet_cut', {
      path: rel, frameWidth: 16, frameHeight: 16,
    });
    assert.equal(cut.ok, false);
    assert.equal(officeAct.buildBeat({ npc_key: 'lucy' }, 'sprite_sheet_cut'), null);
    assert.equal(officeAct.buildBeat({ npc_key: 'lucy' }, 'office_place_catalog'), null);
  });
});
