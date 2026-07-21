'use strict';

/**
 * Bake a 256×448 character spritesheet from premade NPC or layered Pixel Spaces parts.
 * Uses jimp (available via denizen/node_modules).
 */

const path = require('path');
const fs = require('fs');
const catalog = require('./catalog');

const FRAME = 32;
const COLS = 8;
const ROWS = 14;
const SHEET_W = COLS * FRAME; // 256
const SHEET_H = ROWS * FRAME; // 448

const ROOT = path.join(__dirname, '..', '..');
const PREMADE_DIR = path.join(ROOT, 'discord-map', 'PixelSpaces', 'NPCs');
const LAYERS = path.join(
  ROOT,
  'discord-map',
  'PixelSpacesFull',
  'Tilesets & SpriteSheets',
  'NPCs',
  'SpriteSheets',
);

function premadePath(premadeId) {
  const m = String(premadeId || '').match(/^npc_([mf])(\d+)$/i);
  if (!m) return null;
  const gender = m[1].toLowerCase() === 'f' ? 'Female' : 'Male';
  const n = m[2];
  const p = path.join(PREMADE_DIR, gender, `NPC ${n}.png`);
  return fs.existsSync(p) ? p : null;
}

function bodyPath(bodyId) {
  const file = path.join(LAYERS, 'Body', `${bodyId}.png`);
  return fs.existsSync(file) ? file : path.join(LAYERS, 'Body', 'light.png');
}

function layerFile(kind, fileName) {
  const map = {
    hair: path.join(LAYERS, 'Hairstyles', fileName),
    clothing: path.join(LAYERS, 'Clothing', fileName),
    face: path.join(LAYERS, 'Faces, Eyes & Masks', fileName),
    hat: path.join(LAYERS, 'Hats', fileName),
  };
  return map[kind] || null;
}

let _Jimp = null;
function jimp() {
  if (_Jimp) return _Jimp;
  // eslint-disable-next-line import/no-extraneous-dependencies
  _Jimp = require('jimp');
  return _Jimp;
}

async function loadImg(file) {
  return jimp().read(file);
}

/**
 * Multiply RGB by hex tint (alpha preserved).
 * @param {import('jimp')} img
 * @param {string|null} hex
 */
function applyTint(img, hex) {
  if (!hex) return img;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return img;
  const n = parseInt(m[1], 16);
  const tr = (n >> 16) & 255;
  const tg = (n >> 8) & 255;
  const tb = n & 255;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scan(x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a < 8) return;
    this.bitmap.data[idx] = Math.min(255, Math.round((this.bitmap.data[idx] * tr) / 255));
    this.bitmap.data[idx + 1] = Math.min(255, Math.round((this.bitmap.data[idx + 1] * tg) / 255));
    this.bitmap.data[idx + 2] = Math.min(255, Math.round((this.bitmap.data[idx + 2] * tb) / 255));
  });
  return img;
}

/** Crop body sheet (often 272×448) to the left 256×448 of real frames. */
async function loadBodySheet(bodyId) {
  const img = await loadImg(bodyPath(bodyId));
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  if (w === SHEET_W && h === SHEET_H) return img;
  // Body sheets are 272 wide = 8 real frames (256px) on a 0-based 32px grid,
  // plus a ~16px label/extra strip on the RIGHT. Crop the left 256 so body
  // frame columns line up with the same 0-based grid every per-frame accessory
  // layer (hair/outfit/headset) is stamped on. A CENTERED crop (x0=8) shifts
  // the whole body ~8px left of the accessories, which makes the booster
  // headset and hair float off to the side of the head — the "broken avatar".
  const x0 = 0;
  const y0 = Math.max(0, Math.floor((h - SHEET_H) / 2));
  return img.clone().crop(x0, y0, Math.min(SHEET_W, w - x0), Math.min(SHEET_H, h - y0))
    .contain(SHEET_W, SHEET_H);
}

