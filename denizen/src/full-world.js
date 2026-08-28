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
const CHAR_COLS = 56; // 896 / 16 — character sheet columns
const DIRS = ['r', 'u', 'l', 'd'];

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
  portals: [],
  vehicles: [],
  interactables: [],
  planLabels: [],
  seated: null,
  worldW: WORLD_W,
  worldH: WORLD_H,
};

export function buildFullWorld(scene) {
  const bust = 'fw1';
  const lz = (p) => `assets/limezu/${p}?v=${bust}`;

  // The city plan (data/city-plan.json) declares districts built from the
  // FULL Modern Exteriors pack (assets/limezu/ext/): terrain patches,
  // building/prop stamps, animated sheets, roads, solids, door portals,
  // labels. Missing file → empty plan, world builds as before.
  // Always fetch the current plan — it changes far more often than code
  scene.load.json('fw_cityplan', `data/city-plan.json?t=${Date.now()}`);

  RoomTileRenderer.preload(scene);
  scene.load.json('fw_blueprint', `data/full-world-blueprint.json?v=${bust}`);
  scene.load.json('fw_rbtiles', `data/room-builder-tiles.json?v=${bust}`);
  scene.load.image('fw_terrain', lz('exteriors/city_terrain.png'));
  // Beach sheet loaded in the FIRST pass so sand patches (and the paved core)
  // can paint immediately, instead of the world showing all-grass for minutes
  // then popping to sidewalk once the heavy second-pass load finishes.
  scene.load.image('cp_ext_themes_21_Beach_png', 'assets/limezu/ext/themes/21_Beach.png');
  // Grass-overhang autotile (Grass_2): tufted grass edges that flow OVER the
  // concrete boundary so the paved core doesn't meet grass with a hard cut.
  // Index per direction decoded by tufted-edge classification.
  const GO = { n: 6, s: 2, w: 4, e: 8, nw: 5, ne: 7, sw: 3, se: 1 };
  for (const [k, idx] of Object.entries(GO)) {
    scene.load.image('fwt_go_' + k,
      'assets/limezu/ext/singles/1_terrains_and_fences/ME_Singles_Terrains_and_Fences_16x16_Grass_2_' + idx + '.png');
  }
  scene.load.image('fw_props', lz('exteriors/city_props.png'));
  scene.load.image('fw_vehicles', lz('exteriors/vehicles.png'));
  scene.load.image('fw_buildings', lz('exteriors/generic_buildings.png'));
  scene.load.image('fw_hq_building', lz('examples/office_building_ex2.png'));
  scene.load.image('fw_jp_l1', lz('examples/japanese_layer1.png'));
  scene.load.image('fw_jp_l2', lz('examples/japanese_layer2.png'));
  scene.load.image('fw_st_l1', lz('examples/studio_layer1.png'));
  scene.load.image('fw_st_l2', lz('examples/studio_layer2.png'));
  scene.load.image('fw_st_l3', lz('examples/studio_layer3.png'));
  scene.load.spritesheet('fw_door_sliding', lz('animated/door_sliding.png'), { frameWidth: 32, frameHeight: 32 });
  scene.load.spritesheet('fw_anim_screens', lz('animated/control_screens.png'), { frameWidth: 32, frameHeight: 48 });
  scene.load.spritesheet('fw_anim_server', lz('animated/server_rack.png'), { frameWidth: 16, frameHeight: 48 });
  scene.load.spritesheet('fw_anim_coffee', lz('animated/coffee.png'), { frameWidth: 16, frameHeight: 32 });

  for (let c = 1; c <= 20; c++) {
    const nn = String(c).padStart(2, '0');
    scene.load.spritesheet(`fw_char_${c}`, lz(`characters/char_${nn}.png`), { frameWidth: 16, frameHeight: 32 });
  }
  // The player's real avatar (same as the office): Character Generator 2.0
  // sheet, 24 cols x 1 row, 32x64 frames. Used so walking outside keeps you
  // as Dolo instead of swapping to a generic character.
  scene.load.spritesheet('fw_dolo', 'assets/Dolo.png', { frameWidth: 32, frameHeight: 64 });

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

/** Drop a GPU texture after all useful pixels have been cropped out of it. */
function releaseTexture(scene, key) {
  if (!scene.textures.exists(key)) return false;
  try {
    scene.textures.remove(key);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Character sheets are 20 rows × 56 cols, but the city only plays idle (row 1)
 * and run (row 2). Replacing each full sheet with a 2-row slim copy frees
 * ~40 MB of GPU texture (896×656 → 896×64 × 20).
 */
function slimCharSheets(scene) {
  if (state._charsSlimmed) return;
  const FW = 16;
  const FH = 32;
  const COLS = CHAR_COLS;
  const SLIM_ROWS = 2;
  const SRC_Y = FH; // skip static-dirs row 0
  let slimmed = 0;
  for (let c = 1; c <= 20; c += 1) {
    const key = `fw_char_${c}`;
    if (!scene.textures.exists(key)) continue;
    const tex = scene.textures.get(key);
    if (tex?.customData?.slimmed) continue;
    const src = tex.getSourceImage?.() || tex.source?.[0]?.image;
    if (!src) continue;
    const w = COLS * FW;
    const h = SLIM_ROWS * FH;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, SRC_Y, w, h, 0, 0, w, h);
    releaseTexture(scene, key);
    scene.textures.addSpriteSheet(key, canvas, { frameWidth: FW, frameHeight: FH });
    const slim = scene.textures.get(key);
    if (slim) slim.customData = { ...(slim.customData || {}), slimmed: true };
    slimmed += 1;
  }
  state._charsSlimmed = true;
  state._charsSlimCount = slimmed;
}

/** Estimate resident GPU texture bytes (RGBA, no mipmaps). */
function textureBudget(scene) {
  const list = scene?.textures?.list || {};
  let bytes = 0;
  let count = 0;
  const big = [];
  Object.keys(list).forEach((key) => {
    if (key === '__DEFAULT' || key === '__MISSING') return;
    const tex = list[key];
    const src = tex?.source?.[0];
    const w = Number(src?.width || tex?.width || 0);
    const h = Number(src?.height || tex?.height || 0);
    if (!w || !h) return;
    const b = w * h * 4;
    bytes += b;
    count += 1;
    if (b >= 256 * 1024) big.push({ key, w, h, mb: +(b / 1024 / 1024).toFixed(2) });
  });
  big.sort((a, b) => b.mb - a.mb);
  return {
    textures: count,
    mb: +(bytes / 1024 / 1024).toFixed(2),
    charsSlimmed: !!state._charsSlimmed,
    atlasesReleased: !!state._atlasesReleased,
    biggest: big.slice(0, 12),
  };
}

function build(scene) {
  if (state.built) return;
  state.built = true;
  const bp = scene.cache.json.get('fw_blueprint');
  const rbCat = scene.cache.json.get('fw_rbtiles');
  const plan = scene.cache.json.get('fw_cityplan') || {};
  const zones = {};
  (bp?.zones || []).forEach((z) => { zones[z.id] = z; });

  // The city plan may grow the canvas beyond the blueprint's 4096x3072
  state.worldW = plan.worldSize?.w || WORLD_W;
  state.worldH = plan.worldSize?.h || WORLD_H;

  // Trim character sheets BEFORE anims / sprites reference frame indices.
  slimCharSheets(scene);

  // Eagerly crop every exterior rect so source atlases can be freed after zones.
  ['grass_tile', 'asphalt_tile', 'sidewalk_tile', 'crosswalk_a', 'crosswalk_b'].forEach((n) => {
    cropTex(scene, `fwt_${n}`, n);
  });
  Object.keys(EXT_RECTS).forEach((n) => {
    if (n.endsWith('_tile') || n.startsWith('crosswalk_')) return;
    cropTex(scene, `fwp_${n}`, n);
  });
  // Call-site aliases (helipad uses shorter keys than EXT_RECTS names).
  cropTex(scene, 'fwp_helipad', 'helipad_platform');
  cropTex(scene, 'fwp_heli', 'helicopter');

  // 1 ── Ground: grass everywhere
  scene.add.tileSprite(0, 0, state.worldW, state.worldH, 'fwt_grass_tile').setOrigin(0).setDepth(0);

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

  // 3a2 ── Enclose the shop interiors in proper LimeZu room shells (floor +
  // 3D walls) so they read as rooms you teleport INTO, not furniture dumped on
  // bare pavement outside. Visual only (renderRoom adds no collision), so the
  // teleported player is never trapped. Coords mirror d16-interiors floors.
  encloseInteriors(scene, rtr);

  // 3b ── The Denizen HQ building on the avenue — the door back into the
  // office interior. The G-NERIC CORP facade (office_building_ex2) stands
  // west of the HQ connector path; its glass entrance is the return portal.
  if (scene.textures.exists('fw_hq_building')) {
    const bx = 1200, by = 1864; // origin bottom-left on the north sidewalk
    const b = scene.add.image(bx, by, 'fw_hq_building').setOrigin(0, 1);
    b.setDepth(by);
    // The facade's REAL entrance is the glass double door at facade
    // x 84-116 (pixel-measured) — world x 1284-1316, NOT the center.
    state.solids.push({ x: bx, y: by - 40, w: 84, h: 40 });
    state.solids.push({ x: bx + 116, y: by - 40, w: 188, h: 40 });
    const label = scene.add.text(bx + 152, by - 292, 'DENIZEN HQ', {
      fontFamily: 'monospace', fontSize: '10px', color: '#e2e8f0',
      backgroundColor: '#0f172acc', padding: { x: 5, y: 2 },
    }).setOrigin(0.5, 1).setDepth(6000);
    label.setResolution(2);
    state.hqDoor = { x0: bx + 82, x1: bx + 118, y: by };
    // Automatic sliding door (animated/door_sliding, 32x32, frames 0-7 =
    // panels retracting) placed EXACTLY over the facade's baked entrance
    // (door bottom at facade y284 = world by-4). Renders above the facade
    // (which has the doors painted shut), below the y-sorted player.
    if (scene.textures.exists('fw_door_sliding')) {
      if (!scene.anims.exists('fw_door_opening')) {
        scene.anims.create({
          key: 'fw_door_opening',
          frames: scene.anims.generateFrameNumbers('fw_door_sliding', { start: 0, end: 7 }),
          frameRate: 18, repeat: 0,
        });
      }
      if (!scene.anims.exists('fw_door_closing')) {
        scene.anims.create({
          key: 'fw_door_closing',
          frames: scene.anims.generateFrameNumbers('fw_door_sliding', { start: 7, end: 0 }),
          frameRate: 18, repeat: 0,
        });
      }
      scene.add.rectangle(bx + 100, by - 21, 32, 36, 0x131521, 1).setDepth(by + 1);
      const doorSp = scene.add.sprite(bx + 100, by - 3, 'fw_door_sliding', 0).setOrigin(0.5, 1);
      doorSp.setDisplaySize(32, 36);
      doorSp.setDepth(by + 2);
      state.hqDoorSprite = doorSp;
      state.hqDoorOpen = false;
    }
  }

  // 4 ── Ambient greenery outside zones (deterministic scatter)
  scatterGreenery(scene);

  // Props / vehicles / buildings atlases are crop sources only — drop them now
  // that every fwp_* canvas exists (~24 MB GPU back).
  ['fw_props', 'fw_vehicles', 'fw_buildings'].forEach((k) => releaseTexture(scene, k));

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
  cam.setBounds(0, 0, state.worldW, state.worldH);
  applyCityCamera(scene);
  cam.startFollow(state.player, true, 0.12, 0.12);
  // Re-apply on rotate/resize: a phone that starts portrait and turns landscape
  // otherwise keeps the portrait zoom and shows a sliver of street.
  scene.scale.on('resize', () => applyCityCamera(scene));

  scene.events.on('update', (t, dt) => tick(scene, dt));

  // 6 ── City plan districts (second load pass for its referenced art)
  renderCityPlan(scene, plan);
  const budget = textureBudget(scene);
  console.log(
    '[FullWorld] built: 6 zones,',
    state.solids.length, 'solids,',
    state.npcs.length, 'npcs,',
    `textures=${budget.mb}MB (${budget.textures})`,
    state._charsSlimmed ? `charsSlim=${state._charsSlimCount || 20}` : 'charsFull',
    state._atlasesReleased ? 'atlasesReleased' : 'atlasesKept',
  );
}

// ── City plan renderer ──────────────────────────────────────────────────────
// data/city-plan.json is fully declarative:
//   worldSize {w,h}
//   patches [{tile:'grass|sidewalk|asphalt', x,y,w,h, depth?}]        terrain
//   roads   [{x,y,w,h}]                                    asphalt + sidewalk
//   stamps  [{img:'ext/...', x,y, origin?:'bl|tl|bc', depth?, scale?,
//             solid?:{dx,dy,w,h} | true,
//             interact?:'sit|read|shop|play|enter'}]     buildings and props
//   anims   [{sheet:'ext/animated/...', fw,fh, x,y, fps?, frames?, depth?,
//             origin?}]                                    animated objects
//   solids  [{x,y,w,h}]                                     extra collision
//   portals [{x0,x1,y, href, doorSheet?, fw,fh, doorX,doorY, dw,dh}]
//   labels  [{x,y,text}]
const planKey = (p) => 'cp_' + p.replace(/[^a-zA-Z0-9]/g, '_');

function renderCityPlan(scene, plan) {
  if (!plan || (!plan.stamps && !plan.anims && !plan.patches)) return;
  const toLoad = new Set();
  (plan.stamps || []).forEach((s) => {
    if (!scene.textures.exists(planKey(s.img))) toLoad.add(JSON.stringify({ t: 'img', p: s.img }));
  });
  (plan.anims || []).forEach((a) => {
    if (!scene.textures.exists(planKey(a.sheet))) toLoad.add(JSON.stringify({ t: 'sheet', p: a.sheet, fw: a.fw || 16, fh: a.fh || 16 }));
  });
  (plan.portals || []).forEach((p) => {
    if (p.doorSheet && !scene.textures.exists(planKey(p.doorSheet))) toLoad.add(JSON.stringify({ t: 'sheet', p: p.doorSheet, fw: p.fw || 32, fh: p.fh || 32 }));
  });
  (plan.animBands || []).forEach((b) => {
    if (!scene.textures.exists(planKey(b.sheet))) toLoad.add(JSON.stringify({ t: 'sheet', p: b.sheet, fw: b.fw || 16, fh: b.fh || 16 }));
  });
  (plan.vehicles || []).forEach((v) => {
    // New cars are directional single images (correct facing by filename, no
    // flip/anim guesswork). Legacy sheet cars still supported.
    if (v.img) {
      if (!scene.textures.exists(planKey(v.img))) toLoad.add(JSON.stringify({ t: 'img', p: v.img }));
    } else if (v.sheet && !scene.textures.exists(planKey(v.sheet))) {
      toLoad.add(JSON.stringify({ t: 'sheet', p: v.sheet, fw: v.fw || 48, fh: v.fh || 32 }));
    }
  });
  if ((plan.patches || []).some((p) => p.tile === 'sand') && !scene.textures.exists(planKey('ext/themes/21_Beach.png'))) {
    toLoad.add(JSON.stringify({ t: 'img', p: 'ext/themes/21_Beach.png' }));
  }
  toLoad.forEach((e) => {
    const d = JSON.parse(e);
    if (d.t === 'img') scene.load.image(planKey(d.p), 'assets/limezu/' + d.p);
    else scene.load.spritesheet(planKey(d.p), 'assets/limezu/' + d.p, { frameWidth: d.fw, frameHeight: d.fh });
  });
  // Ground (patches + roads) needs only the base tiles, which are already
  // loaded — paint it NOW, in the first pass, so the city STRUCTURE is correct
  // immediately. Only the art-heavy stamps/anims/vehicles wait for the load.
  try { renderGround(scene, plan); } catch (err) { console.error('[FullWorld] ground failed:', err); }
  scene.load.once('complete', () => {
    try { placeCityPlan(scene, plan); } catch (err) { console.error('[FullWorld] city plan failed:', err); }
  });
  scene.load.start();
}

// First-pass ground: sand tile + all terrain patches + roads. Runs before the
// heavy load so there's no "all grass, then sidewalk pops in" flash.
function renderGround(scene, plan) {
  if (state._groundDone) return;
  state._groundDone = true;
  const beach = scene.textures.get('cp_ext_themes_21_Beach_png')?.getSourceImage();
  if (beach && !scene.textures.exists('fwt_sand_tile')) {
    const t = scene.textures.createCanvas('fwt_sand_tile', 16, 16);
    t.context.imageSmoothingEnabled = false;
    t.context.drawImage(beach, 160, 96, 16, 16, 0, 0, 16, 16);
    t.refresh();
  }
  // Shoreline tile — sand-on-top / water-below (found by border classification
  // at beach-sheet 192,16). Laid over the water's top edge so the beach meets
  // the sea with a foam line instead of a dead-straight colour cut.
  if (beach && !scene.textures.exists('fwt_shore_top')) {
    const t = scene.textures.createCanvas('fwt_shore_top', 16, 16);
    t.context.imageSmoothingEnabled = false;
    t.context.drawImage(beach, 192, 16, 16, 16, 0, 0, 16, 16);
    t.refresh();
  }
  // Curb tiles cropped from city_terrain (decoded by border classification):
  // the raised concrete edge that separates sidewalk from asphalt. 16px each.
  const terr = scene.textures.get('fw_terrain')?.getSourceImage();
  // curbs + dashed lane centre-lines, all cropped from city_terrain.
  const TCROP = {
    curb_top: [16, 32], curb_bot: [16, 0], curb_left: [32, 16], curb_right: [0, 16],
    lane_h: [160, 80], lane_v: [144, 96],   // dashed centre lines
  };
  if (terr) {
    for (const [k, [sx, sy]] of Object.entries(TCROP)) {
      const key = 'fwt_' + k;
      if (scene.textures.exists(key)) continue;
      const t = scene.textures.createCanvas(key, 16, 16);
      t.context.imageSmoothingEnabled = false;
      t.context.drawImage(terr, sx, sy, 16, 16, 0, 0, 16, 16);
      t.refresh();
    }
  }
  const TILE_KEYS = { grass: 'fwt_grass_tile', sidewalk: 'fwt_sidewalk_tile', asphalt: 'fwt_asphalt_tile', sand: 'fwt_sand_tile' };
  (plan.patches || []).forEach((p) => {
    const key = TILE_KEYS[p.tile] || TILE_KEYS.sidewalk;
    scene.add.tileSprite(p.x, p.y, p.w, p.h, key).setOrigin(0).setDepth(p.depth ?? 0.9);
  });

  // Road cell lattice (16px) so curbs open at intersections instead of running
  // straight through where cars cross.
  const roadCells = new Set();
  const ckey = (x, y) => Math.floor(x / T) + ',' + Math.floor(y / T);
  (plan.roads || []).forEach((r) => {
    for (let y = r.y; y < r.y + r.h; y += T)
      for (let x = r.x; x < r.x + r.w; x += T) roadCells.add(ckey(x, y));
  });
  const isRoad = (x, y) => roadCells.has(ckey(x, y));
  // Draw a curb along one road edge as contiguous RUNS (one tileSprite per run,
  // broken wherever the outward neighbour is another road = an intersection).
  const curbRun = (fixed, from, to, curbKey, outward, horizontal) => {
    let start = null;
    for (let p = from; p <= to; p += T) {
      const open = p < to && (horizontal ? !isRoad(p, outward) : !isRoad(outward, p));
      if (open && start === null) start = p;
      if (!open && start !== null) {
        if (horizontal) scene.add.tileSprite(start, fixed, p - start, T, curbKey).setOrigin(0).setDepth(1.15);
        else scene.add.tileSprite(fixed, start, T, p - start, curbKey).setOrigin(0).setDepth(1.15);
        start = null;
      }
    }
  };
  (plan.roads || []).forEach((r) => {
    scene.add.tileSprite(r.x - T, r.y - T, r.w + 2 * T, r.h + 2 * T, 'fwt_sidewalk_tile').setOrigin(0).setDepth(1);
    scene.add.tileSprite(r.x, r.y, r.w, r.h, 'fwt_asphalt_tile').setOrigin(0).setDepth(1.1);
    if (r.w >= r.h) {  // horizontal street: curbs top+bottom, dashed centre line
      curbRun(r.y, r.x, r.x + r.w, 'fwt_curb_top', r.y - T, true);
      curbRun(r.y + r.h - T, r.x, r.x + r.w, 'fwt_curb_bot', r.y + r.h, true);
      curbRun(r.y + (r.h - T) / 2, r.x, r.x + r.w, 'fwt_lane_h', r.y - T, true);
    } else {           // vertical street: curbs left+right, dashed centre line
      curbRun(r.x, r.y, r.y + r.h, 'fwt_curb_left', r.x - T, false);
      curbRun(r.x + r.w - T, r.y, r.y + r.h, 'fwt_curb_right', r.x + r.w, false);
      curbRun(r.x + (r.w - T) / 2, r.y, r.y + r.h, 'fwt_lane_v', r.x - T, false);
    }
  });

  // ── Grass overhang ──────────────────────────────────────────────────────
  // Soften every concrete↔grass boundary so the paved core FLOWS into the grass
  // with a tufted edge instead of a hard rectangle. Grass_2 overhang tiles are
  // laid over the boundary paved cell, tufts pointing at the grass side.
  if (scene.textures.exists('fwt_go_n')) {
    const paved = new Set(roadCells), sand = new Set(), water = new Set(), grassP = new Set();
    (plan.patches || []).forEach((p) => {
      const set = p.tile === 'sand' ? sand : (p.tile === 'grass' ? grassP : paved);
      for (let y = p.y; y < p.y + p.h; y += T)
        for (let x = p.x; x < p.x + p.w; x += T) set.add(ckey(x, y));
    });
    (plan.animBands || []).forEach((b) => {
      for (let y = b.y; y < b.y + b.h; y += T)
        for (let x = b.x; x < b.x + b.w; x += T) water.add(ckey(x, y));
    });
    // grass shows where a grass patch sits (even over a slab) OR bare world grass
    const isGrass = (x, y) => {
      const k = ckey(x, y);
      return grassP.has(k) || (!paved.has(k) && !sand.has(k) && !water.has(k));
    };
    // visible concrete = paved and NOT covered by a grass patch / sand / water
    const isConc = (x, y) => {
      const k = ckey(x, y);
      return paved.has(k) && !grassP.has(k) && !sand.has(k) && !water.has(k);
    };
    const goRun = (fixed, from, to, key, outFn, horizontal) => {
      let start = null;
      for (let p = from; p <= to; p += T) {
        const on = p < to && outFn(p);
        if (on && start === null) start = p;
        if (!on && start !== null) {
          if (horizontal) scene.add.tileSprite(start, fixed, p - start, T, key).setOrigin(0).setDepth(1.3);
          else scene.add.tileSprite(fixed, start, T, p - start, key).setOrigin(0).setDepth(1.3);
          start = null;
        }
      }
    };
    // For a rectangle, lay grass-overhang on the CONCRETE side of each edge with
    // the tuft pointing at the grass. `onSide` picks concrete cells; `sx,sy` are
    // the concrete cell offsets from the edge line.
    const edgeOverhang = (x0, y0, x1, y1, grassOfConc) => {
      // grassOfConc(x,y) true where that concrete cell has grass just outside
      goRun(y0, x0, x1, 'fwt_go_n', (x) => grassOfConc(x, y0, 'n'), true);
      goRun(y1 - T, x0, x1, 'fwt_go_s', (x) => grassOfConc(x, y1 - T, 's'), true);
      goRun(x0, y0, y1, 'fwt_go_w', (y) => grassOfConc(x0, y, 'w'), false);
      goRun(x1 - T, y0, y1, 'fwt_go_e', (y) => grassOfConc(x1 - T, y, 'e'), false);
    };
    // 1) concrete patches meeting bare world grass (the paved core's outer edge)
    (plan.patches || []).forEach((p) => {
      if (p.tile === 'grass' || p.tile === 'sand') return;
      const x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
      const g = (cx, cy, dir) => isConc(cx, cy) && (
        dir === 'n' ? isGrass(cx, cy - T) : dir === 's' ? isGrass(cx, cy + T)
          : dir === 'w' ? isGrass(cx - T, cy) : isGrass(cx + T, cy));
      edgeOverhang(x0, y0, x1, y1, g);
    });
    // 2) grass patches on the slab — lay overhang on the concrete cells JUST
    //    outside each edge, tuft pointing back into the grass patch.
    (plan.patches || []).forEach((p) => {
      if (p.tile !== 'grass') return;
      const x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
      goRun(y0 - T, x0, x1, 'fwt_go_s', (x) => isConc(x, y0 - T), true);   // patch top -> grass to S
      goRun(y1, x0, x1, 'fwt_go_n', (x) => isConc(x, y1), true);           // patch bottom -> grass to N
      goRun(x0 - T, y0, y1, 'fwt_go_e', (y) => isConc(x0 - T, y), false);  // patch left -> grass to E
      goRun(x1, y0, y1, 'fwt_go_w', (y) => isConc(x1, y), false);          // patch right -> grass to W
    });
  }

  // Terrain + beach sheets were only crop sources for tiles/curbs/sand/shore.
  releaseTexture(scene, 'fw_terrain');
  releaseTexture(scene, 'cp_ext_themes_21_Beach_png');
  state._atlasesReleased = true;
}

function placeCityPlan(scene, plan) {
  // District signs double as sign-post copy for `interact:"read"` stamps.
  state.planLabels = plan.labels || [];
  // animBands: {sheet, fw, fh, x,y,w,h, fps} → one tiling sprite per region,
  // frame-stepped on a timer (continuous animated ocean/water surfaces).
  (plan.animBands || []).forEach((b) => {
    const key = planKey(b.sheet);
    if (!scene.textures.exists(key)) return;
    // PERF: this used to create ONE animated Sprite per fw x fh cell — 1,120
    // of them across the plan (the beach ocean alone is hundreds), each running
    // its own animation tick every frame. That was the main cause of the city
    // feeling laggy, and it hit phones hardest. A TileSprite tiles the texture
    // in a single object, so we step its frame on one timer instead: ~1120
    // animated sprites -> 23 tile sprites + 23 timers, identical visual result.
    const tsBand = scene.add.tileSprite(b.x, b.y, b.w, b.h, key, 0)
      .setOrigin(0, 0).setDepth(b.depth ?? 0.95);
    const frameTotal = Math.max(1, scene.textures.get(key).frameTotal - 1);
    if (frameTotal > 1) {
      let _f = 0;
      const ev = scene.time.addEvent({
        delay: Math.max(60, Math.round(1000 / (b.fps || 5))),
        loop: true,
        callback: () => {
          _f = (_f + 1) % frameTotal;
          try { tsBand.setFrame(_f); } catch (_) { ev.remove(); }
        },
      });
    }
    // Shoreline: straddle the band's top edge with the sand->water foam tile so
    // the sea meets the beach with a shoreline, not a straight colour cut.
    if (b.shore === 'top' && scene.textures.exists('fwt_shore_top')) {
      scene.add.tileSprite(b.x, b.y - 8, b.w, 16, 'fwt_shore_top')
        .setOrigin(0, 0).setDepth((b.depth ?? 0.95) + 0.02);
    }
  });
  // patches + roads already painted in renderGround() (first pass).
  (plan.stamps || []).forEach((s) => {
    const key = planKey(s.img);
    if (!scene.textures.exists(key)) return;
    const img = scene.add.image(s.x, s.y, key);
    if (s.origin === 'tl') img.setOrigin(0, 0);
    else if (s.origin === 'bc') img.setOrigin(0.5, 1);
    else img.setOrigin(0, 1); // bl default: baseline placement
    if (s.scale) img.setScale(s.scale);
    img.setDepth(s.depth ?? (s.origin === 'tl' ? s.y + img.displayHeight : s.y));
    if (s.solid === true) {
      const baseY = s.origin === 'tl' ? s.y + img.displayHeight : s.y;
      const leftX = s.origin === 'bc' ? s.x - img.displayWidth / 2 : s.x;
      state.solids.push({ x: leftX, y: baseY - 24, w: img.displayWidth, h: 24 });
    } else if (s.solid) {
      state.solids.push({ x: s.x + (s.solid.dx || 0), y: s.y + (s.solid.dy || 0), w: s.solid.w, h: s.solid.h });
    }
    if (s.interact) registerInteractable(s, img);
  });
  (plan.anims || []).forEach((a, i) => {
    const key = planKey(a.sheet);
    if (!scene.textures.exists(key)) return;
    const animKey = `cpa_${i}_${key}`;
    if (!scene.anims.exists(animKey)) {
      const tex = scene.textures.get(key);
      const total = Math.max(1, tex.frameTotal - 1);
      const end = Math.min((a.frames || total) - 1, total - 1);
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNumbers(key, { start: 0, end }),
        frameRate: a.fps || 6, repeat: -1,
      });
    }
    const sp = scene.add.sprite(a.x, a.y, key, 0);
    if (a.origin === 'tl') sp.setOrigin(0, 0); else sp.setOrigin(0.5, 1);
    sp.setDepth(a.depth ?? a.y);
    sp.play(animKey);
  });
  (plan.solids || []).forEach((r) => state.solids.push(r));
  (plan.labels || []).forEach((l) => zoneLabel(scene, l.x, l.y, l.text));
  // Plan-declared ambient NPCs: {char: 1-20, name, x, y, r}
  (plan.npcs || []).forEach((n) => {
    if (scene.textures.exists(`fw_char_${n.char}`)) spawnNpc(scene, n);
  });
  // Driving vehicles — directional single images (Car_Right/Left/Up/Down):
  // {img, dir:'r'|'l'|'u'|'d', axis:'x'|'y', lane, from, to, speed, phase}.
  // The sprite's art already faces `dir`, so NO flip and NO reversal — it drives
  // `from`->`to` along `axis` (the other coord fixed at `lane`) and wraps back
  // to `from` off-screen. `phase` staggers multiple cars into a traffic stream.
  (plan.vehicles || []).forEach((v) => {
    if (v.img) {
      const key = planKey(v.img);
      if (!scene.textures.exists(key)) return;
      const axis = v.axis || 'x';
      const start = axis === 'x' ? [v.from, v.lane] : [v.lane, v.from];
      const sp = scene.add.image(start[0], start[1], key).setOrigin(0.5, 1);
      state.vehicles.push({ sp, kind: 'lane', axis, lane: v.lane,
        from: v.from, to: v.to, speed: v.speed || 80, t: v.phase || 0 });
      return;
    }
    // Legacy sheet-based car (kept for compatibility).
    const key = planKey(v.sheet);
    if (!scene.textures.exists(key)) return;
    const animKey = `cpv_${key}`;
    if (!scene.anims.exists(animKey)) {
      const tex = scene.textures.get(key);
      const total = Math.max(1, tex.frameTotal - 1);
      scene.anims.create({ key: animKey,
        frames: scene.anims.generateFrameNumbers(key, { start: 0, end: total - 1 }),
        frameRate: v.fps || 8, repeat: -1 });
    }
    const sp = scene.add.sprite(v.path[0][0], v.path[0][1], key, 0).setOrigin(0.5, 1);
    sp.play(animKey);
    state.vehicles.push({ sp, kind: 'path', path: v.path, speed: v.speed || 70,
      seg: 0, t: 0, face: v.face || 'left', oneway: v.oneway !== false });
  });
  (plan.portals || []).forEach((p) => {
    const portal = { x0: p.x0, x1: p.x1, y: p.y, href: p.href, teleport: p.teleport || null, open: false, sprite: null };
    if (p.doorSheet && scene.textures.exists(planKey(p.doorSheet))) {
      const key = planKey(p.doorSheet);
      const openKey = `cpd_open_${key}`;
      const closeKey = `cpd_close_${key}`;
      const tex = scene.textures.get(key);
      const last = Math.max(1, tex.frameTotal - 1) - 1;
      const end = Math.min(p.openEnd ?? 7, last);
      if (!scene.anims.exists(openKey)) {
        scene.anims.create({ key: openKey, frames: scene.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: 18, repeat: 0 });
        scene.anims.create({ key: closeKey, frames: scene.anims.generateFrameNumbers(key, { start: end, end: 0 }), frameRate: 18, repeat: 0 });
      }
      scene.add.rectangle(p.doorX, p.doorY - (p.dh || 36) / 2 - 2, (p.dw || 32), (p.dh || 36) + 2, 0x131521, 1).setDepth(p.y + 1);
      const sp = scene.add.sprite(p.doorX, p.doorY, key, 0).setOrigin(0.5, 1);
      if (p.dw && p.dh) sp.setDisplaySize(p.dw, p.dh);
      sp.setDepth(p.y + 2);
      portal.sprite = sp;
      portal.openKey = openKey;
      portal.closeKey = closeKey;
    }
    state.portals.push(portal);
  });
  indexInteractables();
  console.log('[FullWorld] city plan placed:', (plan.stamps || []).length, 'stamps,',
    (plan.anims || []).length, 'anims,', (plan.portals || []).length, 'portals,',
    state.interactables.length, 'interactables');
  // Everything the city will ever draw now exists — safe to bucket it.
  installChunkCulling(scene);
}

