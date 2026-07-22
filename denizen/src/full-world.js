/**
 * full-world.js — the ?world=full multi-zone LimeZu city.
 *
 * Renders data/full-world-blueprint.json: six zones on a 4096×3072 canvas —
 * Dolonia HQ (open office), Japanese retreat, security complex (jail +
 * control room + infirmary), news studio, city plaza, helipad — connected by
 * streets and sidewalks, with a walkable player and ambient NPCs.
 *
 * Sources (all LimeZu, 16px art, rendered 1:1 with camera zoom 2):
 *   room shells   assets/limezu/room-builder/* via src/room-tile-renderer.js
 *   furniture     assets/limezu/singles/<theme>/<Theme>_Singles_<n>.png
 *   home designs  assets/limezu/examples/{japanese,studio}_layer*.png (stamped)
 *   exteriors     city_terrain.png (roads), city_props.png (lamps/trees/grass),
 *                 vehicles.png (cars, helicopter, helipad platform),
 *                 generic_buildings.png (street facades)
 *   characters    assets/limezu/characters/char_NN.png (16×32, 56 frames/row;
 *                 row 1 = idle, row 2 = run, 6 frames per direction R,U,L,D)
 *
 * The character row map is confirmed by the pack's bundled
 * Spritesheet_animations_GUIDE.png (Modern Interiors → 2_Characters/
 * Character_Generator/): rows are static-dirs, idle, run, sleep, sit, sit2,
 * phone (frames 4-9 loop), book (1-6 loop), push-cart, pick-up, gift, lift,
 * throw, hit, punch, stab, grab-gun, gun-idle, shoot, hurt. Only idle + run
 * are wired here so far. Exterior/furniture rects were decoded from labeled
 * contact sheets — see docs/LIMEZU_SETUP.md for the full official reference.
 */

import { RoomTileRenderer } from './room-tile-renderer.js';

const T = 16;
const WORLD_W = 4096;
const WORLD_H = 3072;

// ── Asset tables ────────────────────────────────────────────────────────────

const SINGLE_PREFIX = {
  jail: 'Jail_Singles_',
  medical: 'Hospital_Singles_',
  library: 'Classroom_and_Library_Singles_',
  kitchen: 'Kitchen_Singles_',
  conference: 'Conference_Hall_Singles_',
  japanese: 'Japanese_Interiors_Singles_',
  studio: 'Television_and_FIlm_Studio_Singles_',
};

// Rects inside the big exterior sheets (px). Decoded via contact sheets.
const EXT_RECTS = {
  grass_tile: { sheet: 'fw_props', x: 384, y: 96, w: 16, h: 16 },
  asphalt_tile: { sheet: 'fw_terrain', x: 240, y: 16, w: 16, h: 16 },
  sidewalk_tile: { sheet: 'fw_terrain', x: 704, y: 144, w: 16, h: 16 },
  crosswalk_a: { sheet: 'fw_terrain', x: 112, y: 96, w: 16, h: 16 },
  crosswalk_b: { sheet: 'fw_terrain', x: 112, y: 112, w: 16, h: 16 },
  lamp_double: { sheet: 'fw_props', x: 16, y: 448, w: 48, h: 68 },
  tree_round: { sheet: 'fw_props', x: 384, y: 400, w: 48, h: 66 },
  tree_cypress: { sheet: 'fw_props', x: 480, y: 366, w: 32, h: 50 },
  planter_box: { sheet: 'fw_props', x: 384, y: 176, w: 48, h: 48 },
  flowers_strip: { sheet: 'fw_props', x: 432, y: 176, w: 16, h: 48 },
  phone_booth: { sheet: 'fw_props', x: 448, y: 176, w: 40, h: 48 },
  car_blue: { sheet: 'fw_vehicles', x: 0, y: 32, w: 64, h: 48 },
  car_red: { sheet: 'fw_vehicles', x: 192, y: 32, w: 64, h: 48 },
  car_teal: { sheet: 'fw_vehicles', x: 0, y: 96, w: 64, h: 48 },
  helipad_platform: { sheet: 'fw_vehicles', x: 260, y: 1490, w: 252, h: 220 },
  helicopter: { sheet: 'fw_vehicles', x: 332, y: 1378, w: 180, h: 100 },
  bld_yellow: { sheet: 'fw_buildings', x: 0, y: 16, w: 96, h: 196 },
  bld_grey: { sheet: 'fw_buildings', x: 208, y: 16, w: 96, h: 196 },
  bld_blue: { sheet: 'fw_buildings', x: 416, y: 16, w: 96, h: 196 },
  bld_tan: { sheet: 'fw_buildings', x: 368, y: 424, w: 124, h: 140 },
};

