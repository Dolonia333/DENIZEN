#!/usr/bin/env node
/**
 * Bake themed NPC character sheets (witch / mummy / vampire) from Pixel
 * Spaces avatar layers into discord-map/baked/ — full 256×448 premade-grid
 * sheets the map loads like any other character.
 *
 *   node scripts/gen-themed-npcs.mjs            # bake the final looks
 *   node scripts/gen-themed-npcs.mjs --preview  # also write idle-frame contact sheet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bake = require(path.join(ROOT, 'src/discord-avatar/bake.js'));
const OUT = path.join(ROOT, 'discord-map', 'baked');

// Layer indices: hair rows are colors (50/row: 0 red, 50 gold, 100 green,
// 150 blue, 200 purple, 250 black); hats row 2 (idx 100) = witch hat.
const LOOKS = {
  npc_witch: {
    mode: 'layers', body: 'light',
    hair: { set: 'long', index: 250 },
    outfit: { set: 'outfits', index: 200 },
    pants: { index: 250 },
    hat: { set: 'hats', index: 100 },
    tint: { clothes: null, hair: null, hat: null },
  },
  npc_mummy: {
    mode: 'layers', body: 'white',
    hair: { set: 'none' },
    outfit: { set: 'shirt', index: 300 },
    pants: { index: 300 },
    hat: { set: 'none' },
  },
  npc_vampire: {
    mode: 'layers', body: 'white',
    hair: { set: 'short', index: 250 },
    outfit: { set: 'outfits', index: 150 },
    pants: { index: 250 },
    hat: { set: 'none' },
  },
};

fs.mkdirSync(OUT, { recursive: true });
const preview = process.argv.includes('--preview');
const Jimp = require(path.join(ROOT, 'node_modules', 'jimp'));

const frames = [];
for (const [name, look] of Object.entries(LOOKS)) {
  const buf = await bake.bakeSheet(look);
  fs.writeFileSync(path.join(OUT, `${name}.png`), buf);
  console.log('baked', name, `${buf.length >> 10}KB`);
  if (preview) {
    const img = await Jimp.read(buf);
    frames.push([name, img.clone().crop(0, 32, 32, 32)]);
  }
}
if (preview) {
  const s = 6;
  const cv = new Jimp(32 * s * frames.length, 32 * s + 16, 0xff333344 >>> 0);
  frames.forEach(([, f], i) => cv.composite(f.scale(s, Jimp.RESIZE_NEAREST), i * 32 * s, 8));
  await cv.writeAsync(path.join(OUT, '_preview.png'));
  console.log('wrote', path.join(OUT, '_preview.png'));
}
