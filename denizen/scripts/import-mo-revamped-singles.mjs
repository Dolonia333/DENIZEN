#!/usr/bin/env node
/**
 * Import Modern Office Revamped singles into a labeled catalog and merge
 * desk-stackable types into furniture_catalog_openplan.json objects.
 *
 * Reads: data/mo_singles_ai_labels.json (optional) + assets/modern_office/singles
 * Writes:
 *   - data/furniture_catalog_modern_office_singles.json
 *   - data/modern-office-labels.json (updated)
 *   - merges new objects into furniture_catalog_openplan.json (keeps placements)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SINGLES = path.join(ROOT, 'assets', 'modern_office', 'singles');
const NAMED = path.join(ROOT, 'assets', 'modern_office', 'named');
const AI_LABELS = path.join(ROOT, 'data', 'mo_singles_ai_labels.json');
const MANIFEST = path.join(ROOT, 'data', 'mo_named_manifest.json');
const HUMAN_LABELS = path.join(ROOT, 'data', 'modern-office-labels.json');
const SINGLES_CATALOG = path.join(ROOT, 'data', 'furniture_catalog_modern_office_singles.json');
const OPENPLAN = path.join(ROOT, 'data', 'furniture_catalog_openplan.json');

function numFrom(name) {
  const m = String(name).match(/_(\d+)\.png$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function readPngSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // PNG sig is 89 50 4E 47… — do not use toString('ascii') on 0x89 (Node clears the high bit).
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      return null;
    }
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch (_) {
    return null;
  }
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function main() {
  const ai = loadJson(AI_LABELS, {});
  const manifest = loadJson(MANIFEST, { items: [] });
  const byNumNamed = new Map((manifest.items || []).map((it) => [it.num, it]));
  const files = fs
    .readdirSync(SINGLES)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort((a, b) => numFrom(a) - numFrom(b));

  const byFile = {};
  const byId = {};
  const objects = {};
  const usedNames = new Set();
  let labeled = 0;

  for (const file of files) {
    const num = numFrom(file);
    const lab = ai[String(num)] || ai[num] || null;
    const named = byNumNamed.get(num);
    let name = named?.name
      ? slug(named.name)
      : lab?.name
        ? slug(lab.name)
        : `mo_single_${String(num).padStart(3, '0')}`;
    if (usedNames.has(name)) name = `${name}_${num}`;
    usedNames.add(name);

    const namedPath = named?.file ? path.join(NAMED, named.file) : null;
    const useNamed = namedPath && fs.existsSync(namedPath);
    const assetFile = useNamed ? named.file : file;
    const assetRel = useNamed
      ? `assets/modern_office/named/${named.file}`
      : `assets/modern_office/singles/${file}`;
    const size = readPngSize(useNamed ? namedPath : path.join(SINGLES, file)) || { w: 32, h: 32 };
    const type = lab?.type || 'furniture';
    const stackOn = lab?.stack_on || (type === 'decor' ? 'surface' : 'none');
    const wallMount = !!lab?.wall_mount;
    const depth = type === 'decor' ? 2.2 : type === 'surface' ? 1.5 : type === 'seat' ? 1.6 : 1.7;

    const entry = {
      source_type: 'single_file',
      single_id: name,
      url_path: assetRel,
      w: size.w,
      h: size.h,
      display_w: size.w,
      display_h: size.h,
      origin: 'bottom',
      depth: lab?.depth ?? depth,
      type,
      theme: 'modern_office',
      _file: assetFile,
      _num: num,
      _src_single: file,
    };
    if (lab?.displayName) entry.displayName = lab.displayName;
    if (stackOn && stackOn !== 'none') entry.stack_on = stackOn;
    if (wallMount) entry.wall_mount = true;
    if (lab?.category) entry.category = lab.category;
    if (lab?.notes) entry.notes = lab.notes;

    objects[name] = entry;
    if (lab) {
      labeled += 1;
      byFile[file] = {
        displayName: lab.displayName || name,
        type,
        stack_on: stackOn,
        wall_mount: wallMount,
        depth: entry.depth,
        catalogId: name,
        namedFile: useNamed ? named.file : null,
      };
      byId[name] = { displayName: lab.displayName || name };
    }
  }

  const singlesCatalog = {
    info: {
      purpose: 'Modern Office Revamped v1.2 singles — one PNG = one object, human/AI labeled',
      generated: new Date().toISOString(),
      count: Object.keys(objects).length,
      labeled,
      source: 'Downloads/Modern_Office_Revamped_v1.2/4_Modern_Office_singles/32x32',
    },
    objects,
  };
  fs.writeFileSync(SINGLES_CATALOG, JSON.stringify(singlesCatalog, null, 2));

  const human = loadJson(HUMAN_LABELS, { byFile: {}, byId: {} });
  human._doc = 'Labels for Modern Office 32x32 Singles (Revamped v1.2)';
  human._updated = new Date().toISOString();
  human.byFile = { ...(human.byFile || {}), ...byFile };
  human.byId = { ...(human.byId || {}), ...byId };
  fs.writeFileSync(HUMAN_LABELS, JSON.stringify(human, null, 2));

  // Merge into openplan catalog objects (do not wipe placements).
  const openplan = loadJson(OPENPLAN, { objects: {}, placements: [] });
  let merged = 0;
  for (const [id, def] of Object.entries(objects)) {
    // Prefer labeled semantic ids; skip unlabeled generic mo_single_* unless missing.
    const isGeneric = /^mo_single_\d+$/.test(id);
    if (isGeneric && openplan.objects[id]) continue;
    if (!openplan.objects[id] || labeled) {
      openplan.objects[id] = { ...def };
      merged += 1;
    }
  }
  if (!openplan.info) openplan.info = {};
  openplan.info.mo_singles_merged_at = new Date().toISOString();
  openplan.info.mo_singles_merged_count = merged;
  fs.writeFileSync(OPENPLAN, JSON.stringify(openplan, null, 2));

  console.log(`Singles catalog: ${Object.keys(objects).length} objects (${labeled} labeled) -> ${SINGLES_CATALOG}`);
  console.log(`Merged ${merged} into openplan catalog`);
}

main();