// Interior furniture recipes. tx/ty are 16px-tile coords relative to the zone
// origin; items anchor bottom-center at (tx*16, ty*16) and y-sort with the
// player. solid:true adds a blocking rect at the item's base.
const HQ_FURNITURE = [
  // North wall: bookshelf row + whiteboard
  { s: ['library', 69], tx: 3, ty: 6, solid: true },
  { s: ['library', 70], tx: 5.5, ty: 6, solid: true },
  { s: ['library', 71], tx: 8, ty: 6, solid: true },
  { s: ['library', 44], tx: 10.5, ty: 6, solid: true },
  { s: ['library', 39], tx: 14, ty: 5.6 },
  // Workstation grid — desk + chair pairs
  ...[10, 14, 18].flatMap((row, ri) => [5, 10, 15, 20].map((col) => (
    { s: ['library', (ri + col) % 2 ? 14 : 16], tx: col, ty: row, solid: true }
  ))),
  ...[10, 14, 18].flatMap((row) => [5, 10, 15, 20].map((col) => (
    { s: ['jail', 158], tx: col - 0.2, ty: row + 1.6 }
  ))),
  // East meeting corner
  { s: ['conference', 66], tx: 31, ty: 6 },
  { s: ['conference', 25], tx: 30, ty: 11, solid: true },
  { s: ['conference', 27], tx: 32, ty: 11, solid: true },
  { s: ['jail', 263], tx: 29, ty: 12.6 },
  { s: ['jail', 265], tx: 33, ty: 12.6 },
  { s: ['jail', 263], tx: 30.5, ty: 13.4 },
  { s: ['jail', 265], tx: 32, ty: 13.4 },
  // West break corner
  { s: ['kitchen', 159], tx: 2, ty: 21.4, solid: true },
  { s: ['kitchen', 121], tx: 4.2, ty: 21.4, solid: true },
  { s: ['kitchen', 122], tx: 6.2, ty: 21.4, solid: true },
  { s: ['kitchen', 179], tx: 4.6, ty: 20.8 },
  { s: ['kitchen', 193], tx: 8.6, ty: 21.4, solid: true },
  { s: ['kitchen', 194], tx: 10.6, ty: 21.4, solid: true },
  { s: ['kitchen', 199], tx: 12.4, ty: 21.2 },
  { s: ['kitchen', 226], tx: 6, ty: 17.4, solid: true },
  { s: ['kitchen', 267], tx: 4.6, ty: 17.2 },
  { s: ['kitchen', 268], tx: 7.4, ty: 17.2 },
  // Plants
  { s: ['medical', 71], tx: 37.4, ty: 6 },
  { s: ['medical', 72], tx: 37.4, ty: 21.4 },
  { s: ['medical', 71], tx: 24, ty: 6 },
];

const SECURITY_FURNITURE = [
  // Cell block (3 cells along the north wall) — bunks, toilets, front bars
  { s: ['jail', 227], tx: 2, ty: 7.6, solid: true },
  { s: ['jail', 44], tx: 4.6, ty: 6 },
  { s: ['jail', 227], tx: 8, ty: 7.6, solid: true },
  { s: ['jail', 44], tx: 10.6, ty: 6 },
  { s: ['jail', 227], tx: 14, ty: 7.6, solid: true },
  { s: ['jail', 44], tx: 16.6, ty: 6 },
  // Cell dividers (stacked bars) + front bar wall with a door per cell
  { s: ['jail', 27], tx: 6.5, ty: 6, solid: true },
  { s: ['jail', 27], tx: 12.5, ty: 6, solid: true },
  ...[1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17].map((c) => (
    { s: ['jail', 19], tx: c + 0.5, ty: 8.6, solid: true }
  )),
  { s: ['jail', 26], tx: 3.5, ty: 8.6 },
  { s: ['jail', 26], tx: 9.5, ty: 8.6 },
  { s: ['jail', 26], tx: 15.5, ty: 8.6 },
  // Control room (north-east)
  { s: ['jail', 129], tx: 21, ty: 6, solid: true },
  { s: ['jail', 130], tx: 23, ty: 6, solid: true },
  { s: ['jail', 131], tx: 25, ty: 6, solid: true },
  { s: ['jail', 89], tx: 22.5, ty: 8.6, solid: true },
  { s: ['jail', 158], tx: 22.5, ty: 10 },
  { s: ['jail', 100], tx: 28, ty: 6, solid: true },
  { s: ['jail', 101], tx: 29, ty: 6, solid: true },
  { s: ['jail', 102], tx: 30, ty: 6, solid: true },
  // Common area (south-west)
  { s: ['jail', 235], tx: 4, ty: 14.6, solid: true },
  { s: ['jail', 263], tx: 2.6, ty: 14.4 },
  { s: ['jail', 265], tx: 5.4, ty: 14.4 },
  { s: ['jail', 149], tx: 9, ty: 13.6, solid: true },
  { s: ['jail', 150], tx: 10.2, ty: 13.6, solid: true },
  // Infirmary (south-east, white floor zone) — beds, IV, screens, cabinets
  { s: ['medical', 246], tx: 17, ty: 11.2 },
  { s: ['medical', 246], tx: 19.4, ty: 11.2 },
  { s: ['medical', 179], tx: 19, ty: 16.6, solid: true },
  { s: ['medical', 181], tx: 22, ty: 16.6, solid: true },
  { s: ['medical', 183], tx: 25, ty: 16.6, solid: true },
  { s: ['medical', 210], tx: 20.8, ty: 14.6 },
  { s: ['medical', 231], tx: 23.8, ty: 14.4 },
  { s: ['medical', 192], tx: 29, ty: 13.4, solid: true },
  { s: ['medical', 208], tx: 29, ty: 16.8, solid: true },
  { s: ['medical', 198], tx: 27, ty: 16.4 },
  { s: ['medical', 71], tx: 30.4, ty: 11.4 },
];

