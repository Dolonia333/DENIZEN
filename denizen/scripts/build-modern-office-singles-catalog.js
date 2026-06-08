#!/usr/bin/env node
/**
 * build-modern-office-singles-catalog.js
 *
 * Builds data/furniture_catalog_modern_office_singles.json from
 * assets/modern_office/singles/*.png (32x32 singles from Modern Office pack).
 * Each PNG is ONE furniture object - never grid-slice it.
 *
 * Usage:
 *   node scripts/build-modern-office-singles-catalog.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SINGLES_DIR = path.join(ROOT, 'assets', 'modern_office', 'singles');
const LABELS = path.join(ROOT, 'data', 'modern-office-labels.json');
const OUT = path.join(ROOT, 'data', 'furniture_catalog_modern_office_singles.json');

function loadLabels() {
  try {
    return JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  } catch (_) {
    return { byFile: {}, byId: {} };
  }
}

function numFromBasename(base) {
  const m = base.match(/_(\d+)\.png$/i);
  return m ? parseInt(m[1], 10) : null;
}

function slugFromBasename(base) {
  return base
    .replace(/\.png$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function readPngSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24 || buf.toString('ascii', 0, 4) !== '\x89PNG') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch (_) {
    return null;
  }
}

function main() {
  if (!fs.existsSync(SINGLES_DIR)) {
    console.error('Missing', SINGLES_DIR);
    console.error('Extract 32x32 singles from Modern_Office_Revamped zip into that folder.');
    process.exit(1);
  }

  const labels = loadLabels();
  const files = fs
    .readdirSync(SINGLES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort((a, b) => {
      const na = numFromBasename(a);
      const nb = numFromBasename(b);
      if (na != null && nb != null) return na - nb;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  const objects = {};
  let n = 0;
  let labeled = 0;
  const pad = String(Math.max(files.length, 1)).length;

  for (const base of files) {
    const abs = path.join(SINGLES_DIR, base);
    const size = readPngSize(abs) || { w: 32, h: 32 };
    const num = numFromBasename(base);
    let id =
      num != null
        ? `mo_single_${String(num).padStart(Math.max(pad, 3), '0')}`
        : `mo_${slugFromBasename(base)}`;
    if (objects[id]) id = `${id}_${n}`;

    const rel = `assets/modern_office/singles/${base}`;
    const lab = labels.byFile?.[base] || labels.byId?.[id] || null;

    objects[id] = {
      source_type: 'single_file',
      single_id: id,
      url_path: rel.replace(/\\/g, '/'),
      w: size.w,
      h: size.h,
      origin: 'bottom',
      depth: lab?.depth ?? 1.5,
      type: 'furniture',
      theme: 'modern_office',
      _file: base,
    };
    if (lab?.displayName) {
      objects[id].displayName = lab.displayName;
      labeled++;
    }
    if (lab?.footprint) objects[id].footprint = lab.footprint;
    if (lab?.notes) objects[id].notes = lab.notes;

    n++;
  }

  const catalog = {
    info: {
      purpose:
        'Modern Office Revamped Singles (32x32) - one PNG = one object. Do not use tile indices.',
      generated: new Date().toISOString(),
      count: n,
      usage: 'RoomAssembly / office-scene: source_type single_file, preload url_path',
    },
    objects,
  };

  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));
  console.log(`Wrote ${n} singles -> ${OUT} (${labeled} human-labeled)`);
  if (n === 0) {
    console.warn('No PNG files in assets/modern_office/singles/');
  }
  if (labeled === 0) {
    console.warn(
      'No labels in data/modern-office-labels.json - add displayName entries for sprites you use'
    );
  }
}

main();
