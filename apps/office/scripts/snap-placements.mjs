#!/usr/bin/env node
/**
 * Snap furniture placement coordinates to the furniture grid (default 32px).
 *
 * Usage:
 *   node scripts/snap-placements.mjs [--catalog path] [--grid 32] [--out path] [--write]
 */
import path from 'path';
import {
  DEFAULT_CATALOG,
  parseArgs,
  readJson,
  writeJson,
} from './lib/catalog-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const catalogPath = args.catalog ? path.resolve(args.catalog) : DEFAULT_CATALOG;
const grid = Number(args.grid || 32);
const writeInPlace = Boolean(args.write);
const outPath = args.out
  ? path.resolve(args.out)
  : writeInPlace
    ? catalogPath
    : catalogPath.replace(/\.json$/, '.snapped.json');

if (!Number.isFinite(grid) || grid <= 0) {
  console.error('--grid must be a positive number');
  process.exit(1);
}

function snap(value) {
  return Math.round(value / grid) * grid;
}

const catalog = readJson(catalogPath);
const placements = catalog.placements || [];
let moved = 0;

const snapped = placements.map((placement) => {
  if (typeof placement.x !== 'number' || typeof placement.y !== 'number') {
    return placement;
  }
  const nx = snap(placement.x);
  const ny = snap(placement.y);
  if (nx !== placement.x || ny !== placement.y) moved++;
  return nx === placement.x && ny === placement.y
    ? placement
    : { ...placement, x: nx, y: ny };
});

const output = writeInPlace
  ? { ...catalog, placements: snapped }
  : snapped;

writeJson(outPath, output);

console.log(`Snapped ${placements.length} placement(s) to ${grid}px grid`);
console.log(`  moved: ${moved}`);
console.log(`  output: ${outPath}`);
