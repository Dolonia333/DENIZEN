/**
 * Tests for RoomGenerator — procedural room generation.
 * Uses Node.js built-in test runner (node:test) with ESM imports.
 * Run: node --experimental-detect-module --test tests/room-generator.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, '..', 'data', 'furniture_catalog_openplan.json');
const catalogData = JSON.parse(readFileSync(catalogPath, 'utf8'));

// Use pathToFileURL so the path-to-URL conversion is correct on Windows
// (backslashes, drive letters). Older code used join('file://', …) which
// breaks on Node 22 because the resolver no longer treats that as a URL.
const { RoomGenerator } = await import(pathToFileURL(join(__dirname, '..', 'src', 'RoomGenerator.js')).href);

// ---------------------------------------------------------------------------
// Construction & Palette
// ---------------------------------------------------------------------------

describe('RoomGenerator construction', () => {
  it('creates from catalog data', () => {
    const gen = new RoomGenerator(catalogData);
    assert.ok(gen);
    assert.ok(gen.palette);
  });

  it('palette has grouped entries', () => {
    const gen = new RoomGenerator(catalogData);
    const p = gen.palette;
    assert.ok(p.desks.length > 0, 'should have desks');
    assert.ok(p.chairs.length > 0, 'should have chairs');
    assert.ok(p.deskSetups.length > 0, 'should have desk setups');
    assert.ok(p.plants.length > 0, 'should have plants');
  });
});

// ---------------------------------------------------------------------------
// Generation — all archetypes produce items
// ---------------------------------------------------------------------------

describe('RoomGenerator archetypes', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  for (const purpose of ['workspace', 'conference', 'breakroom', 'manager_office', 'reception', 'storage']) {
    it(`generates items for "${purpose}"`, () => {
      const tpl = gen.generate({ purpose, occupants: 4 });
      assert.ok(tpl.items.length > 0, `${purpose} should produce items`);
      assert.ok(tpl.description, 'should have a description');
    });
  }

  it('unknown purpose falls back to workspace', () => {
    const tpl = gen.generate({ purpose: 'banana' });
    assert.ok(tpl.items.length > 0, 'fallback should still produce items');
  });
});

// ---------------------------------------------------------------------------
// Workspace scaling
// ---------------------------------------------------------------------------

describe('workspace scaling', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  it('workspace has desks and chairs for each occupant', () => {
    // Count by instanceId, not catalog id — same as "more occupants → more
    // items" below. The generator names what it places (desk_1, chair_2), but
    // the catalog ids behind them are arbitrary (office_prop_g14_38_2x3,
    // box_desk, cubicle_desk), so the old /desk|cubicle/ id regex matched only
    // some of the pool at random. That, not the generator, was the flake: it
    // places all 4 workstations every run.
    const countByPrefix = (tpl, prefix) => tpl.items.filter(
      (i) => new RegExp(`^${prefix}_`).test(i.instanceId || ''),
    ).length;

    // Deterministic now, but keep several runs so a regression in placement
    // shows up as a hard failure rather than an occasional one.
    for (let attempt = 0; attempt < 5; attempt++) {
      const tpl = gen.generate({ purpose: 'workspace', occupants: 4, width: 512, height: 512 });
      assert.equal(countByPrefix(tpl, 'desk'), 4, 'expected one desk per occupant');
      assert.ok(countByPrefix(tpl, 'chair') >= 3, 'expected a chair for nearly every desk');
    }
  });

  it('workstations use official singles and tuck the chair into the desk', () => {
    const tpl = gen.generate({ purpose: 'cubicle_bay', occupants: 4, width: 512, height: 420 });
    const objects = catalogData.objects;
    const desks = tpl.items.filter((i) => /^desk_/.test(i.instanceId || ''));
    const chairs = tpl.items.filter((i) => /^chair_/.test(i.instanceId || ''));
    assert.equal(desks.length, 4);
    assert.equal(chairs.length, 4);
    for (const item of [...desks, ...chairs]) {
      const def = objects[item.id];
      assert.equal(def.source_type, 'single_file');
      assert.match(def.url_path, /\/modern_office\/named\//);
    }
    for (const chair of chairs) {
      const desk = desks
        .filter((d) => Math.abs(d.x - chair.x) < 8 && chair.y > d.y)
        .sort((a, b) => (chair.y - a.y) - (chair.y - b.y))[0];
      assert.ok(desk, 'each chair sits in front of a desk on the same column');
      const gap = chair.y - desk.y;
      assert.ok(gap > 0 && gap <= 28, `chair should tuck into the desk front, gap=${gap}`);
    }
    const monitors = tpl.items.filter((i) => i.id === 'desk_setup_monitors_alt');
    assert.equal(monitors.length, 4);
    for (const monitor of monitors) {
      assert.ok(monitor.parent_offset_y < 0, 'monitor sits on the desktop, above the desk anchor');
    }
  });

  it('cubicle bay fits every occupant and skips the bad trash cut', () => {
    const tpl = gen.generate({ purpose: 'cubicle_bay', occupants: 6 });
    const desks = tpl.items.filter((i) => /^desk_/.test(i.instanceId || ''));
    const chairs = tpl.items.filter((i) => /^chair_/.test(i.instanceId || ''));
    assert.equal(desks.length, 6, 'one desk per occupant');
    assert.equal(chairs.length, 6);
    assert.equal(tpl.items.filter((i) => i.id === 'trash_can').length, 0);
    assert.ok(tpl.items.some((i) => i.id === 'water_cooler'));
    assert.ok(tpl.items.some((i) => i.id === 'wall_ac_white' || /whiteboard/.test(i.id)));
    const dividers = tpl.items.filter((i) => i.id === 'partition_grey_block');
    assert.equal(dividers.length, 6);
    for (const divider of dividers) {
      const desk = desks
        .filter((d) => Math.abs(d.x - divider.x) < 8 && d.y > divider.y)
        .sort((a, b) => (a.y - divider.y) - (b.y - divider.y))[0];
      assert.ok(desk, 'each cubicle screen shares a column with the desk in front of it');
      assert.ok(desk.y - divider.y <= 48, 'cubicle screen stands on the back edge of that desk');
    }
    for (const chair of chairs) {
      const nextScreen = dividers
        .filter((d) => Math.abs(d.x - chair.x) < 8 && d.y > chair.y)
        .sort((a, b) => (a.y - chair.y) - (b.y - chair.y))[0];
      if (!nextScreen) continue;
      const screenTop = nextScreen.y - 42;
      assert.ok(screenTop - chair.y >= 16, `aisle in front of the next cubicle, gap=${screenTop - chair.y}`);
    }
  });

  it('more occupants → more items', () => {
    const small = gen.generate({ purpose: 'workspace', occupants: 2, width: 384, height: 384 });
    const big = gen.generate({ purpose: 'workspace', occupants: 8, width: 768, height: 768 });
    // Decor is intentionally randomized, so total item count can occasionally
    // be equal even though the larger room has more workstations. Assert the
    // invariant the test actually cares about: occupant capacity scales up.
    const workstationCount = (tpl) => tpl.items.filter(
      (item) => /^(desk|chair)_/.test(item.instanceId || ''),
    ).length;
    const smallWorkstations = workstationCount(small);
    const bigWorkstations = workstationCount(big);
    assert.ok(bigWorkstations > smallWorkstations,
      `8 occupants (${bigWorkstations} workstation items) should exceed 2 (${smallWorkstations})`);
  });
});

// ---------------------------------------------------------------------------
// Template integrity
// ---------------------------------------------------------------------------

describe('template integrity', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  it('all item IDs exist in catalog', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 6 });
    const catalogIds = new Set(Object.keys(catalogData.objects));
    for (const item of tpl.items) {
      assert.ok(catalogIds.has(item.id), `"${item.id}" not found in catalog`);
    }
  });

  it('no duplicate instanceIds', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 6 });
    const ids = tpl.items.map(i => i.instanceId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'all instanceIds should be unique');
  });

  it('decor parentInstanceIds reference valid items', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 4 });
    const allIds = new Set(tpl.items.map(i => i.instanceId));
    for (const item of tpl.items) {
      if (item.parentInstanceId) {
        assert.ok(allIds.has(item.parentInstanceId),
          `parentInstanceId "${item.parentInstanceId}" on "${item.id}" not found`);
      }
    }
  });

  it('respects custom dimensions', () => {
    const tpl = gen.generate({ purpose: 'storage', width: 640, height: 480 });
    assert.ok(tpl.description.includes('640x480'), 'description should show custom dimensions');
  });
});

// ---------------------------------------------------------------------------
// Integration — generateAndRegister
// ---------------------------------------------------------------------------

describe('generateAndRegister', () => {
  it('registers template with fake assembly', () => {
    const gen = new RoomGenerator(catalogData);
    const fakeAssembly = { templates: {} };
    const name = gen.generateAndRegister(fakeAssembly, { purpose: 'conference', occupants: 6 }, 'test_room');
    assert.equal(name, 'test_room');
    assert.ok(fakeAssembly.templates['test_room']);
    assert.ok(fakeAssembly.templates['test_room'].items.length > 0);
  });
});