// NPC roster: zone-anchored ambient wanderers (per docs/FULL_WORLD.md).
const NPC_SPECS = [
  { char: 2, name: 'Pier', x: 1440, y: 800, r: 120 },
  { char: 3, name: 'Naya', x: 1680, y: 900, r: 140 },
  { char: 4, name: 'Bouncer', x: 520, y: 1380, r: 90 },
  { char: 5, name: 'Sarah', x: 2760, y: 320, r: 50 },
  { char: 6, name: 'Bob', x: 300, y: 300, r: 60 },
  { char: 7, name: 'Lucy', x: 1200, y: 2420, r: 260 },
  { char: 8, name: 'Marisol', x: 950, y: 2620, r: 260 },
  { char: 9, name: 'Oscar', x: 3480, y: 2660, r: 110 },
];

// ── Module state ────────────────────────────────────────────────────────────

const state = {
  solids: [],
  ysort: [],
  player: null,
  npcs: [],
  keys: null,
  built: false,
};

export function buildFullWorld(scene) {
  const bust = 'fw1';
  const lz = (p) => `assets/limezu/${p}?v=${bust}`;

  RoomTileRenderer.preload(scene);
  scene.load.json('fw_blueprint', `data/full-world-blueprint.json?v=${bust}`);
  scene.load.json('fw_rbtiles', `data/room-builder-tiles.json?v=${bust}`);
  scene.load.image('fw_terrain', lz('exteriors/city_terrain.png'));
  scene.load.image('fw_props', lz('exteriors/city_props.png'));
  scene.load.image('fw_vehicles', lz('exteriors/vehicles.png'));
  scene.load.image('fw_buildings', lz('exteriors/generic_buildings.png'));
  scene.load.image('fw_hq_building', lz('examples/office_building_ex2.png'));
  scene.load.image('fw_jp_l1', lz('examples/japanese_layer1.png'));
  scene.load.image('fw_jp_l2', lz('examples/japanese_layer2.png'));
  scene.load.image('fw_st_l1', lz('examples/studio_layer1.png'));
  scene.load.image('fw_st_l2', lz('examples/studio_layer2.png'));
  scene.load.image('fw_st_l3', lz('examples/studio_layer3.png'));
  scene.load.spritesheet('fw_anim_screens', lz('animated/control_screens.png'), { frameWidth: 32, frameHeight: 48 });
  scene.load.spritesheet('fw_anim_server', lz('animated/server_rack.png'), { frameWidth: 16, frameHeight: 48 });
  scene.load.spritesheet('fw_anim_coffee', lz('animated/coffee.png'), { frameWidth: 16, frameHeight: 32 });

  for (let c = 1; c <= 9; c++) {
    const nn = String(c).padStart(2, '0');
    scene.load.spritesheet(`fw_char_${c}`, lz(`characters/char_${nn}.png`), { frameWidth: 16, frameHeight: 32 });
  }

  const wanted = new Set();
  [...HQ_FURNITURE, ...SECURITY_FURNITURE].forEach((f) => wanted.add(f.s.join(':')));
  wanted.forEach((key) => {
    const [theme, n] = key.split(':');
    scene.load.image(`fw_s_${theme}_${n}`, lz(`singles/${theme}/${SINGLE_PREFIX[theme]}${n}.png`));
  });

  scene.load.once('complete', () => {
    try {
      build(scene);
    } catch (err) {
      console.error('[FullWorld] build failed:', err);
      scene.add.text(24, 24, `Full world failed: ${err.message}`, { fontSize: '14px', color: '#fecaca' }).setDepth(9999).setScrollFactor(0);
    }
  });
  scene.load.start();
}

// ── Build ───────────────────────────────────────────────────────────────────

function cropTex(scene, key, rectName) {
  if (scene.textures.exists(key)) return key;
  const r = EXT_RECTS[rectName];
  const src = scene.textures.get(r.sheet)?.getSourceImage();
  const t = scene.textures.createCanvas(key, r.w, r.h);
  t.context.imageSmoothingEnabled = false;
  if (src) t.context.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  t.refresh();
  return key;
}