/**
 * Address one variant cell in an accessory catalog sheet.
 *
 * Accessory sheets (Hats/, Hairstyles/, Clothing/, Faces…) are 2D VARIANT
 * CATALOGS — 50 columns × N rows of distinct styles/colors (hats.png rows are
 * different hats; hair rows are colors; outfit rows are different outfits),
 * usually plus a 16px label strip that floor() excludes. They are NOT
 * animation sheets. A style index picks one cell — col = idx % 50,
 * row = floor(idx / 50) — and that SAME cell must be stamped on every
 * animation frame; only the body sheet animates. Mapping pose-row → sheet-row
 * here is what made characters morph per pose ("won't stay one character").
 */
function catalogTile(sheet, styleIndex, tileW = FRAME, tileH = FRAME) {
  const cols = Math.floor(sheet.bitmap.width / tileW);
  const rows = Math.floor(sheet.bitmap.height / tileH);
  if (cols < 1 || rows < 1) return null;
  const i = Math.max(0, Math.floor(Number(styleIndex) || 0));
  const c = i % cols;
  const r = Math.min(rows - 1, Math.floor(i / cols));
  return sheet.clone().crop(c * tileW, r * tileH, tileW, tileH);
}

async function bakeLayers(avatar) {
  const Jimp = jimp();
  const out = await new Promise((resolve, reject) => {
    // jimp 0.x constructor
    // eslint-disable-next-line no-new
    new Jimp(SHEET_W, SHEET_H, 0x00000000, (err, image) => {
      if (err) reject(err);
      else resolve(image);
    });
  });

  const body = await loadBodySheet(avatar.body || 'light');
  out.composite(body, 0, 0);

  // Optional layer sheets
  let pantsSheet = null;
  let outfitSheet = null;
  let faceSheet = null;
  let eyesSheet = null;
  let hairSheet = null;
  let hatSheet = null;

  try {
    pantsSheet = await loadImg(layerFile('clothing', 'pants.png'));
  } catch (_) { /* optional */ }

  const outfitMeta = catalog.OUTFIT_SETS.find((o) => o.id === avatar.outfit?.set) || catalog.OUTFIT_SETS[0];
  try {
    outfitSheet = await loadImg(layerFile('clothing', outfitMeta.file));
  } catch (_) { /* optional */ }

  try {
    faceSheet = await loadImg(layerFile('face', 'faces.png'));
  } catch (_) { /* optional */ }
  try {
    eyesSheet = await loadImg(layerFile('face', 'eyes.png'));
  } catch (_) { /* optional */ }

  const hairMeta = catalog.HAIR_SETS.find((h) => h.id === avatar.hair?.set);
  if (hairMeta?.file) {
    try {
      hairSheet = await loadImg(layerFile('hair', hairMeta.file));
    } catch (_) { /* optional */ }
  }

  const hatMeta = catalog.HAT_SETS.find((h) => h.id === avatar.hat?.set);
  if (hatMeta?.file) {
    try {
      hatSheet = await loadImg(layerFile('hat', hatMeta.file));
    } catch (_) { /* optional */ }
  }

  // Resolve each accessory to ONE fixed catalog cell (see catalogTile), tint
  // once, then stamp that same tile on every animation frame. Only the body
  // sheet animates — this is what keeps a customized character looking like
  // the same character in every pose.
  const overlays = [];
  const addOverlay = (sheet, styleIndex, tintHex) => {
    if (!sheet) return;
    let tile = catalogTile(sheet, styleIndex);
    if (!tile) return;
    if (tintHex) tile = applyTint(tile, tintHex);
    overlays.push(tile);
  };
  // Layer order per LimeZu's official CHARACTER_GENERATOR.txt:
  // BODY → EYES → OUTFIT → HAIRSTYLE → ACCESSORY. Eyes/face go UNDER the
  // outfit so high collars and hoods correctly cover the chin/neck pixels.
  addOverlay(faceSheet, avatar.face ?? 0, null);
  addOverlay(eyesSheet, avatar.eyes ?? 0, null);
  addOverlay(pantsSheet, avatar.pants?.index ?? 0, avatar.tint?.clothes);
  addOverlay(outfitSheet, avatar.outfit?.index ?? 0, avatar.tint?.clothes);
  addOverlay(hairSheet, avatar.hair?.index ?? 0, avatar.tint?.hair);
  // Booster golden headsets use tint.hat (gold); other hats usually untinted
  addOverlay(hatSheet, avatar.hat?.index ?? 0, avatar.tint?.hat || null);

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const tile of overlays) {
        out.composite(tile.clone(), col * FRAME, row * FRAME);
      }
    }
  }

  return out;
}

