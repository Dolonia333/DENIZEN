#!/usr/bin/env node
/**
 * Validate furniture catalog objects + placements.
 * Usage: node scripts/validate-catalog.mjs [--catalog path] [--objects path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

function parseArgs(argv) {
  const opts = {
    catalog: path.join(DATA, 'furniture_catalog_openplan.json'),
    objects: path.join(DATA, 'furniture_catalog_openplan_v2.objects.json'),
    mode: 'production',
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--catalog' && argv[i + 1]) opts.catalog = path.resolve(argv[++i]);
    else if (argv[i] === '--objects' && argv[i + 1]) opts.objects = path.resolve(argv[++i]);
    else if (argv[i] === '--mode' && argv[i + 1]) opts.mode = argv[++i];
    else if (argv[i] === '--strict') opts.mode = 'strict';
  }
  return opts;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function rectOf(def) {
  return {
    x: def.x ?? def.rect?.x ?? 0,
    y: def.y ?? def.rect?.y ?? 0,
    w: Math.max(1, def.w ?? def.rect?.w ?? 32),
    h: Math.max(1, def.h ?? def.rect?.h ?? 32),
  };
}

function rectKey(r) {
  return `${r.x},${r.y},${r.w},${r.h}`;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function validateObjects(objects, label, { scopeIds = null, failOnOverlap = true } = {}) {
  const issues = [];
  const warnings = [];
  const entries = Object.entries(objects || {});
  const rectsById = new Map();
  const rectToIds = new Map();

  for (const [id, def] of entries) {
    const r = rectOf(def);
    rectsById.set(id, r);
    const k = rectKey(r);
    if (!rectToIds.has(k)) rectToIds.set(k, []);
    rectToIds.get(k).push(id);
  }

  const checkIds = scopeIds ? [...scopeIds].filter((id) => rectsById.has(id)) : [...rectsById.keys()];
  const overlaps = [];
  for (let i = 0; i < checkIds.length; i++) {
    for (let j = i + 1; j < checkIds.length; j++) {
      const a = checkIds[i];
      const b = checkIds[j];
      if (rectsOverlap(rectsById.get(a), rectsById.get(b))) {
        overlaps.push({ a, b, rectA: rectsById.get(a), rectB: rectsById.get(b) });
      }
    }
  }

  const duplicateRects = [...rectToIds.entries()]
    .filter(([, ids2]) => {
      if (!scopeIds) return ids2.length > 1;
      const scoped = ids2.filter((id) => scopeIds.has(id));
      return scoped.length > 1;
    });

  const overlapBucket = failOnOverlap ? issues : warnings;
  if (overlaps.length) {
    overlapBucket.push({ kind: 'overlap', count: overlaps.length, sample: overlaps.slice(0, 10) });
  }
  if (duplicateRects.length) {
    issues.push({
      kind: 'duplicate_rect',
      count: duplicateRects.length,
      sample: duplicateRects.slice(0, 10).map(([k, ids2]) => ({
        rect: k,
        ids: scopeIds ? ids2.filter((id) => scopeIds.has(id)) : ids2,
      })),
    });
  }

  return { label, objectCount: entries.length, scopedCount: checkIds.length, overlaps, duplicateRects, issues, warnings };
}

function validatePlacements(catalog, objects) {
  const issues = [];
  const placements = catalog.placements || [];
  const objectIds = new Set(Object.keys(objects || {}));
  const instanceIds = new Set();

  const missingObject = [];
  const duplicateInstance = [];
  const badParent = [];

  for (const pl of placements) {
    if (!objectIds.has(pl.id)) missingObject.push(pl);
    if (pl.instanceId) {
      if (instanceIds.has(pl.instanceId)) duplicateInstance.push(pl.instanceId);
      instanceIds.add(pl.instanceId);
    }
    if (pl.parentInstanceId && !instanceIds.has(pl.parentInstanceId) && !placements.some(p => p.instanceId === pl.parentInstanceId)) {
      badParent.push(pl);
    }
  }

  // Second pass: parent refs may point forward in array
  const allInstances = new Set(placements.map(p => p.instanceId).filter(Boolean));
  for (const pl of placements) {
    if (pl.parentInstanceId && !allInstances.has(pl.parentInstanceId)) {
      if (!badParent.some(b => b.instanceId === pl.instanceId)) badParent.push(pl);
    }
  }

  if (missingObject.length) {
    issues.push({ kind: 'missing_object', count: missingObject.length, sample: missingObject.slice(0, 10) });
  }
  if (duplicateInstance.length) {
    issues.push({ kind: 'duplicate_instance', count: duplicateInstance.length, sample: duplicateInstance.slice(0, 10) });
  }
  if (badParent.length) {
    issues.push({ kind: 'bad_parent', count: badParent.length, sample: badParent.slice(0, 10) });
  }

  return { placementCount: placements.length, issues };
}

function printReport(title, result, { warningsOnly = false } = {}) {
  console.log(`\n=== ${title} ===`);
  if (result.objectCount != null) console.log(`Objects: ${result.objectCount}`);
  if (result.scopedCount != null) console.log(`Scoped objects: ${result.scopedCount}`);
  if (result.placementCount != null) console.log(`Placements: ${result.placementCount}`);

  const buckets = warningsOnly
    ? [{ label: 'warnings', items: result.warnings || [] }]
    : [
        { label: 'issues', items: result.issues || [] },
        { label: 'warnings', items: result.warnings || [] },
      ];

  let failCount = 0;
  for (const bucket of buckets) {
    if (!bucket.items.length) continue;
    for (const issue of bucket.items) {
      const tag = bucket.label === 'warnings' ? 'warn' : 'fail';
      console.log(`\n[${tag}:${issue.kind}] ${issue.count} issue(s)`);
      if (issue.sample) {
        for (const row of issue.sample) {
          if (issue.kind === 'overlap') {
            console.log(`  ${row.a} ↔ ${row.b}`);
          } else if (issue.kind === 'duplicate_rect') {
            console.log(`  rect (${row.rect}) → ${row.ids.join(', ')}`);
          } else if (issue.kind === 'missing_object') {
            console.log(`  placement id "${row.id}" instance ${row.instanceId || '(none)'}`);
          } else if (issue.kind === 'bad_parent') {
            console.log(`  ${row.instanceId}: parent "${row.parentInstanceId}" not found`);
          } else {
            console.log(`  ${JSON.stringify(row)}`);
          }
        }
        if (issue.count > issue.sample.length) {
          console.log(`  … and ${issue.count - issue.sample.length} more`);
        }
      }
      if (bucket.label === 'issues') failCount += issue.count;
    }
  }

  if (!failCount && !(result.warnings || []).length) {
    console.log('OK — no issues');
  }
  return failCount;
}

const opts = parseArgs(process.argv);
const catalog = loadJson(opts.catalog);
const objectsOnly = loadJson(opts.objects);

let exitCode = 0;

if (!catalog && !objectsOnly) {
  console.error('No catalog files found.');
  process.exit(1);
}

console.log('Catalog validation report');
console.log(`Mode: ${opts.mode}`);
console.log(`Catalog: ${opts.catalog}${catalog ? '' : ' (missing)'}`);
console.log(`Objects v2: ${opts.objects}${objectsOnly ? '' : ' (missing)'}`);

const migrationPath = path.join(DATA, 'catalog_id_migration.json');
if (fs.existsSync(migrationPath)) {
  const migration = loadJson(migrationPath);
  const mapSize = Object.keys(migration?.map || migration || {}).length;
  console.log(`Migration map: ${migrationPath} (${mapSize} entries)`);
} else {
  console.log('Migration map: not created yet (data/catalog_id_migration.json)');
}

const placementIds = catalog
  ? new Set((catalog.placements || []).map((pl) => pl.id).filter(Boolean))
  : null;

if (catalog) {
  const plResult = validatePlacements(catalog, catalog.objects);
  exitCode += printReport('Placements', plResult);

  if (opts.mode === 'strict') {
    const objResult = validateObjects(catalog.objects, 'All objects (strict)');
    exitCode += printReport('Object library', objResult);
  } else if (placementIds?.size) {
    const scoped = validateObjects(catalog.objects, 'Placement-used objects', {
      scopeIds: placementIds,
      failOnOverlap: true,
    });
    exitCode += printReport('Placement-used objects', scoped);

    const library = validateObjects(catalog.objects, 'Full library (informational)', {
      failOnOverlap: false,
    });
    printReport('Full library overlaps (informational)', library, { warningsOnly: true });
  }
}

if (objectsOnly && opts.mode === 'strict') {
  const v2Result = validateObjects(objectsOnly.objects, 'furniture_catalog_openplan_v2.objects');
  exitCode += printReport('V2 objects file', v2Result);
  if (catalog) {
    const plResultV2 = validatePlacements(catalog, objectsOnly.objects);
    exitCode += printReport('Placements vs V2 objects', plResultV2);
  }
}

console.log(exitCode ? `\nFAILED — ${exitCode} issue(s)` : '\nPASSED');
process.exit(exitCode ? 1 : 0);
