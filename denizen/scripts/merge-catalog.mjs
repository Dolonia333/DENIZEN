#!/usr/bin/env node
import path from 'path';
import {
  DATA_DIR,
  DEFAULT_CATALOG,
  loadObjectsPayload,
  parseArgs,
  readJson,
  writeJson,
} from './lib/catalog-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.objects) {
  console.error('Usage: node merge-catalog.mjs --objects <objects.json> [--placements <placements.json>] [--out <catalog.json>]');
  process.exit(1);
}

const objectsPath = path.resolve(args.objects);
const placementsPath = args.placements
  ? path.resolve(args.placements)
  : DEFAULT_CATALOG;
const outPath = args.out ? path.resolve(args.out) : DEFAULT_CATALOG;

const objectsPayload = readJson(objectsPath);
const objects = loadObjectsPayload(objectsPayload);

let placements;
if (args.placements) {
  const placementPayload = readJson(placementsPath);
  placements = Array.isArray(placementPayload)
    ? placementPayload
    : placementPayload.placements || [];
} else {
  const existing = readJson(placementsPath);
  placements = existing.placements || [];
}

const info = readJson(DEFAULT_CATALOG).info || {
  purpose: 'Open office furniture catalog',
  origin: 'bottom-center anchor.',
  slice_margin_px: 2,
};

const merged = { info, objects, placements };
writeJson(outPath, merged);

console.log(`Merged catalog written: ${outPath}`);
console.log(`  objects: ${Object.keys(objects).length}`);
console.log(`  placements: ${placements.length}`);