/**
 * Composite a hat/headset layer onto an already-baked full sheet, per frame.
 * Shared by the premade path so booster headsets can sit on a clean premade
 * character (the layered body/hair/outfit path morphs per pose — see
 * loadBodySheet/catalogTile notes — so premades must stay premade and only
 * gain the hat overlay).
 */
async function compositeHat(out, avatar) {
  const hatMeta = catalog.HAT_SETS.find((h) => h.id === avatar.hat?.set);
  if (!hatMeta?.file) return out;
  let hatSheet = null;
  try {
    hatSheet = await loadImg(layerFile('hat', hatMeta.file));
  } catch (_) { return out; }
  if (!hatSheet) return out;
  const hatIdx = avatar.hat?.index ?? 0;
  const tintHex = avatar.tint?.hat || null;
  // One fixed variant cell stamped on every frame — see catalogTile.
  let tile = catalogTile(hatSheet, hatIdx);
  if (!tile) return out;
  if (tintHex) tile = applyTint(tile, tintHex);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      out.composite(tile.clone(), col * FRAME, row * FRAME);
    }
  }
  return out;
}

/**
 * Expand a 5×3 MOVE/IDLE/JUMP sheet (Halloween/hospital packs) into the
 * standard 8×14 premade grid. Poses beyond walk/idle/jump reuse the idle
 * frames — a floating ghost hovers instead of sitting/lying, which is right.
 */
async function bakeHospSheet(relFile) {
  const Jimp = jimp();
  const src = await loadImg(path.join(ROOT, 'discord-map', relFile));
  const out = await new Promise((resolve, reject) => {
    // eslint-disable-next-line no-new
    new Jimp(SHEET_W, SHEET_H, 0x00000000, (err, image) => {
      if (err) reject(err);
      else resolve(image);
    });
  });
  const SRC_FRAMES = [4, 3, 2]; // MOVE, IDLE, JUMP real frame counts
  for (let row = 0; row < ROWS; row += 1) {
    const srcRow = row === 0 ? 0 : (row === 2 ? 2 : 1);
    const frames = SRC_FRAMES[srcRow];
    for (let col = 0; col < COLS; col += 1) {
      const srcCol = col % frames;
      const sy = srcRow * FRAME;
      if (sy + FRAME > src.bitmap.height) continue;
      const tile = src.clone().crop(srcCol * FRAME, sy, FRAME, FRAME);
      out.composite(tile, col * FRAME, row * FRAME);
    }
  }
  return out;
}

async function bakePremade(avatar) {
  // Special premades (ghost/skeleton) render a dedicated sheet as the whole
  // character — consistent across poses, no hair/outfit layers.
  const special = catalog.PREMADES.find((p) => p.id === avatar.premade && p.special);
  if (special?.special === 'hosp' && special.file) {
    const img = await bakeHospSheet(special.file);
    if (avatar.tint?.clothes) applyTint(img, avatar.tint.clothes);
    await compositeHat(img, avatar);
    return img;
  }
  if (special?.special === 'body') {
    const img = await loadBodySheet(special.body);
    if (avatar.tint?.clothes) applyTint(img, avatar.tint.clothes);
    await compositeHat(img, avatar);
    return img;
  }

  const p = premadePath(avatar.premade);
  if (!p) {
    // fall back to layers
    return bakeLayers({ ...avatar, mode: 'layers' });
  }
  let img = await loadImg(p);
  if (img.bitmap.width !== SHEET_W || img.bitmap.height !== SHEET_H) {
    img = img.contain(SHEET_W, SHEET_H);
  }
  // Optional full-sheet clothes tint for premades
  if (avatar.tint?.clothes) applyTint(img, avatar.tint.clothes);
  // Hat/headset overlay (e.g. booster golden headset) on the clean premade.
  await compositeHat(img, avatar);
  return img;
}