function build(scene) {
  if (state.built) return;
  state.built = true;
  const bp = scene.cache.json.get('fw_blueprint');
  const rbCat = scene.cache.json.get('fw_rbtiles');
  const zones = {};
  (bp?.zones || []).forEach((z) => { zones[z.id] = z; });

  // Base tile textures
  ['grass_tile', 'asphalt_tile', 'sidewalk_tile', 'crosswalk_a', 'crosswalk_b'].forEach((n) => cropTex(scene, `fwt_${n}`, n));

  // 1 ── Ground: grass everywhere
  scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'fwt_grass_tile').setOrigin(0).setDepth(0);

  // 2 ── Streets
  const roads = [];
  const addRoad = (x, y, w, h) => {
    scene.add.tileSprite(x - T, y - T, w + 2 * T, h + 2 * T, 'fwt_sidewalk_tile').setOrigin(0).setDepth(1);
    scene.add.tileSprite(x, y, w, h, 'fwt_asphalt_tile').setOrigin(0).setDepth(1.1);
    roads.push({ x, y, w, h });
  };
  const addPath = (x, y, w, h) => {
    scene.add.tileSprite(x, y, w, h, 'fwt_sidewalk_tile').setOrigin(0).setDepth(1);
  };
  // Main avenue + verticals
  addRoad(160, 1880, 3780, 64);
  addRoad(960, 400, 64, 1480);
  addRoad(2560, 376, 64, 1504);
  // Zone connector paths (stamp entrances are on their SOUTH side)
  addPath(240, 374, 48, 66); // japanese genkan → down
  addPath(240, 416, 720, 48); // → east to the west vertical
  addPath(672, 1408, 288, 48); // security → west vertical
  addPath(2740, 360, 48, 96); // studio vestibule → down
  addPath(2624, 408, 164, 48); // → west to the east vertical
  addPath(1552, 1024, 64, 856); // HQ south door → avenue
  addPath(944, 1944, 96, 56); // west vertical → plaza
  addPath(2544, 1944, 96, 56); // east vertical → plaza top area
  addPath(1920, 2480, 1500, 48); // plaza → helipad
  addPath(3396, 2400, 56, 240); // helipad approach
  // Zebra crosswalks on the avenue at each junction (vertical bars, 3×4 tiles)
  [968, 1560, 2568].forEach((cx) => {
    for (let row = 0; row < 4; row++) {
      const key = row % 2 ? 'fwt_crosswalk_b' : 'fwt_crosswalk_a';
      for (let col = 0; col < 3; col++) {
        scene.add.image(cx + col * 16, 1880 + row * 16, key).setOrigin(0).setDepth(1.2);
      }
    }
  });

  // 3 ── Zones
  const rtr = new RoomTileRenderer(scene, rbCat);
  buildHQ(scene, rtr, zones.dolonia_hq);
  buildSecurity(scene, rtr, zones.security_complex);
  buildStamp(scene, zones.japanese_retreat, ['fw_jp_l1', 'fw_jp_l2'], {
    opening: { side: 'south', from: 240, to: 292 }, label: 'JAPANESE RETREAT',
  });
  buildStamp(scene, zones.news_studio, ['fw_st_l1', 'fw_st_l2', 'fw_st_l3'], {
    opening: { side: 'south', from: 2738, to: 2796 }, label: 'NEWS STUDIO',
  });
  buildPlaza(scene, zones.city_plaza);
  buildHelipad(scene, zones.helipad);

  // 3b ── The Denizen HQ building on the avenue — the door back into the
  // office interior. The G-NERIC CORP facade (office_building_ex2) stands
  // west of the HQ connector path; its glass entrance is the return portal.
  if (scene.textures.exists('fw_hq_building')) {
    const bx = 1200, by = 1864; // origin bottom-left on the north sidewalk
    const b = scene.add.image(bx, by, 'fw_hq_building').setOrigin(0, 1);
    b.setDepth(by);
    // Solid except the entrance (door at facade center, ~x 1352-1390)
    state.solids.push({ x: bx, y: by - 40, w: 152, h: 40 });
    state.solids.push({ x: bx + 190, y: by - 40, w: 114, h: 40 });
    const label = scene.add.text(bx + 152, by - 292, 'DENIZEN HQ', {
      fontFamily: 'monospace', fontSize: '10px', color: '#e2e8f0',
      backgroundColor: '#0f172acc', padding: { x: 5, y: 2 },
    }).setOrigin(0.5, 1).setDepth(6000);
    label.setResolution(2);
    state.hqDoor = { x0: bx + 152, x1: bx + 190, y: by };
  }

  // 4 ── Ambient greenery outside zones (deterministic scatter)
  scatterGreenery(scene);

  // 5 ── Player + NPCs + camera
  makeCharAnims(scene);
  const entry = new URLSearchParams(window.location.search).get('entry');
  if (entry === 'office' && state.hqDoor) {
    // Just stepped out of the office — spawn on the sidewalk at the door
    spawnPlayer(scene, (state.hqDoor.x0 + state.hqDoor.x1) / 2, state.hqDoor.y + 14);
    state.playerDir = 'd';
  } else {
    spawnPlayer(scene, 1592, 985);
  }
  NPC_SPECS.forEach((spec) => spawnNpc(scene, spec));

  const cam = scene.cameras.main;
  cam.setBounds(0, 0, WORLD_W, WORLD_H);
  cam.setZoom(2);
  cam.startFollow(state.player, true, 0.12, 0.12);

  scene.events.on('update', (t, dt) => tick(scene, dt));
  console.log('[FullWorld] built: 6 zones,', state.solids.length, 'solids,', state.npcs.length, 'npcs');
}

// ── Zone builders ───────────────────────────────────────────────────────────