// ── Stamp interactions ──────────────────────────────────────────────────────
// The exterior compiler's life pass tags stamps with an `interact` verb —
// sit | read | shop | play | enter (docs/EXTERIOR-COMPILER.md, pass H). The
// verb survives the me→img resolve in scripts/merge-city-plan.py, so by the
// time a stamp reaches the renderer it carries both its art and its behaviour.
// Every tagged stamp lands in state.interactables; the tick loop offers the
// nearest one in range and E (or a tap on the object) runs it.

const INTERACT_RANGE = 48;
const INTERACT_CELL = 128;
const INTERACT_PROMPT = {
  sit: 'Sit',
  read: 'Read',
  shop: 'Shop',
  play: 'Play',
  enter: 'Enter',
};

/** Collect one placed stamp's footprint + verb. `img` is the placed image. */
function registerInteractable(s, img) {
  const w = img.displayWidth;
  const h = img.displayHeight;
  const left = s.origin === 'bc' ? s.x - w / 2 : s.x;
  const top = s.origin === 'tl' ? s.y : s.y - h;
  state.interactables.push({
    x: left, y: top, w, h,
    cx: left + w / 2,
    baseY: top + h,
    interact: s.interact,
    me: s.me || null,
    img: s.img,
    anchor: s.origin || 'bl',
    href: s.href || null,
    teleport: s.teleport || null,
    sp: img,
  });
}