/**
 * @param {object} avatar
 * @returns {Promise<Buffer>} PNG buffer of full spritesheet
 */
async function bakeSheet(avatar) {
  const av = catalog.normalizeAvatar(avatar);
  const img = av.mode === 'layers' ? await bakeLayers(av) : await bakePremade(av);
  return img.getBufferAsync(jimp().MIME_PNG);
}

/**
 * Single idle frame (row 1, col 0) for Discord preview embeds.
 * @param {object} avatar
 * @param {number} [scale]
 */
async function bakePreview(avatar, scale = 4) {
  const sheetBuf = await bakeSheet(avatar);
  const img = await jimp().read(sheetBuf);
  // Idle row is typically row 1 in Pixel Spaces sheets
  const idleRow = 1;
  const frame = img.clone().crop(0, idleRow * FRAME, FRAME, FRAME);
  if (scale > 1) {
    frame.resize(FRAME * scale, FRAME * scale, jimp().RESIZE_NEAREST_NEIGHBOR);
  }
  return frame.getBufferAsync(jimp().MIME_PNG);
}

/**
 * Ensure store has baked PNG for user; returns avatar + whether baked.
 *
 * Order matters: bake FIRST, then write the PNG, then persist the JSON with
 * its bumped rev. Persisting JSON before a bake that can throw left a broken
 * on-disk state (rev advertised with a stale/missing PNG), and bumping rev
 * before writing the PNG let a presence tick advertise ?v=<new rev> while the
 * old PNG was still being served.
 */
async function ensureBaked(store, userId, avatar) {
  const candidate = catalog.normalizeAvatar(avatar, userId);
  const png = await bakeSheet(candidate);
  store.writePng(userId, png);
  const av = store.set(userId, candidate, { bumpRev: true });
  try {
    const prev = await bakePreview(av, 4);
    store.writePreview(userId, prev);
  } catch (_) { /* preview optional */ }
  return av;
}

// ---- On-demand PNG bake: single-flight per user + small global cap ----
const _bakeInflight = new Map();
const _bakeWaiters = [];
let _bakeActive = 0;
const BAKE_MAX_CONCURRENT = 2;

async function _withBakeSlot(fn) {
  while (_bakeActive >= BAKE_MAX_CONCURRENT) {
    await new Promise((resolve) => { _bakeWaiters.push(resolve); });
  }
  _bakeActive += 1;
  try {
    return await fn();
  } finally {
    _bakeActive -= 1;
    const next = _bakeWaiters.shift();
    if (next) next();
  }
}

/**
 * Serve-or-bake the full sheet PNG for a user. Returns null when the user has
 * no saved look (callers 404). Concurrent requests for the same user share
 * one bake (single-flight), and at most BAKE_MAX_CONCURRENT bakes run at a
 * time, so a burst of cold requests after a cache clear can't pin the
 * single-process server's CPU and starve the map for everyone.
 */
async function ensurePngOnDemand(store, userId) {
  const existing = store.readPng(userId);
  if (existing) return existing;
  if (!store.hasCustom(userId)) return null;
  const inflight = _bakeInflight.get(userId);
  if (inflight) return inflight;
  const p = _withBakeSlot(async () => {
    const again = store.readPng(userId);
    if (again) return again;
    const buf = await bakeSheet(store.get(userId));
    try { store.writePng(userId, buf); } catch (_) { /* serve anyway */ }
    return buf;
  }).finally(() => { _bakeInflight.delete(userId); });
  _bakeInflight.set(userId, p);
  return p;
}

module.exports = {
  FRAME,
  COLS,
  ROWS,
  SHEET_W,
  SHEET_H,
  premadePath,
  bakeSheet,
  bakePreview,
  ensureBaked,
  ensurePngOnDemand,
  applyTint,
};
