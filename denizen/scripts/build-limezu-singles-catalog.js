#!/usr/bin/env node
/**
 * build-limezu-singles-catalog.js
 *
 * Builds data/furniture_catalog_limezu.json from assets/limezu/index.json.
 * Each LimeZu "Single" PNG is ONE furniture object — never grid-slice it.
 *
 * Usage:
 *   node scripts/build-limezu-singles-catalog.js
 *   node scripts/build-limezu-singles-catalog.js japanese   # one theme only
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'assets', 'limezu', 'index.json');
const LABELS = path.join(ROOT, 'data', 'limezu-labels.json');
const OUT = path.join(ROOT, 'data', 'furniture_catalog_limezu.json');
const FILTER = process.argv[2] || null;

function loadLabels() {
  try {
    return JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  } catch (_) {
    return { byFile: {}, byId: {} };
  }
}

function slugFromPath(rel) {
  return rel
    .replace(/^singles\//, '')
    .replace(/\.png$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function themeFromPath(rel) {
  const m = rel.match(/^singles\/([^/]+)\//);
  return m ? m[1] : 'misc';
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
  if (!fs.existsSync(INDEX)) {
    console.error('Missing', INDEX);
    console.error('Run: node scripts/extract-limezu.js');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const labels = loadLabels();
  const singles = index.singles || [];
  const objects = {};
  let n = 0;
  let labeled = 0;

  for (const rel of singles) {
    const theme = themeFromPath(rel);
    if (FILTER && !theme.includes(FILTER) && !rel.includes(FILTER)) continue;

    const abs = path.join(ROOT, 'assets', 'limezu', rel.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) continue;

    const size = readPngSize(abs) || { w: 16, h: 16 };
    let id = `lz_${theme}_${slugFromPath(rel)}`;
    if (objects[id]) id = `${id}_${n}`;

    const base = path.basename(rel);
    const lab = labels.byFile?.[base] || labels.byId?.[id] || null;

    objects[id] = {
      source_type: 'single_file',
      single_id: id,
      url_path: `assets/limezu/${rel.replace(/\\/g, '/')}`,
      w: size.w,
      h: size.h,
      origin: 'bottom',
      depth: lab?.depth ?? 1.5,
      type: 'furniture',
      theme,
      _file: base,
    };
    if (lab?.displayName) {
      objects[id].displayName = lab.displayName;
      labeled++;
    }
    if (lab?.footprint) objects[id].footprint = lab.footprint;
    if (lab?.notes) objects[id].notes = lab.notes;
    if (size.w <= 16 && size.h <= 16) objects[id]._likelyFragment = true;

    n++;
  }

  const catalog = {
    info: {
      purpose: 'LimeZu Theme_Sorter Singles — one PNG = one object. Do not use tile indices.',
      generated: new Date().toISOString(),
      count: n,
      usage: 'RoomAssembly / office-scene: source_type single_file, preload url_path',
    },
    objects,
  };

  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));
  console.log(`Wrote ${n} singles → ${OUT} (${labeled} human-labeled)`);
  if (n === 0) {
    console.warn('No singles found. Run: node scripts/extract-limezu.js japanese');
  }
  if (labeled === 0) {
    console.warn('No labels in data/limezu-labels.json — use tools/limezu-sprite-browser.html to name sprites');
  }
}

main();