function indexInteractables() {
  const grid = new Map();
  state.interactables.forEach((it) => {
    const k = `${Math.floor(it.cx / INTERACT_CELL)},${Math.floor(it.baseY / INTERACT_CELL)}`;
    let cell = grid.get(k);
    if (!cell) { cell = []; grid.set(k, cell); }
    cell.push(it);
  });
  state._interactGrid = grid;
}

/** Distance from a point to an interactable's footprint (0 when inside). */
function rectDist(it, x, y) {
  const dx = Math.max(it.x - x, 0, x - (it.x + it.w));
  const dy = Math.max(it.y - y, 0, y - (it.y + it.h));
  return Math.hypot(dx, dy);
}

// Grid lookup rather than a scan: the plan already places 1,266 stamps and the
// city is checked every frame.
function nearestInteractable(x, y, range = INTERACT_RANGE) {
  const grid = state._interactGrid;
  if (!grid) return null;
  const cx = Math.floor(x / INTERACT_CELL);
  const cy = Math.floor(y / INTERACT_CELL);
  let best = null;
  let bestD = range;
  for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      const cell = grid.get(`${gx},${gy}`);
      if (!cell) continue;
      for (const it of cell) {
        const d = rectDist(it, x, y);
        if (d <= bestD) { bestD = d; best = it; }
      }
    }
  }
  return best;
}

