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

/** Crop body sheet (often 272×448) to 256×448 centered content. */
async function loadBodySheet(bodyId) {
  const img = await loadImg(bodyPath(bodyId));
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  if (w === SHEET_W && h === SHEET_H) return img;
  // Content sits ~8px inset on 272-wide sheets
  const x0 = Math.max(0, Math.floor((w - SHEET_W) / 2));
  const y0 = Math.max(0, Math.floor((h - SHEET_H) / 2));
  return img.clone().crop(x0, y0, Math.min(SHEET_W, w - x0), Math.min(SHEET_H, h - y0))
    .contain(SHEET_W, SHEET_H);
}

/**
 * Extract a style tile: column = style index, row = anim row (clamped).
 * Sheets are catalogs of variants (50 cols × few rows).
 */
function extractTile(sheet, styleIndex, animRow, tileW = FRAME, tileH = FRAME) {
  const cols = Math.floor(sheet.bitmap.width / tileW);
  const rows = Math.floor(sheet.bitmap.height / tileH);
  if (cols < 1 || rows < 1) return null;
  const c = ((styleIndex % cols) + cols) % cols;
  const r = Math.max(0, Math.min(rows - 1, animRow));
  return sheet.clone().crop(c * tileW, r * tileH, tileW, tileH);
}

/**
 * Map full-body anim row (0-13) → accessory catalog row.
 * Catalogs only cover a subset of rows (walk/idle-ish).
 */
function mapAnimRow(bodyRow, catalogRows) {
  if (catalogRows <= 1) return 0;
  // Prefer early rows (walk/idle) for movement; clamp for sit/lie
  if (bodyRow < catalogRows) return bodyRow;
  return catalogRows - 1;
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

  const pantsIdx = avatar.pants?.index ?? 0;
  const outfitIdx = avatar.outfit?.index ?? 0;
  const faceIdx = avatar.face ?? 0;
  const eyesIdx = avatar.eyes ?? 0;
  const hairIdx = avatar.hair?.index ?? 0;
  const hatIdx = avatar.hat?.index ?? 0;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const dx = col * FRAME;
      const dy = row * FRAME;

      const stamp = (sheet, styleIndex, tintHex) => {
        if (!sheet) return;
        const catRows = Math.floor(sheet.bitmap.height / FRAME);
        const ar = mapAnimRow(row, catRows);
        let tile = extractTile(sheet, styleIndex, ar);
        if (!tile) return;
        if (tintHex) tile = applyTint(tile, tintHex);
        out.composite(tile, dx, dy);
      };

      stamp(pantsSheet, pantsIdx, avatar.tint?.clothes);
      stamp(outfitSheet, outfitIdx, avatar.tint?.clothes);
      // Faces/eyes only need a few rows (expression); reuse row 0-2
      if (faceSheet) {
        const fr = Math.min(row, Math.floor(faceSheet.bitmap.height / FRAME) - 1);
        const tile = extractTile(faceSheet, faceIdx, Math.max(0, fr));
        if (tile) out.composite(tile, dx, dy);
      }
      if (eyesSheet) {
        const er = Math.min(row, Math.floor(eyesSheet.bitmap.height / FRAME) - 1);
        const tile = extractTile(eyesSheet, eyesIdx, Math.max(0, er));
        if (tile) out.composite(tile, dx, dy);
      }
      stamp(hairSheet, hairIdx, avatar.tint?.hair);
      // Booster golden headsets use tint.hat (gold); other hats usually untinted
      stamp(hatSheet, hatIdx, avatar.tint?.hat || null);
    }
  }

  return out;
}

async function bakePremade(avatar) {
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
 */
async function ensureBaked(store, userId, avatar) {
  const av = store.set(userId, avatar, { bumpRev: true });
  const png = await bakeSheet(av);
  store.writePng(userId, png);
  try {
    const prev = await bakePreview(av, 4);
    store.writePreview(userId, prev);
  } catch (_) { /* preview optional */ }
  return av;
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
  applyTint,
};
