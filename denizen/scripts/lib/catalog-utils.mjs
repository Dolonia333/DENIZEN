import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DENIZEN_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(DENIZEN_ROOT, 'data');
export const DEFAULT_CATALOG = path.join(DATA_DIR, 'furniture_catalog_openplan.json');
export const DEFAULT_MIGRATION = path.join(DATA_DIR, 'catalog_id_migration.json');

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function objectRect(def) {
  if (!def || def.source_type === 'single_file') return null;
  const x = def.x ?? def.rect?.x;
  const y = def.y ?? def.rect?.y;
  const w = def.w ?? def.rect?.w;
  const h = def.h ?? def.rect?.h;
  if ([x, y, w, h].some((v) => typeof v !== 'number')) return null;
  return { x, y, w, h };
}

export function rectKey(sheet, rect) {
  return `${sheet}:${rect.x},${rect.y},${rect.w},${rect.h}`;
}

export function rectsOverlap(a, b) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(ax2, bx2);
  const iy1 = Math.min(ay2, by2);
  return ix1 > ix0 && iy1 > iy0;
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function loadObjectsPayload(payload) {
  if (Array.isArray(payload)) {
    const objects = {};
    for (const entry of payload) {
      const id = entry.id || entry.name;
      if (!id) continue;
      objects[id] = entry;
    }
    return objects;
  }
  if (payload?.objects && !Array.isArray(payload.objects)) {
    return payload.objects;
  }
  if (payload?.objects && Array.isArray(payload.objects)) {
    const objects = {};
    for (const entry of payload.objects) {
      const id = entry.id || entry.name;
      if (!id) continue;
      objects[id] = normalizeExtractObject(entry);
    }
    return objects;
  }
  return payload;
}

function normalizeExtractObject(entry) {
  const rect = entry.rectSnapped || entry.rect || entry.rectTight;
  if (!rect) return entry;
  return {
    sheet: entry.sheet || 'mo_black_shadow_32',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    origin: entry.origin || 'bottom',
    depth: entry.depth ?? 1.5,
    display_w: entry.display_w ?? rect.w,
    display_h: entry.display_h ?? rect.h,
    type: entry.type || 'furniture',
    ...entry,
  };
}