function zoneLabel(scene, x, y, text) {
  const t = scene.add.text(x, y, text, {
    fontFamily: 'monospace', fontSize: '10px', color: '#e2e8f0',
    backgroundColor: '#0f172acc', padding: { x: 5, y: 2 },
  }).setOrigin(0.5, 1).setDepth(6000);
  t.setResolution(2);
  return t;
}

function placeFurniture(scene, zone, defs) {
  defs.forEach((d) => {
    const [theme, n] = d.s;
    const key = `fw_s_${theme}_${n}`;
    if (!scene.textures.exists(key)) return;
    const x = zone.x + d.tx * T;
    const y = zone.y + d.ty * T;
    const img = scene.add.image(x, y, key).setOrigin(0.5, 1);
    img.setDepth(y);
    if (d.solid) {
      const w = img.width;
      state.solids.push({ x: x - w / 2, y: y - 10, w, h: 10 });
    }
  });
}

function shellSolids(zone, cols, rows, doorGaps) {
  // Solid bands for a RoomTileRenderer shell: north wall (3 tiles), side
  // columns, and an invisible line across the open south face, minus doors.
  const zx = zone.x, zy = zone.y;
  const withGaps = (rect, gaps, horizontal) => {
    if (!gaps || !gaps.length) { state.solids.push(rect); return; }
    let cursor = horizontal ? rect.x : rect.y;
    const end = horizontal ? rect.x + rect.w : rect.y + rect.h;
    gaps.sort((a, b) => a[0] - b[0]).forEach(([g0, g1]) => {
      if (g0 > cursor) {
        state.solids.push(horizontal
          ? { x: cursor, y: rect.y, w: g0 - cursor, h: rect.h }
          : { x: rect.x, y: cursor, w: rect.w, h: g0 - cursor });
      }
      cursor = Math.max(cursor, g1);
    });
    if (end > cursor) {
      state.solids.push(horizontal
        ? { x: cursor, y: rect.y, w: end - cursor, h: rect.h }
        : { x: rect.x, y: cursor, w: rect.w, h: end - cursor });
    }
  };
  withGaps({ x: zx, y: zy, w: cols * T, h: 3 * T }, doorGaps.north, true);
  withGaps({ x: zx, y: zy + 3 * T, w: T, h: (rows - 3) * T }, doorGaps.west, false);
  withGaps({ x: zx + (cols - 1) * T, y: zy + 3 * T, w: T, h: (rows - 3) * T }, doorGaps.east, false);
  withGaps({ x: zx, y: zy + (rows - 1) * T, w: cols * T, h: T }, doorGaps.south, true);
}

function buildHQ(scene, rtr, zone) {
  const { x, y, cols, rows } = zone;
  rtr.renderRoom({ x, y, cols, rows, roomType: 'open_office', depthBase: 3, doors: [] });
  // Break-corner floor accent
  rtr.fillFloorZone({ x: x + T, y: y + 15 * T, w: 13 * T, h: 8 * T, floor: 'tile_white', depthBase: 3.4 });
  rtr.fillFloorZone({ x: x + 27 * T, y: y + 8 * T, w: 12 * T, h: 8 * T, floor: 'carpet_blue', depthBase: 3.4 });
  placeFurniture(scene, zone, HQ_FURNITURE);
  // Animated coffee machine on the break counter
  if (scene.anims && scene.textures.exists('fw_anim_coffee')) {
    const cx = x + 8.6 * T, cy = y + 20.9 * T;
    const sp = scene.add.sprite(cx, cy, 'fw_anim_coffee').setOrigin(0.5, 1).setDepth(cy);
    ensureAnim(scene, 'fw_coffee_loop', 'fw_anim_coffee', 5, 6);
    sp.play('fw_coffee_loop');
  }
  const doorX0 = x + 18 * T, doorX1 = x + 21 * T;
  shellSolids(zone, cols, rows, { south: [[doorX0, doorX1]] });
  zoneLabel(scene, x + (cols * T) / 2, y - 6, 'DOLONIA HQ');
}

function buildSecurity(scene, rtr, zone) {
  const { x, y, cols, rows } = zone;
  rtr.renderRoom({ x, y, cols, rows, roomType: 'jail', depthBase: 3, doors: [] });
  // Infirmary floor zone (white tile, south-east quadrant)
  rtr.fillFloorZone({ x: x + 16 * T, y: y + 10 * T, w: 15 * T, h: 7 * T, floor: 'tile_white', depthBase: 3.4 });
  placeFurniture(scene, zone, SECURITY_FURNITURE);
  // Animated control-room screens + server racks
  if (scene.textures.exists('fw_anim_screens')) {
    const sx = x + 27 * T, sy = y + 8.6 * T;
    const sp = scene.add.sprite(sx, sy, 'fw_anim_screens').setOrigin(0.5, 1).setDepth(sy);
    ensureAnim(scene, 'fw_screens_loop', 'fw_anim_screens', 21, 5);
    sp.play('fw_screens_loop');
  }
  if (scene.textures.exists('fw_anim_server')) {
    ensureAnim(scene, 'fw_server_loop', 'fw_anim_server', 2, 4);
    [26, 31].forEach((tx) => {
      const sx = x + tx * T, sy = y + 10.4 * T;
      scene.add.sprite(sx, sy, 'fw_anim_server').setOrigin(0.5, 1).setDepth(sy).play('fw_server_loop');
    });
  }
  const doorY0 = y + 14 * T, doorY1 = y + 16 * T;
  shellSolids(zone, cols, rows, { east: [[doorY0, doorY1]] });
  zoneLabel(scene, x + (cols * T) / 2, y - 6, 'SECURITY COMPLEX');
}

