'use strict';

/**
 * Pixel grid cutter for Denizen sheets.
 *
 * Animation frames stay on the grid. The opaque bounding box is padding
 * inside that cell — trimming a walk cycle to it makes the sprite jitter.
 * A frame size that leaves a remainder, or that cuts through opaque pixels,
 * is refused. Direction rows come from the two sheets we actually ship:
 *   XP characters  32×48, rows down, left, right, up (4 frames).
 *   LimeZu         16×32, directions right, up, left, down.
 * Furniture and tiles have no facing. Draft PNGs go under data/sprite-cuts/
 * and never into the furniture catalog.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const XP_DIRECTIONS = Object.freeze(['down', 'left', 'right', 'up']);
const LIMEZU_DIRECTIONS = Object.freeze(['right', 'up', 'left', 'down']);
const LIMEZU_ANIMS = Object.freeze([
  'static', 'idle', 'run', 'sleep', 'sit_front', 'sit_side', 'smartphone', 'read',
  'push_cart', 'pick_up', 'gift', 'lift', 'throw', 'hit', 'punch', 'stab',
  'grab_gun', 'gun_idle', 'shoot', 'hurt',
]);

const ALPHA_MIN = 8;
const MAX_PIXELS = 8_000_000;
const SAVE_CAP = 256;

function knownLayouts(width, height) {
  const list = [];
  if (width === 128 && height === 192) {
    list.push({
      kind: 'xp_character', frameWidth: 32, frameHeight: 48, priority: 1,
      directions: [...XP_DIRECTIONS],
    });
  }
  if (width % 16 === 0 && height % 32 === 0 && height >= 32 && width >= 64) {
    const rows = height / 32;
    const cols = width / 16;
    const classic = width === 896 && rows >= 1 && rows <= 20;
    const strip = rows <= 20 && cols >= 24 && width > height;
    if (classic || strip) {
      list.push({
        kind: 'limezu_character', frameWidth: 16, frameHeight: 32, priority: classic ? 2 : 4,
        directions: [...LIMEZU_DIRECTIONS],
      });
    }
  }
  if (width % 32 === 0 && height % 32 === 0 && width >= 32 && height >= 32) {
    list.push({
      kind: 'furniture_32', frameWidth: 32, frameHeight: 32,
      priority: width === 896 ? 5 : 3,
    });
  }
  if (width % 48 === 0 && height % 48 === 0 && width >= 48 && height >= 48) {
    list.push({ kind: 'tileset_48', frameWidth: 48, frameHeight: 48, priority: 6 });
  }
  if (width % 16 === 0 && height % 16 === 0 && width >= 16 && height >= 16) {
    list.push({ kind: 'tileset_16', frameWidth: 16, frameHeight: 16, priority: 7 });
  }
  return list.sort((a, b) => a.priority - b.priority);
}

function kindForSize(width, height, fw, fh) {
  if (fw === 32 && fh === 48 && width === 128 && height === 192) return 'xp_character';
  if (fw === 16 && fh === 32 && width % 16 === 0 && height % 32 === 0) {
    const rows = height / 32;
    const cols = width / 16;
    if (width === 896 || (rows <= 20 && cols >= 4 && width >= 64)) return 'limezu_character';
  }
  if (fw === 32 && fh === 32) return 'furniture_32';
  if (fw === 16 && fh === 16) return 'tileset_16';
  if (fw === 48 && fh === 48) return 'tileset_48';
  if (fw === 32 && fh === 48 && width % 32 === 0 && height % 48 === 0 && width / 32 === 4 && height / 48 === 4) {
    return 'xp_character';
  }
  return 'custom';
}

function directionNote(kind) {
  if (kind === 'xp_character') {
    return 'XP character sheet. Rows top to bottom are down, left, right, up. Four frames per direction. Keep every frame on the 32×48 grid.';
  }
  if (kind === 'limezu_character') {
    return 'LimeZu character sheet. Directions run right, up, left, down. Row 0 is one static frame per direction. Later rows are 6 frames per direction, then prop cells. Run is the only locomotion cycle — there is no separate walk row.';
  }
  if (kind === 'furniture_32' || kind === 'tileset_16' || kind === 'tileset_48') {
    return 'This sheet has no facing rows. Each cell is one tile or object. Do not invent up/down/left/right.';
  }
  return 'Custom grid. No direction rows were recognized. Do not guess facing.';
}

function labelFrame(kind, col, row) {
  if (kind === 'xp_character') {
    return {
      direction: XP_DIRECTIONS[row] || null,
      anim: 'walk',
      frame: col,
    };
  }
  if (kind === 'limezu_character') {
    const anim = LIMEZU_ANIMS[row] || `row_${row}`;
    if (row === 0) {
      if (col < 4) return { direction: LIMEZU_DIRECTIONS[col], anim: 'static', frame: 0 };
      return { direction: null, anim: 'static_extra', frame: col };
    }
    const group = Math.floor(col / 6);
    if (group < 4) {
      return { direction: LIMEZU_DIRECTIONS[group], anim, frame: col % 6 };
    }
    return { direction: null, anim: `${anim}_prop`, frame: col };
  }
  const anim = kind === 'furniture_32' ? 'furniture' : (kind === 'custom' ? 'custom' : 'tile');
  return { direction: null, anim, frame: col };
}

function opaqueAt(data, width, x, y) {
  return data[(y * width + x) * 4 + 3] > ALPHA_MIN;
}

function contentBox(data, width, x0, y0, fw, fh) {
  let minX = fw;
  let minY = fh;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      if (!opaqueAt(data, width, x0 + x, y0 + y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    x: x0 + minX,
    y: y0 + minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    localX: minX,
    localY: minY,
  };
}

function findBleeds(data, width, height, fw, fh) {
  const bleeds = [];
  const cols = width / fw;
  const rows = height / fh;
  for (let c = 1; c < cols; c += 1) {
    const x = c * fw;
    let samples = 0;
    let y0 = -1;
    for (let y = 0; y < height; y += 1) {
      if (opaqueAt(data, width, x - 1, y) && opaqueAt(data, width, x, y)) {
        samples += 1;
        if (y0 < 0) y0 = y;
      }
    }
    if (samples) bleeds.push({ axis: 'x', at: x, samples, y: y0 });
  }
  for (let r = 1; r < rows; r += 1) {
    const y = r * fh;
    let samples = 0;
    let x0 = -1;
    for (let x = 0; x < width; x += 1) {
      if (opaqueAt(data, width, x, y - 1) && opaqueAt(data, width, x, y)) {
        samples += 1;
        if (x0 < 0) x0 = x;
      }
    }
    if (samples) bleeds.push({ axis: 'y', at: y, samples, x: x0 });
  }
  return bleeds;
}

function suggestions(width, height) {
  return knownLayouts(width, height).map((layout) => ({
    kind: layout.kind,
    frameWidth: layout.frameWidth,
    frameHeight: layout.frameHeight,
    directions: layout.directions || null,
  }));
}

function cutDimensions({ width, height, frameWidth, frameHeight, data }) {
  const sheetWidth = Math.floor(Number(width));
  const sheetHeight = Math.floor(Number(height));
  if (!(sheetWidth > 0 && sheetHeight > 0)) {
    return { ok: false, error: 'sheet width and height must be positive' };
  }
  if (sheetWidth * sheetHeight > MAX_PIXELS) {
    return { ok: false, error: 'sheet is too large to cut in one pass' };
  }
  const askedW = frameWidth == null || frameWidth === '' ? null : Math.floor(Number(frameWidth));
  const askedH = frameHeight == null || frameHeight === '' ? null : Math.floor(Number(frameHeight));
  if ((askedW == null) !== (askedH == null)) {
    return { ok: false, error: 'pass both frameWidth and frameHeight, or neither' };
  }
  let fw = askedW;
  let fh = askedH;
  let kind;
  if (fw == null) {
    const layout = knownLayouts(sheetWidth, sheetHeight)[0];
    if (!layout) {
      return {
        ok: false,
        error: 'sheet size does not match a known grid',
        sheetWidth,
        sheetHeight,
        hint: 'Pass frameWidth and frameHeight that divide the sheet with no leftover pixels.',
        suggestions: [],
      };
    }
    fw = layout.frameWidth;
    fh = layout.frameHeight;
    kind = layout.kind;
  } else {
    if (!(fw > 0 && fh > 0)) {
      return { ok: false, error: 'frame width and height must be positive' };
    }
    kind = kindForSize(sheetWidth, sheetHeight, fw, fh);
  }
  const remainderX = sheetWidth % fw;
  const remainderY = sheetHeight % fh;
  if (remainderX !== 0 || remainderY !== 0 || fw > sheetWidth || fh > sheetHeight) {
    return {
      ok: false,
      error: 'frame size does not divide the sheet',
      kind,
      sheetWidth,
      sheetHeight,
      frameWidth: fw,
      frameHeight: fh,
      remainderX,
      remainderY,
      hint: 'Refusing a partial last column. Pick a frame size that divides the sheet with no leftover pixels.',
      suggestions: suggestions(sheetWidth, sheetHeight),
    };
  }
  const cols = sheetWidth / fw;
  const rows = sheetHeight / fh;
  const hasPixels = data && data.length >= sheetWidth * sheetHeight * 4;
  if (hasPixels) {
    const bleeds = findBleeds(data, sheetWidth, sheetHeight, fw, fh);
    if (bleeds.length) {
      return {
        ok: false,
        error: 'frame size cuts through opaque pixels',
        kind,
        sheetWidth,
        sheetHeight,
        frameWidth: fw,
        frameHeight: fh,
        cols,
        rows,
        bleed: bleeds.slice(0, 8),
        hint: 'The frame size is wrong. A seam has opaque pixels on both sides, so the grid is splitting a sprite. For furniture, use the catalog rect from catalog_search instead of a blind grid. Animation frames stay on the full cell; the content box is only padding.',
        suggestions: suggestions(sheetWidth, sheetHeight).filter((s) => s.frameWidth !== fw || s.frameHeight !== fh),
      };
    }
  }
  const frames = [];
  let emptyCount = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const labeled = labelFrame(kind, col, row);
      const x = col * fw;
      const y = row * fh;
      const content = hasPixels ? contentBox(data, sheetWidth, x, y, fw, fh) : null;
      const empty = hasPixels ? content == null : false;
      if (empty) emptyCount += 1;
      frames.push({
        id: `${labeled.anim}_${labeled.direction || 'cell'}_${row}_${col}`,
        index: row * cols + col,
        col,
        row,
        direction: labeled.direction,
        anim: labeled.anim,
        frame: labeled.frame,
        x,
        y,
        w: fw,
        h: fh,
        content,
        empty,
      });
    }
  }
  const directionRows = kind === 'xp_character'
    ? [...XP_DIRECTIONS]
    : (kind === 'limezu_character' ? [...LIMEZU_DIRECTIONS] : null);
  return {
    ok: true,
    kind,
    sheetWidth,
    sheetHeight,
    frameWidth: fw,
    frameHeight: fh,
    cols,
    rows,
    frameCount: frames.length,
    emptyCount: hasPixels ? emptyCount : null,
    dividesExactly: true,
    bleedChecked: !!hasPixels,
    directionRows,
    directionNote: directionNote(kind),
    contentIsPaddingOnly: true,
    hint: 'Use the grid rect (x, y, w, h) for every animation frame. content is the opaque box inside that cell and is padding only — trimming a walk cycle to it makes the sprite jitter.',
    frames,
  };
}

function resolveInside(root, relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm || norm.split('/').includes('..')) {
    throw new Error('path must stay inside assets/ or data/');
  }
  if (!(norm.startsWith('assets/') || norm.startsWith('data/'))) {
    throw new Error('path must start with assets/ or data/');
  }
  const abs = path.resolve(root, norm);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('path must stay inside assets/ or data/');
  }
  return { abs, rel: norm };
}

function slugFor(rel) {
  const base = path.basename(rel, path.extname(rel));
  const slug = base.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '').slice(0, 48);
  return slug || 'sheet';
}

function writeGridFrame(src, frame, file) {
  const out = new PNG({ width: frame.w, height: frame.h });
  for (let y = 0; y < frame.h; y += 1) {
    for (let x = 0; x < frame.w; x += 1) {
      const si = ((frame.y + y) * src.width + (frame.x + x)) * 4;
      const di = (y * frame.w + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  fs.writeFileSync(file, PNG.sync.write(out));
}

function cutFile({ root, relPath, frameWidth, frameHeight, saveFrames }) {
  let resolved;
  try {
    resolved = resolveInside(root, relPath);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
  if (!resolved.rel.toLowerCase().endsWith('.png')) {
    return { ok: false, error: 'sprite_sheet_cut only opens PNG files' };
  }
  let buf;
  try {
    buf = fs.readFileSync(resolved.abs);
  } catch (err) {
    return { ok: false, error: `sheet not found: ${resolved.rel}` };
  }
  let png;
  try {
    png = PNG.sync.read(buf);
  } catch (err) {
    return { ok: false, error: `could not read PNG: ${err.message || err}` };
  }
  const cut = cutDimensions({
    width: png.width,
    height: png.height,
    frameWidth,
    frameHeight,
    data: png.data,
  });
  cut.path = resolved.rel;
  if (!cut.ok || !saveFrames) return cut;
  if (cut.frameCount > SAVE_CAP) {
    cut.saved = false;
    cut.saveSkipped = `Refusing to write ${cut.frameCount} frames (cap ${SAVE_CAP}). The grid is in frames. Cut a smaller sheet before saving PNGs.`;
    return cut;
  }
  const slug = slugFor(resolved.rel);
  const outDir = path.resolve(root, 'data', 'sprite-cuts', slug);
  const cutsRoot = path.resolve(root, 'data', 'sprite-cuts');
  if (outDir !== cutsRoot && !outDir.startsWith(cutsRoot + path.sep)) {
    return { ...cut, saved: false, saveSkipped: 'refusing to write outside data/sprite-cuts' };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const frame of cut.frames) {
    const name = `${String(frame.index).padStart(4, '0')}_${frame.anim}_${frame.direction || 'cell'}.png`;
    writeGridFrame(png, frame, path.join(outDir, name));
    written.push(name);
  }
  const manifest = {
    path: resolved.rel,
    kind: cut.kind,
    frameWidth: cut.frameWidth,
    frameHeight: cut.frameHeight,
    directionRows: cut.directionRows,
    directionNote: cut.directionNote,
    contentIsPaddingOnly: true,
    frames: cut.frames.map((frame) => ({
      file: written[frame.index],
      index: frame.index,
      direction: frame.direction,
      anim: frame.anim,
      frame: frame.frame,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      empty: frame.empty,
      content: frame.content,
    })),
  };
  fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(manifest, null, 2));
  cut.saved = true;
  cut.outDir = `data/sprite-cuts/${slug}`;
  cut.files = written.length;
  return cut;
}

function fillPng(png, r, g, b, a) {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  }
}

function officePicturePng({ nodes, people, worldW = 1280, worldH = 720 } = {}) {
  const scale = 8;
  const width = Math.round(worldW / scale);
  const height = Math.round(worldH / scale);
  const png = new PNG({ width, height });
  fillPng(png, 0x1c, 0x24, 0x30, 255);
  const colors = {
    station: [0x4a, 0xa3, 0xff],
    decor: [0x7d, 0xce, 0xa0],
    item: [0xf5, 0xc1, 0x6c],
    person: [0xff, 0x5a, 0x7a],
  };
  const plot = (x, y, rgb) => {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
    const px = Math.max(0, Math.min(width - 1, Math.floor(Number(x) / scale)));
    const py = Math.max(0, Math.min(height - 1, Math.floor(Number(y) / scale)));
    const i = (py * width + px) * 4;
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  };
  for (const node of nodes || []) plot(node.x, node.y, colors[node.kind] || colors.decor);
  for (const person of people || []) plot(person.x, person.y, colors.person);
  return PNG.sync.write(png);
}

function attachMcpImage(content, result) {
  if (!result?._mcp_image) return content;
  const data = result.image_base64 || result.screenshot_jpeg_base64;
  if (!data) return content;
  content.push({
    type: 'image',
    data,
    mimeType: result.mime || (result.image_base64 ? 'image/png' : 'image/jpeg'),
  });
  return content;
}

module.exports = {
  XP_DIRECTIONS,
  LIMEZU_DIRECTIONS,
  LIMEZU_ANIMS,
  knownLayouts,
  cutDimensions,
  cutFile,
  officePicturePng,
  attachMcpImage,
};
