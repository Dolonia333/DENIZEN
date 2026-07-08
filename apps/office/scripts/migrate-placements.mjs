#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import {
  DATA_DIR,
  DEFAULT_CATALOG,
  DEFAULT_MIGRATION,
  parseArgs,
  readJson,
  writeJson,
} from './lib/catalog-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const catalogPath = args.catalog || DEFAULT_CATALOG;
const migrationPath = args.migration || DEFAULT_MIGRATION;
const outPath =
  args.out || path.join(DATA_DIR, 'furniture_catalog_openplan.placements.migrated.json');

function loadIdMap(migrationDoc) {
  if (migrationDoc?.migration && typeof migrationDoc.migration === 'object') {
    return migrationDoc.migration;
  }
  if (migrationDoc?.map && typeof migrationDoc.map === 'object') {
    return migrationDoc.map;
  }
  return migrationDoc;
}

function ensureIdentityMigration(objectIds) {
  if (fs.existsSync(migrationPath)) return readJson(migrationPath);

  const migration = Object.fromEntries(objectIds.map((id) => [id, id]));
  const stub = {
    version: 1,
    info: {
      from: 'furniture_catalog_openplan.json',
      description: 'Identity migration stub — maps each object ID to itself',
    },
    migration,
  };
  writeJson(migrationPath, stub);
  console.log(`Created identity migration stub: ${migrationPath}`);
  return stub;
}

const catalog = readJson(catalogPath);
const objectIds = Object.keys(catalog.objects || {});
const migrationDoc = ensureIdentityMigration(objectIds);
const idMap = loadIdMap(migrationDoc);

const migrated = (catalog.placements || []).map((placement) => {
  const next = { ...placement };
  if (placement.id && idMap[placement.id]) {
    next.id = idMap[placement.id];
  }
  return next;
});

const unmapped = [...new Set((catalog.placements || []).map((p) => p.id))]
  .filter((id) => id && !idMap[id]);

writeJson(outPath, migrated);
console.log(`Migrated ${migrated.length} placements -> ${outPath}`);
if (unmapped.length) {
  console.warn(`Warning: ${unmapped.length} placement id(s) not in migration map:`);
  for (const id of unmapped) console.warn(`  - ${id}`);
  process.exit(1);
}