function buildStamp(scene, zone, layerKeys, opts) {
  const { x, y } = zone;
  const img0 = scene.textures.get(layerKeys[0]).getSourceImage();
  const w = img0.width, h = img0.height;
  layerKeys.forEach((key, i) => {
    const depth = i === 0 ? 3 : y + h * 0.62 + i;
    scene.add.image(x, y, key).setOrigin(0).setDepth(depth);
  });
  // Border solids with one opening
  const o = opts.opening;
  const edge = 10;
  const seg = (rx, ry, rw, rh) => state.solids.push({ x: rx, y: ry, w: rw, h: rh });
  // north / south
  seg(x, y, w, o.side === 'north' ? 0 : edge * 3); // north wall band is tall in LimeZu art
  seg(x, y + h - edge, w, o.side === 'south' ? 0 : edge);
  if (o.side === 'south') {
    seg(x, y + h - edge, o.from - x, edge);
    seg(o.to, y + h - edge, x + w - o.to, edge);
  }
  // west / east
  if (o.side === 'west') {
    seg(x, y, edge, o.from - y);
    seg(x, o.to, edge, y + h - o.to);
  } else {
    seg(x, y, edge, h);
  }
  if (o.side === 'east') {
    seg(x + w - edge, y, edge, o.from - y);
    seg(x + w - edge, o.to, edge, y + h - o.to);
  } else {
    seg(x + w - edge, y, edge, h);
  }
  zoneLabel(scene, x + w / 2, y - 6, opts.label);
}

function buildPlaza(scene, zone) {
  const { x, y } = zone;
  const w = zone.cols * T, h = zone.rows * T;
  scene.add.tileSprite(x, y, w, h, 'fwt_sidewalk_tile').setOrigin(0).setDepth(0.8);

  // Central park square
  const px = x + 320, py = y + 280, pw = 640, ph = 320;
  scene.add.tileSprite(px, py, pw, ph, 'fwt_grass_tile').setOrigin(0).setDepth(0.9);

  const prop = (rectName, wx, wy, solid = true, solidH = 12) => {
    const key = cropTex(scene, `fwp_${rectName}`, rectName);
    const img = scene.add.image(wx, wy, key).setOrigin(0.5, 1).setDepth(wy);
    if (solid) {
      state.solids.push({ x: wx - img.width / 2, y: wy - solidH, w: img.width, h: solidH });
    }
    return img;
  };

  // Street facades along the avenue north of the plaza
  let bx = x + 1080;
  ['bld_yellow', 'bld_grey', 'bld_tan', 'bld_blue', 'bld_tan'].forEach((b) => {
    const key = cropTex(scene, `fwp_${b}`, b);
    const img = scene.add.image(bx, 1864, key).setOrigin(0, 1).setDepth(1864);
    state.solids.push({ x: bx, y: 1864 - 60, w: img.width, h: 60 });
    bx += img.width + 8;
  });
  // A second small block west of the HQ connector
  let bx2 = x + 200;
  ['bld_grey', 'bld_yellow'].forEach((b) => {
    const key = cropTex(scene, `fwp_${b}`, b);
    const img = scene.add.image(bx2, 1864, key).setOrigin(0, 1).setDepth(1864);
    state.solids.push({ x: bx2, y: 1864 - 60, w: img.width, h: 60 });
    bx2 += img.width + 8;
  });

  // Park trees + planter border
  [[px + 40, py + 60], [px + pw - 40, py + 60], [px + 40, py + ph - 10], [px + pw - 40, py + ph - 10], [px + pw / 2, py + 40]]
    .forEach(([tx, ty]) => prop('tree_round', tx, ty));
  for (let i = 0; i < 5; i++) prop('planter_box', px + 90 + i * 115, py + ph / 2, true, 24);

  // Lamps around the plaza
  [[x + 80, y + 120], [x + w / 2, y + 100], [x + w - 80, y + 120],
    [x + 80, y + h - 60], [x + w / 2, y + h - 40], [x + w - 80, y + h - 60],
    [x + 80, y + h / 2], [x + w - 80, y + h / 2]]
    .forEach(([lx, ly]) => prop('lamp_double', lx, ly, true, 8));

  // South tree line + cypress rows down both flanks
  for (let i = 0; i < 6; i++) prop('tree_round', x + 120 + i * 210, y + h - 14);
  for (let i = 0; i < 4; i++) {
    prop('tree_cypress', x + 40, y + 180 + i * 170);
    prop('tree_cypress', x + w - 40, y + 180 + i * 170);
  }

  // Flower strips framing the park entries
  const parkMidY = py + ph / 2;
  [[px - 20, parkMidY - 60], [px - 20, parkMidY + 60], [px + pw + 20, parkMidY - 60], [px + pw + 20, parkMidY + 60]]
    .forEach(([fx, fy]) => prop('flowers_strip', fx, fy, false));

  // Phone booth + parked cars on the avenue's south sidewalk
  prop('phone_booth', x + 1150, y + 160);
  prop('car_blue', x + 460, 1972, true, 20);
  prop('car_red', x + 760, 1972, true, 20);
  prop('car_teal', x + 1560, 1972, true, 20);
  prop('car_red', x + 1820, 1972, true, 20);

  zoneLabel(scene, x + w / 2, y + 40, 'CITY PLAZA');
}

