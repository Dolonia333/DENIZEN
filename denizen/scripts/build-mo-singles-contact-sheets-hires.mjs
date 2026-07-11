#!/usr/bin/env node
/**
 * Higher-resolution contact sheets for Modern Office 32x32 singles, using
 * nearest-neighbor upscaling so pixel art stays crisp for labeling.
 * Output: out/mo-singles-sheets/sheet_XX.png + index.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SINGLES = path.join(ROOT, 'assets', 'modern_office', 'singles');
const OUT = path.join(ROOT, 'out', 'mo-singles-sheets');
const COLS = 8;
const SPRITE = 128;
const PAD = 8;
const CELL = SPRITE + PAD * 2;
const PER_SHEET = 24;

function numFrom(name) {
  const m = String(name).match(/_(\d+)\.png$/i);
  return m ? parseInt(m[1], 10) : 0;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs
    .readdirSync(SINGLES)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort((a, b) => numFrom(a) - numFrom(b));

  const index = [];
  let sheetIdx = 0;
  for (let start = 0; start < files.length; start += PER_SHEET) {
    const batch = files.slice(start, start + PER_SHEET);
    const rows = Math.ceil(batch.length / COLS);
    const width = COLS * CELL;
    const height = rows * (CELL + 22);
    const composites = [];
    const labels = [];

    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      const num = numFrom(file);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL + PAD;
      const y = row * (CELL + 22) + PAD;
      const abs = path.join(SINGLES, file);
      composites.push({
        input: await sharp(abs)
          .resize(SPRITE, SPRITE, {
            fit: 'contain',
            kernel: 'nearest',
            background: { r: 40, g: 44, b: 52, alpha: 1 },
          })
          .png()
          .toBuffer(),
        left: x,
        top: y,
      });
      labels.push({ num, col, row });
      index.push({
        num,
        file,
        id: `mo_single_${String(num).padStart(3, '0')}`,
        sheet: sheetIdx,
        cell: i,
      });
    }

    const svgParts = labels.map(({ num, col, row }) => {
      const tx = col * CELL + CELL / 2;
      const ty = row * (CELL + 22) + CELL + 16;
      return `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="18" font-family="monospace" font-weight="bold" fill="#facc15">${num}</text>`;
    });
    const svg = Buffer.from(
      `<svg width="${width}" height="${height}">${svgParts.join('')}</svg>`
    );

    const sheetName = `sheet_${String(sheetIdx).padStart(2, '0')}.png`;
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite([...composites, { input: svg, left: 0, top: 0 }])
      .png()
      .toFile(path.join(OUT, sheetName));

    console.log('Wrote', sheetName, `(${batch.length} sprites)`);
    sheetIdx += 1;
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ count: files.length, sheets: sheetIdx, items: index }, null, 2));
  console.log('Index:', path.join(OUT, 'index.json'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
