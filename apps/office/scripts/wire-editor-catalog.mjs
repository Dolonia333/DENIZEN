#!/usr/bin/env node
/**
 * Merge curated object defs into furniture_catalog_openplan.json for the in-game editor.
 *
 * Does NOT add placements — only makes sprites pickable in the editor catalog.
 * Placements stay your 89 hand-built items until you place more in the editor (E → X).
 *
 * Usage:
 *   node scripts/wire-editor-catalog.mjs
 *   node scripts/wire-editor-catalog.mjs --with-singles   # include all 339 MO singles
 */
import path from 'path';
import { DATA_DIR, readJson, writeJson } from './lib/catalog-utils.mjs';

const OPENPLAN = path.join(DATA_DIR, 'furniture_catalog_openplan.json');
const V2_OBJECTS = path.join(DATA_DIR, 'furniture_catalog_openplan_v2.objects.json');
const MO_SINGLES = path.join(DATA_DIR, 'furniture_catalog_modern_office_singles.json');

const args = new Set(process.argv.slice(2));
const withSingles = args.has('--with-singles');

const catalog = readJson(OPENPLAN);
const baseObjects = { ...(catalog.objects || {}) };

let addedV2 = 0;
let addedSingles = 0;

try {
  const v2 = readJson(V2_OBJECTS);
  const v2Objects = v2.objects || v2;
  for (const [id, def] of Object.entries(v2Objects)) {
    if (baseObjects[id]) continue;
    baseObjects[id] = def;
    addedV2++;
  }
} catch (_) {
  console.warn('Skip v2 objects — run sprite-labeler export or catalog:rebuild first');
}

if (withSingles) {
  try {
    const singles = readJson(MO_SINGLES);
    for (const [id, def] of Object.entries(singles.objects || {})) {
      if (baseObjects[id]) continue;
      baseObjects[id] = def;
      addedSingles++;
    }
  } catch (e) {
    console.error('Missing singles catalog — run: npm run catalog:singles');
    process.exit(1);
  }
}

const out = {
  ...catalog,
  info: {
    ...(catalog.info || {}),
    editor_objects_merged_at: new Date().toISOString(),
    editor_note: 'objects merged by wire-editor-catalog.mjs; placements unchanged',
  },
  objects: baseObjects,
  placements: catalog.placements || [],
};

writeJson(OPENPLAN, out);

console.log('Editor catalog updated:', OPENPLAN);
console.log(`  objects: ${Object.keys(baseObjects).length} (+${addedV2} from v2, +${addedSingles} singles)`);
console.log(`  placements: ${out.placements.length} (unchanged — use scene editor to add more)`);
console.log('');
console.log('Next: hard refresh game → E → search catalog → place → X to export placements');