function buildHelipad(scene, zone) {
  const { x, y } = zone;
  const padKey = cropTex(scene, 'fwp_helipad', 'helipad_platform');
  const heliKey = cropTex(scene, 'fwp_heli', 'helicopter');
  scene.add.image(x, y, padKey).setOrigin(0).setDepth(2);
  const heli = scene.add.image(x + 128, y + 118, heliKey).setOrigin(0.5, 1);
  heli.setDepth(y + 120);
  // Platform railing solids — open at the south stairs (x+100..x+152)
  state.solids.push({ x, y, w: 252, h: 46 });
  state.solids.push({ x, y: y + 46, w: 14, h: 130 });
  state.solids.push({ x: x + 238, y: y + 46, w: 14, h: 130 });
  state.solids.push({ x, y: y + 176, w: 100, h: 16 });
  state.solids.push({ x: x + 152, y: y + 176, w: 100, h: 16 });
  zoneLabel(scene, x + 126, y - 6, 'HELIPAD');
}

function scatterGreenery(scene) {
  // Deterministic LCG scatter of trees/cypresses on open grass
  const treeKey = cropTex(scene, 'fwp_tree_round', 'tree_round');
  const cypKey = cropTex(scene, 'fwp_tree_cypress', 'tree_cypress');
  const noGo = [
    { x: 100, y: 100, w: 480, h: 380 },     // japanese
    { x: 1220, y: 560, w: 760, h: 560 },    // HQ
    { x: 100, y: 1140, w: 640, h: 420 },    // security
    { x: 2620, y: 140, w: 300, h: 280 },    // studio
    { x: 580, y: 1820, w: 1420, h: 1040 },  // plaza + avenue south
    { x: 3340, y: 2340, w: 380, h: 340 },   // helipad
    { x: 100, y: 1820, w: 3900, h: 190 },   // avenue
    { x: 900, y: 340, w: 190, h: 1600 },    // west vertical
    { x: 2500, y: 320, w: 190, h: 1620 },   // east vertical
    { x: 1500, y: 1000, w: 180, h: 900 },   // HQ path
    { x: 1880, y: 2440, w: 1600, h: 140 },  // helipad path
  ];
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let placed = 0;
  for (let i = 0; i < 400 && placed < 90; i++) {
    const wx = 60 + rnd() * (WORLD_W - 120);
    const wy = 80 + rnd() * (WORLD_H - 160);
    if (noGo.some((r) => wx > r.x - 30 && wx < r.x + r.w + 30 && wy > r.y - 20 && wy < r.y + r.h + 60)) continue;
    const key = rnd() < 0.75 ? treeKey : cypKey;
    scene.add.image(wx, wy, key).setOrigin(0.5, 1).setDepth(wy);
    state.solids.push({ x: wx - 10, y: wy - 10, w: 20, h: 10 });
    placed++;
  }
}

// ── Characters ──────────────────────────────────────────────────────────────

const CHAR_COLS = 56; // 896 / 16
const DIRS = ['r', 'u', 'l', 'd'];

function ensureAnim(scene, key, tex, lastFrame, rate) {
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(tex, { start: 0, end: lastFrame }),
    frameRate: rate,
    repeat: -1,
  });
}

function makeCharAnims(scene) {
  for (let c = 1; c <= 9; c++) {
    const tex = `fw_char_${c}`;
    if (!scene.textures.exists(tex)) continue;
    DIRS.forEach((d, di) => {
      const idleStart = CHAR_COLS + di * 6;
      const walkStart = CHAR_COLS * 2 + di * 6;
      if (!scene.anims.exists(`${tex}_idle_${d}`)) {
        scene.anims.create({
          key: `${tex}_idle_${d}`,
          frames: scene.anims.generateFrameNumbers(tex, { start: idleStart, end: idleStart + 5 }),
          frameRate: 4, repeat: -1,
        });
      }
      if (!scene.anims.exists(`${tex}_walk_${d}`)) {
        scene.anims.create({
          key: `${tex}_walk_${d}`,
          frames: scene.anims.generateFrameNumbers(tex, { start: walkStart, end: walkStart + 5 }),
          frameRate: 9, repeat: -1,
        });
      }
    });
  }
}

function spawnPlayer(scene, x, y) {
  const sp = scene.add.sprite(x, y, 'fw_char_1').setOrigin(0.5, 1);
  sp.play('fw_char_1_idle_d');
  sp.setDepth(y);
  state.player = sp;
  state.playerDir = 'd';
  state.keys = scene.input.keyboard.addKeys({
    up: 'W', down: 'S', left: 'A', right: 'D',
    u2: 'UP', d2: 'DOWN', l2: 'LEFT', r2: 'RIGHT',
  });
}