/** "me.pool.sunbed_blue_side" → "Sunbed Blue Side" (falls back to the file). */
function stampName(it) {
  const raw = it.me
    ? it.me.split('.').pop()
    : (it.img || '').split('/').pop().replace(/\.png$/i, '');
  return (raw || 'object')
    .replace(/\d+x\d+/gi, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The district sign nearest a stamp — what a "read" sign post actually says. */
function nearestLabelText(it, range = 240) {
  let best = null;
  let bestD = range;
  (state.planLabels || []).forEach((l) => {
    const d = Math.hypot(l.x - it.cx, l.y - it.baseY);
    if (d <= bestD) { bestD = d; best = l; }
  });
  return best ? best.text : null;
}

// HUD text lives in the camera's scroll-free space, which Phaser still scales
// by the camera zoom around its centre — so screen pixels must be converted.
function hudPoint(cam, sx, sy) {
  const z = cam.zoom || 1;
  return {
    x: cam.centerX + (sx - cam.centerX) / z,
    y: cam.centerY + (sy - cam.centerY) / z,
  };
}

function hudText(scene, key, style) {
  if (state[key]) return state[key];
  const t = scene.add.text(0, 0, '', {
    fontFamily: 'monospace', fontSize: '10px', color: '#f8fafc',
    backgroundColor: '#0f172ae6', padding: { x: 6, y: 3 },
    align: 'center', ...style,
  }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9500).setVisible(false);
  t.setResolution(2);
  state[key] = t;
  return t;
}

/** Bottom-centre one-liner: the "press E to …" offer, or its result. */
function showPrompt(scene, text) {
  const t = hudText(scene, 'interactPrompt');
  if (t.text !== text) t.setText(text);
  const cam = scene.cameras.main;
  // Clear of the bottom dock and the phone's touch controls.
  const at = hudPoint(cam, cam.centerX, cam.height - 100);
  t.setPosition(at.x, at.y);
  t.setVisible(true);
}

function hidePrompt() {
  if (state.interactPrompt) state.interactPrompt.setVisible(false);
}

function showHint(scene, text, ttl = 2600) {
  const t = hudText(scene, 'interactHint', { color: '#bbf7d0' });
  t.setText(text);
  const cam = scene.cameras.main;
  const at = hudPoint(cam, cam.centerX, cam.height - 128);
  t.setPosition(at.x, at.y);
  t.setVisible(true);
  state._hintUntil = ttl > 0 ? scene.time.now + ttl : Infinity;
}

function hideHint() {
  if (state.interactHint) state.interactHint.setVisible(false);
  state._hintUntil = 0;
}

/**
 * Centre-screen panel for the verbs that have something to say (read / shop).
 * Deliberately plain: a sign or a shop counter is a text surface until there's
 * a real shop system to hand off to.
 */
function showPanel(scene, title, body) {
  const cam = scene.cameras.main;
  if (!state.interactPanel) {
    const box = scene.add.rectangle(0, 0, 10, 10, 0x0f172a, 0.94)
      .setScrollFactor(0).setDepth(9600).setStrokeStyle(1, 0x64748b);
    const txt = scene.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#e2e8f0',
      align: 'center', lineSpacing: 4, wordWrap: { width: 200 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9601);
    txt.setResolution(2);
    state.interactPanel = { box, txt };
  }
  const { box, txt } = state.interactPanel;
  txt.setText(`${title}\n\n${body}\n\nE / ESC — close`);
  const at = hudPoint(cam, cam.centerX, cam.centerY);
  box.setPosition(at.x, at.y);
  box.setSize(txt.width + 24, txt.height + 24);
  txt.setPosition(at.x, at.y);
  box.setVisible(true);
  txt.setVisible(true);
  state.panelOpen = true;
}

function hidePanel() {
  if (!state.interactPanel) return;
  state.interactPanel.box.setVisible(false);
  state.interactPanel.txt.setVisible(false);
  state.panelOpen = false;
}

/** Other systems (quests, shops, telemetry) can listen instead of being wired. */
function emitInteract(verb, it) {
  try {
    window.dispatchEvent(new CustomEvent('denizen:city-interact', {
      detail: { verb, me: it.me, img: it.img, x: it.cx, y: it.baseY, name: stampName(it) },
    }));
  } catch (_) {}
}

function sitDown(scene, it) {
  const p = state.player;
  if (!p) return;
  // Seat point is the stamp's baseline, a couple of pixels south so the player
  // y-sorts in FRONT of the seat instead of disappearing behind it.
  const sx = it.cx;
  const sy = it.baseY + 2;
  state.seated = { it, from: { x: p.x, y: p.y } };
  if (!hitsSolid(sx, sy)) { p.x = sx; p.y = sy; }
  p.setDepth(p.y);
  state.moveTarget = null;
  state.playerDir = 'd';
  p.play(`${state.playerTex}_idle_d`, true);
  showHint(scene, `Sitting at the ${stampName(it).toLowerCase()} — move to get up`, 0);
}

function standUp() {
  if (!state.seated) return;
  const p = state.player;
  const from = state.seated.from;
  if (p && from && hitsSolid(p.x, p.y)) { p.x = from.x; p.y = from.y; }
  state.seated = null;
  hideHint();
}

/** A brief squash-and-stretch on the prop — "you had a go at it". */
function playWith(scene, it) {
  const sp = it.sp;
  if (sp && !sp._fwPlaying) {
    sp._fwPlaying = true;
    const sx = sp.scaleX;
    const sy = sp.scaleY;
    scene.tweens.add({
      targets: sp, scaleX: sx * 1.08, scaleY: sy * 0.92,
      duration: 130, yoyo: true, repeat: 2, ease: 'Sine.easeInOut',
      onComplete: () => { sp.setScale(sx, sy); sp._fwPlaying = false; },
    });
  }
  showHint(scene, `You have a go at the ${stampName(it).toLowerCase()}`);
}

/**
 * `enter` reuses the plan's portal flow when a door is declared for the stamp
 * (on the stamp itself, or the nearest plan portal to its base) — otherwise
 * there is nothing to walk into yet, so say so rather than teleport blind.
 */
function enterStamp(scene, it) {
  const target = it.teleport || nearestPortalTarget(it);
  if (target && target.teleport) {
    const p = state.player;
    p.x = target.teleport.x;
    p.y = target.teleport.y;
    state.moveTarget = null;
    showHint(scene, `Entered the ${stampName(it).toLowerCase()}`);
    return;
  }
  const href = it.href || (target && target.href);
  if (href && !state._enteringOffice) {
    state._enteringOffice = true;
    try { window.location.href = href; } catch (_) {}
    return;
  }
  console.info('[FullWorld] enter: no door wired for', it.me || it.img);
  showHint(scene, `${stampName(it)} — the door is locked`);
}

function nearestPortalTarget(it, range = 96) {
  let best = null;
  let bestD = range;
  (state.portals || []).forEach((pt) => {
    const d = Math.hypot((pt.x0 + pt.x1) / 2 - it.cx, pt.y - it.baseY);
    if (d <= bestD) { bestD = d; best = pt; }
  });
  return best;
}

function runInteract(scene, it) {
  if (!it) return;
  emitInteract(it.interact, it);
  switch (it.interact) {
    case 'sit':
      if (state.seated) standUp(); else sitDown(scene, it);
      break;
    case 'read':
      showPanel(scene, nearestLabelText(it) || stampName(it),
        `${stampName(it)}\nCity of Denizen — District notice board.`);
      break;
    case 'shop':
      console.info('[FullWorld] shop:', it.me || it.img);
      showPanel(scene, stampName(it).toUpperCase(),
        'The counter is open but unattended.\nNothing for sale yet.');
      break;
    case 'play':
      playWith(scene, it);
      break;
    case 'enter':
      enterStamp(scene, it);
      break;
    default:
      console.info('[FullWorld] unknown interact verb:', it.interact, it.me || it.img);
  }
}

function interactBlocked() {
  if (window.__DenizenGameInputBlocked) return true;
  try {
    if (document.documentElement.dataset.denizenModal === 'open') return true;
  } catch (_) {}
  return false;
}

// addKeys() registers a preventDefault capture, so E/Space would be eaten by
// the city while a chat or login field has focus — the office guards the same
// way (office-scene.js _typingInField).
function typingInField() {
  try {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  } catch (_) {
    return false;
  }
}

// One pass per frame: keep the offer in sync with where the player stands, and
// turn a fresh E press (or a tap on the object itself) into the verb's handler.
function updateInteractions(scene) {
  const p = state.player;
  if (!p) return;
  const k = state.keys || {};
  const typing = typingInField();
  // Mobile action button (src/mobile-controls.js) counts as an E press.
  const pressed = (!typing && !!(k.interact?.isDown || k.interact2?.isDown))
    || !!window.__DenizenTouchState?.interact;
  const fresh = pressed && !state._interactWasDown && !interactBlocked();
  state._interactWasDown = pressed;
  const escDown = !typing && !!k.esc?.isDown;
  const escaped = escDown && !state._escWasDown;
  state._escWasDown = escDown;

  if (state._hintUntil && scene.time.now > state._hintUntil) hideHint();

  const near = state.seated ? state.seated.it : nearestInteractable(p.x, p.y);
  state.nearInteract = near;

  if (state.panelOpen) {
    // An open sign / shop panel owns E and ESC, and closes if you walk off.
    if (fresh || escaped || !near) hidePanel();
    return;
  }
  if (escaped && state.seated) standUp();

  if (near) {
    const verb = INTERACT_PROMPT[near.interact] || 'Use';
    const action = state.seated ? 'Stand up' : `${verb} · ${stampName(near)}`;
    showPrompt(scene, `E — ${action}`);
  } else {
    hidePrompt();
  }

  if (fresh && near) runInteract(scene, near);

  // Tap straight onto an in-range object (phones have no E key).
  const tap = state.interactTap;
  state.interactTap = null;
  if (tap && !interactBlocked()) {
    const hit = nearestInteractable(tap.x, tap.y, 8);
    if (hit && rectDist(hit, p.x, p.y) <= INTERACT_RANGE) {
      state.moveTarget = null;
      runInteract(scene, hit);
    }
  }
}

// ── Zone builders ───────────────────────────────────────────────────────────

function zoneLabel(scene, x, y, text) {
  const t = scene.add.text(x, y, text, {
    fontFamily: 'monospace', fontSize: '10px', color: '#e2e8f0',
    backgroundColor: '#0f172acc', padding: { x: 5, y: 2 },
  }).setOrigin(0.5, 1).setDepth(6000);
  t.setResolution(2);
  // Collected rather than fitted here: the camera is configured after the zones
  // are built, so worldView is not meaningful yet.
  if (!state.zoneLabels) state.zoneLabels = [];
  state.zoneLabels.push(t);
  return t;
}

// A district sign sized for a desktop viewport runs off both edges of a phone.
// Scale each one down so it always fits the visible width. Re-run whenever the
// camera changes, so rotating a phone re-fits instead of leaving it clipped.
function fitZoneLabels(scene) {
  const labels = state.zoneLabels;
  if (!labels || !labels.length) return;
  const view = scene.cameras.main.worldView;
  const maxW = (view && view.width ? view.width : 640) * 0.9;
  labels.forEach((t) => {
    if (!t || !t.active) return;
    const natural = t.width / (t.scaleX || 1);
    t.setScale(natural > maxW && natural > 0 ? Math.max(0.45, maxW / natural) : 1);
  });
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

// Wrap each d16 shop-interior floor in a LimeZu room shell (floor + 3D walls)
// so a teleported shopper stands INSIDE a proper room, not on bare pavement.
// Coords/sizes mirror d16-interiors.json (5 sidewalk floor patches, 400x304 =
// 25x19 tiles at y5824). Themed floor/wall per shop. depthBase 2 keeps the
// shell above ground patches (0.9) but below the furniture stamps (y-depth),
// so the shop fixtures render inside the room. renderRoom adds no solids.
function encloseInteriors(scene, rtr) {
  if (!rtr) return;
  const ROOMS = [
    { x: 800,  floor: 'tile_white', wall: 'office_white' },  // LIME MART (grocery)
    { x: 1408, floor: 'wood_light', wall: 'warm_wood' },     // THREAD & NEEDLE (clothing)
    { x: 2000, floor: 'tile_teal',  wall: 'office_white' },  // SCOOPS ICE CREAM
    { x: 2592, floor: 'marble',     wall: 'office_grey' },   // CITY MUSEUM
    { x: 3200, floor: 'marble',     wall: 'warm_red' },      // GRAND HOTEL LOBBY
  ];
  ROOMS.forEach((r) => {
    try {
      rtr.renderRoom({ x: r.x, y: 5824, cols: 25, rows: 19,
        floor: r.floor, wall: r.wall, depthBase: 2, doors: [] });
    } catch (err) { console.error('[FullWorld] interior shell failed:', err); }
  });
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
  // Slim sheets keep only idle+run (2 rows). Full sheets used row1/row2, which
  // becomes row0/row1 after slimCharSheets().
  const slim = !!state._charsSlimmed;
  for (let c = 1; c <= 20; c++) {
    const tex = `fw_char_${c}`;
    if (!scene.textures.exists(tex)) continue;
    DIRS.forEach((d, di) => {
      const idleStart = slim ? (di * 6) : (CHAR_COLS + di * 6);
      const walkStart = slim ? (CHAR_COLS + di * 6) : (CHAR_COLS * 2 + di * 6);
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
  makeDoloAnims(scene);
}

// Dolo avatar anims (assets/Dolo.png, 24 cols x 1 row, 32x64). Frame map is
// IDENTICAL to the office's registerDoloAnims so the player looks the same
// inside and outside: RIGHT 0-5, UP 6-11, LEFT 12-17, DOWN 18-23; idle = a
// mid frame of each run so the standing pose is neutral.
function makeDoloAnims(scene) {
  const tex = 'fw_dolo';
  if (!scene.textures.exists(tex)) return;
  const map = {
    r: { walk: [0, 1, 2, 3, 4, 5], idle: 2 },
    u: { walk: [6, 7, 8, 9, 10, 11], idle: 8 },
    l: { walk: [12, 13, 14, 15, 16, 17], idle: 14 },
    // idle 22, not 20 — measured against the canonical down idle (dolonia.png
    // f74): 20 is 208px off (mid-stride), 22 is 61px. Down is the default facing.
    d: { walk: [18, 19, 20, 21, 22, 23], idle: 22 },
  };
  Object.entries(map).forEach(([d, m]) => {
    if (!scene.anims.exists(`${tex}_walk_${d}`)) {
      scene.anims.create({
        key: `${tex}_walk_${d}`,
        frames: scene.anims.generateFrameNumbers(tex, { frames: m.walk }),
        frameRate: 12, repeat: -1,
      });
    }
    if (!scene.anims.exists(`${tex}_idle_${d}`)) {
      scene.anims.create({
        key: `${tex}_idle_${d}`,
        frames: scene.anims.generateFrameNumbers(tex, { frames: [m.idle] }),
        frameRate: 1, repeat: -1,
      });
    }
  });
}

function spawnPlayer(scene, x, y) {
  // Use the real Dolo avatar (same as the office) if it loaded, else fall back
  // to a generic world character. Dolo is 32x64; world folk are 16x32, so
  // scale 0.5 keeps proportions consistent with the NPCs.
  const useDolo = scene.textures.exists('fw_dolo');
  state.playerTex = useDolo ? 'fw_dolo' : 'fw_char_1';
  const sp = scene.add.sprite(x, y, state.playerTex).setOrigin(0.5, 1);
  if (useDolo) sp.setScale(0.5);
  sp.play(`${state.playerTex}_idle_d`);
  sp.setDepth(y);
  state.player = sp;
  state.playerDir = 'd';
  state.keys = scene.input.keyboard.addKeys({
    up: 'W', down: 'S', left: 'A', right: 'D',
    u2: 'UP', d2: 'DOWN', l2: 'LEFT', r2: 'RIGHT',
    interact: 'E', interact2: 'SPACE', esc: 'ESC',
  });
  // addKeys() installs a preventDefault capture for each key, which fires on the
  // global keydown BEFORE a focused chat/login field sees the character — the
  // office clears the same captures for exactly this reason. The page body is
  // fixed/overflow:hidden, so releasing Space cannot scroll anything.
  try { scene.input.keyboard.removeCapture('E,SPACE,ESC'); } catch (_) {}
  installTapToMove(scene);
}

// The city hardcoded setZoom(2) and never looked at the device, while the
// office has had a full phone/tablet/desktop profile all along. On a phone that
// meant a fixed zoom tuned for a monitor. Reuse the office's own profile so the
// two halves of the game frame the world the same way.
function applyCityCamera(scene) {
  const cam = scene.cameras.main;
  if (!cam) return;
  const dp = globalThis.DenizenDeviceProfile;
  let zoom = 2;
  try {
    const profile = dp?.get?.();
    if (profile && dp?.playfieldZoomFor) zoom = dp.playfieldZoomFor(profile);
  } catch (_) {}
  cam.setZoom(zoom);
  try { cam.setRoundPixels(false); } catch (_) {}
  // worldView only reflects the new zoom after the camera updates its matrix.
  try { cam.preRender(); } catch (_) {}
  fitZoneLabels(scene);
}

// PERF: the city is ~7,300 game objects. Phaser walks the entire display list
// every frame, so off-screen stamps cost real time even though the GPU throws
// them away — measured 20fps standing still, 29fps with off-screen objects
// hidden. Bucket every static object into a grid once at build time, then flip
// whole buckets as the camera moves. Only objects that started visible are ever
// touched, and wide objects that straddle buckets opt out entirely.
const CULL_CHUNK = 512;

function installChunkCulling(scene) {
  if (state._cullInstalled) return;
  state._cullInstalled = true;
  const buckets = new Map();
  const always = [];
  // Buckets are keyed on the position an object had at INSTALL time, so
  // anything that moves must be excluded by identity. Testing `type` is not
  // enough: lane vehicles are Images (add.image at :708, only path vehicles are
  // Sprites), so a type check bucketed traffic at its spawn point and the cars
  // vanished for good the moment the camera left that chunk. NPC name labels
  // are Text and travel with their NPC for the same reason.
  const moving = new Set();
  (state.vehicles || []).forEach((v) => { if (v && v.sp) moving.add(v.sp); });
  (state.npcs || []).forEach((n) => {
    if (!n) return;
    if (n.sp) moving.add(n.sp);
    if (n.label) moving.add(n.label);
  });
  if (state.player) moving.add(state.player);
  for (const o of scene.children.list) {
    if (!o || o.visible === false) continue;
    // Movers, plus anything wider than a chunk (it would be hidden while still
    // on screen), opt out of culling entirely.
    if (moving.has(o) || o.type === 'Sprite'
      || (o.width || 0) > CULL_CHUNK || (o.height || 0) > CULL_CHUNK) {
      always.push(o);
      continue;
    }
    const k = `${Math.floor(o.x / CULL_CHUNK)},${Math.floor(o.y / CULL_CHUNK)}`;
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(o);
  }
  state._cullBuckets = buckets;
  state._cullActive = new Set();
  state._cullAlways = always.length;
  // Start from "everything hidden". updateChunkCulling is a delta updater: it
  // only hides buckets that LEAVE the active set, so with an empty active set
  // its first pass can only ever switch buckets on — every distant object
  // stayed visible and nothing was culled at all.
  for (const b of buckets.values()) {
    for (const o of b) o.visible = false;
  }
  updateChunkCulling(scene, true);
}

function updateChunkCulling(scene, force) {
  const buckets = state._cullBuckets;
  if (!buckets) return;
  const view = scene.cameras.main.worldView;
  // One chunk of slack so nothing pops in at the screen edge.
  const x0 = Math.floor((view.x - CULL_CHUNK) / CULL_CHUNK);
  const x1 = Math.floor((view.right + CULL_CHUNK) / CULL_CHUNK);
  const y0 = Math.floor((view.y - CULL_CHUNK) / CULL_CHUNK);
  const y1 = Math.floor((view.bottom + CULL_CHUNK) / CULL_CHUNK);
  const sig = `${x0},${x1},${y0},${y1}`;
  if (!force && sig === state._cullSig) return;
  state._cullSig = sig;

  const next = new Set();
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      const k = `${cx},${cy}`;
      if (buckets.has(k)) next.add(k);
    }
  }
  // Only touch buckets whose state actually changed.
  for (const k of state._cullActive) {
    if (!next.has(k)) for (const o of buckets.get(k)) o.visible = false;
  }
  for (const k of next) {
    if (!state._cullActive.has(k)) for (const o of buckets.get(k)) o.visible = true;
  }
  state._cullActive = next;
}

// Tap / click to walk. The city was keyboard-only (WASD + arrows), so on a
// phone you could not move AT ALL once you stepped outside the office — the
// office has _installTapToMove/_installDomTapToMove, the city had nothing.
function installTapToMove(scene) {
  if (state._tapMoveInstalled) return;
  state._tapMoveInstalled = true;
  // Fires on pointerUP, not down, and only when the finger barely travelled.
  // At pointerdown a tap and the first pixel of a joystick drag are identical,
  // so treating every press as a tap left a stale walk-to target fighting the
  // stick for control of the player.
  scene.input.on('pointerup', (pointer) => {
    // Respect the same input gate the office uses (chat/dialog open, etc.).
    if (window.__DenizenGameInputBlocked) return;
    if (document.documentElement.dataset.denizenModal === 'open') return;
    // Phaser mirrors WINDOW-level pointerup so that drags ending off-canvas
    // still resolve — which means a tap on the dock, chat or any panel button
    // also arrives here and sent the player walking. Only accept releases that
    // happened on the playfield itself.
    const domTarget = pointer.event && pointer.event.target;
    if (domTarget && typeof domTarget.closest === 'function'
      && !domTarget.closest('#game-container')) return;
    let travelled = 0;
    try { travelled = pointer.getDistance(); } catch (_) { travelled = 0; }
    if (travelled > 12) return;                     // that was a drag, not a tap
    const cam = scene.cameras.main;
    const wx = Number.isFinite(pointer.worldX) ? pointer.worldX : cam.scrollX + pointer.x / cam.zoom;
    const wy = Number.isFinite(pointer.worldY) ? pointer.worldY : cam.scrollY + pointer.y / cam.zoom;
    state.moveTarget = { x: wx, y: wy };
    // A tap that landed ON an interactable is a request to use it, not only to
    // walk there — updateInteractions decides once it knows the player's range.
    state.interactTap = { x: wx, y: wy };
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
  if (x < 8 || x > state.worldW - 8 || y < 40 || y > state.worldH - 4) return true;
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

  // Cheap: bails immediately unless the camera crossed a chunk boundary.
  updateChunkCulling(scene, false);

  // Player movement (WASD/arrows + the raw-key bootstrap fallback)
  const k = state.keys || {};
  const raw = window.__DenizenRawMoveKeys || {};
  let vx = 0, vy = 0;
  let speedScale = 1;
  if (k.left?.isDown || k.l2?.isDown || raw.left) vx -= 1;
  if (k.right?.isDown || k.r2?.isDown || raw.right) vx += 1;
  if (k.up?.isDown || k.u2?.isDown || raw.up) vy -= 1;
  if (k.down?.isDown || k.d2?.isDown || raw.down) vy += 1;

  // Invisible joystick. The city never read touch input at all, so on a phone
  // the only way to move was the tap target added alongside this. The stick is
  // analog, so a short pull walks and a full pull runs; it outranks a pending
  // tap target because it is the more deliberate gesture.
  const stick = window.__DenizenTouchState;
  if (!vx && !vy && stick && stick.active && stick.mag > 0) {
    vx = stick.vx;
    vy = stick.vy;
    speedScale = Math.min(1, stick.mag);
    state.moveTarget = null;
  }

  // Seated on an `interact:"sit"` stamp: any deliberate move gets you up again,
  // and until then the player stays parked on the seat.
  if (state.seated && (vx || vy || state.moveTarget)) standUp();
  if (state.seated) { vx = 0; vy = 0; state.moveTarget = null; }

  // Denizen HQ entrance: the glass door slides open on approach; walking
  // through the OPEN door returns to the office interior.
  const door = state.hqDoor;
  if (door) {
    const cx = (door.x0 + door.x1) / 2;
    const dist = Math.hypot(p.x - cx, p.y - (door.y - 4));
    const sp = state.hqDoorSprite;
    if (sp) {
      if (dist < 56 && !state.hqDoorOpen) {
        state.hqDoorOpen = true;
        sp.play('fw_door_opening');
      } else if (dist > 84 && state.hqDoorOpen) {
        state.hqDoorOpen = false;
        sp.play('fw_door_closing');
      }
    }
    const doorReady = !sp || state.hqDoorOpen;
    if (doorReady && !state._enteringOffice
        && p.x > door.x0 && p.x < door.x1 && p.y < door.y - 2 && p.y > door.y - 50) {
      state._enteringOffice = true;
      try { window.location.href = '/office?demo=1'; } catch (_) {}
    }
  }

  // City-plan portals: same approach-open/walk-in pattern, data-driven
  state.portals.forEach((pt) => {
    const cx = (pt.x0 + pt.x1) / 2;
    const dist = Math.hypot(p.x - cx, p.y - (pt.y - 4));
    if (pt.sprite) {
      if (dist < 56 && !pt.open) { pt.open = true; pt.sprite.play(pt.openKey); }
      else if (dist > 84 && pt.open) { pt.open = false; pt.sprite.play(pt.closeKey); }
    }
    const ready = !pt.sprite || pt.open;
    const inBand = p.x > pt.x0 && p.x < pt.x1 && p.y < pt.y - 2 && p.y > pt.y - 50;
    if (ready && inBand && pt.teleport) {
      // Same-world teleport (subway stairs): cooldown so the paired stair
      // doesn't instantly bounce the player back.
      const now = scene.time.now;
      if (!state._teleCooldown || now > state._teleCooldown) {
        state._teleCooldown = now + 1200;
        p.x = pt.teleport.x;
        p.y = pt.teleport.y;
      }
    } else if (ready && inBand && pt.href && !state._enteringOffice) {
      state._enteringOffice = true;
      try { window.location.href = pt.href; } catch (_) {}
    }
  });

  // Tap-to-move: walk toward the tapped point when no key is held. Any key
  // press cancels the target so keyboard always wins.
  if (vx || vy) {
    state.moveTarget = null;
  } else if (state.moveTarget) {
    const tdx = state.moveTarget.x - p.x;
    const tdy = state.moveTarget.y - p.y;
    const tdist = Math.hypot(tdx, tdy);
    if (tdist < 8) {
      state.moveTarget = null;
    } else {
      vx = tdx / tdist;
      vy = tdy / tdist;
    }
  }

  if (vx || vy) {
    const before = { x: p.x, y: p.y };
    // Normalise direction, then scale by the stick magnitude (1 for keys/taps).
    const inv = 1 / Math.hypot(vx, vy);
    const sp = PLAYER_SPEED * speedScale;
    const nx = p.x + vx * inv * sp * step;
    const ny = p.y + vy * inv * sp * step;
    // If already overlapping a solid (bad spawn, moved furniture), let the
    // player walk out instead of freezing forever.
    const stuck = hitsSolid(p.x, p.y);
    if (stuck || !hitsSolid(nx, p.y)) p.x = nx;
    if (stuck || !hitsSolid(p.x, ny)) p.y = ny;
    // A tap target behind a wall would otherwise make the player grind into it
    // forever — if we didn't actually move, drop the target.
    if (state.moveTarget
      && Math.abs(p.x - before.x) < 0.01 && Math.abs(p.y - before.y) < 0.01) {
      state.moveTarget = null;
    }
    const d = dirFrom(vx, vy);
    state.playerDir = d;
    const want = `${state.playerTex}_walk_${d}`;
    if (p.anims?.currentAnim?.key !== want) p.play(want);
  } else {
    const want = `${state.playerTex}_idle_${state.playerDir}`;
    if (p.anims?.currentAnim?.key !== want) p.play(want);
  }
  p.setDepth(p.y);

  // Stamp interactions (sit / read / shop / play / enter)
  updateInteractions(scene);

  // Driving vehicles
  state.vehicles.forEach((v) => {
    if (v.kind === 'lane') {
      // Directional single: drive from->to along axis; art already faces the
      // travel direction, so never flip. Wrap off-screen back to `from`.
      const span = v.to - v.from || 1;
      v.t += (v.speed * step) / Math.abs(span);
      if (v.t >= 1) v.t -= 1;                 // seamless wrap (fractional carry)
      const pos = v.from + span * v.t;
      if (v.axis === 'x') { v.sp.x = pos; v.sp.y = v.lane; }
      else { v.sp.x = v.lane; v.sp.y = pos; }
      v.sp.setDepth(v.sp.y);
      return;
    }
    // Legacy path/flip car.
    if (v.t >= 1) { v.t = 0; v.seg = v.oneway ? 0 : (v.seg + 1) % v.path.length; }
    const A = v.path[v.seg], B = v.path[(v.seg + 1) % v.path.length];
    const ddx = B[0] - A[0], ddy = B[1] - A[1];
    v.t += (v.speed * step) / (Math.hypot(ddx, ddy) || 1);
    v.sp.x = A[0] + ddx * v.t;
    v.sp.y = A[1] + ddy * v.t;
    if (v.face === 'down') { if (Math.abs(ddy) >= Math.abs(ddx)) v.sp.setFlipY(ddy < 0); }
    else if (Math.abs(ddx) >= Math.abs(ddy)) v.sp.setFlipX(ddx > 0);
    v.sp.setDepth(v.sp.y);
  });

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

if (typeof window !== 'undefined') {
  window.DenizenFullWorld = {
    buildFullWorld, state, textureBudget,
    // Interaction handles, so the city can be poked from the console/tests:
    // DenizenFullWorld.state.interactables, nearestInteractable(x,y), runInteract.
    runInteract, nearestInteractable, indexInteractables,
  };
}