function spawnNpc(scene, spec) {
  const tex = `fw_char_${spec.char}`;
  if (!scene.textures.exists(tex)) return;
  const sp = scene.add.sprite(spec.x, spec.y, tex).setOrigin(0.5, 1);
  sp.play(`${tex}_idle_d`);
  sp.setDepth(spec.y);
  const label = scene.add.text(spec.x, spec.y - 36, spec.name, {
    fontFamily: 'monospace', fontSize: '8px', color: '#f8fafc',
    backgroundColor: '#0f172aaa', padding: { x: 3, y: 1 },
  }).setOrigin(0.5, 1).setDepth(6000);
  label.setResolution(2);
  state.npcs.push({
    sp, label, tex, home: { x: spec.x, y: spec.y }, r: spec.r,
    target: null, waitUntil: 0, dir: 'd',
  });
}

// ── Simulation ──────────────────────────────────────────────────────────────

const PLAYER_SPEED = 115;
const NPC_SPEED = 42;

function hitsSolid(x, y) {
  // Character base: 10 wide, 6 tall, anchored at bottom-center (x, y)
  const bx = x - 5, by = y - 6, bw = 10, bh = 6;
  if (x < 8 || x > WORLD_W - 8 || y < 40 || y > WORLD_H - 4) return true;
  for (let i = 0; i < state.solids.length; i++) {
    const s = state.solids[i];
    if (bx < s.x + s.w && bx + bw > s.x && by < s.y + s.h && by + bh > s.y) return true;
  }
  return false;
}

function dirFrom(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'r' : 'l';
  return dy > 0 ? 'd' : 'u';
}

function tick(scene, dt) {
  const p = state.player;
  if (!p || !p.active) return;
  const step = Math.min(dt, 50) / 1000;

  // Player movement (WASD/arrows + the raw-key bootstrap fallback)
  const k = state.keys || {};
  const raw = window.__DenizenRawMoveKeys || {};
  let vx = 0, vy = 0;
  if (k.left?.isDown || k.l2?.isDown || raw.left) vx -= 1;
  if (k.right?.isDown || k.r2?.isDown || raw.right) vx += 1;
  if (k.up?.isDown || k.u2?.isDown || raw.up) vy -= 1;
  if (k.down?.isDown || k.d2?.isDown || raw.down) vy += 1;

  // Denizen HQ entrance: walking into the glass doors returns to the office
  const door = state.hqDoor;
  if (door && !state._enteringOffice
      && p.x > door.x0 && p.x < door.x1 && p.y < door.y - 6 && p.y > door.y - 46) {
    state._enteringOffice = true;
    try { window.location.href = '/office?demo=1'; } catch (_) {}
  }

  if (vx || vy) {
    const inv = 1 / Math.hypot(vx, vy);
    const nx = p.x + vx * inv * PLAYER_SPEED * step;
    const ny = p.y + vy * inv * PLAYER_SPEED * step;
    // If already overlapping a solid (bad spawn, moved furniture), let the
    // player walk out instead of freezing forever.
    const stuck = hitsSolid(p.x, p.y);
    if (stuck || !hitsSolid(nx, p.y)) p.x = nx;
    if (stuck || !hitsSolid(p.x, ny)) p.y = ny;
    const d = dirFrom(vx, vy);
    state.playerDir = d;
    const want = `fw_char_1_walk_${d}`;
    if (p.anims?.currentAnim?.key !== want) p.play(want);
  } else {
    const want = `fw_char_1_idle_${state.playerDir}`;
    if (p.anims?.currentAnim?.key !== want) p.play(want);
  }
  p.setDepth(p.y);

  // NPC wander
  const now = scene.time.now;
  state.npcs.forEach((n) => {
    if (!n.target) {
      if (now >= n.waitUntil) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * n.r;
        n.target = { x: n.home.x + Math.cos(a) * r, y: n.home.y + Math.sin(a) * r };
      }
    } else {
      const dx = n.target.x - n.sp.x, dy = n.target.y - n.sp.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        n.target = null;
        n.waitUntil = now + 1200 + Math.random() * 3200;
        n.sp.play(`${n.tex}_idle_${n.dir}`, true);
      } else {
        const nx = n.sp.x + (dx / dist) * NPC_SPEED * step;
        const ny = n.sp.y + (dy / dist) * NPC_SPEED * step;
        if (hitsSolid(nx, ny)) {
          n.target = null;
          n.waitUntil = now + 800;
        } else {
          n.sp.x = nx; n.sp.y = ny;
          n.dir = dirFrom(dx, dy);
          const want = `${n.tex}_walk_${n.dir}`;
          if (n.sp.anims?.currentAnim?.key !== want) n.sp.play(want);
        }
      }
    }
    n.sp.setDepth(n.sp.y);
    n.label.setPosition(n.sp.x, n.sp.y - 36);
  });
}

if (typeof window !== 'undefined') window.DenizenFullWorld = { buildFullWorld, state };
