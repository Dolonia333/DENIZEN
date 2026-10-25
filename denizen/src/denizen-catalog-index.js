'use strict';

/**
 * Read-only index of data/furniture_catalog_openplan.json.
 * Catalog ids (plant_potted) are not the 15 NPC aliases (plant_small).
 * This module never writes the catalog.
 */

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FILE = path.join(__dirname, '..', 'data', 'furniture_catalog_openplan.json');

let _map = null;

function load() {
  if (_map) return _map;
  const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const objects = raw && raw.objects && typeof raw.objects === 'object' ? raw.objects : {};
  const map = new Map();
  for (const [id, obj] of Object.entries(objects)) {
    if (!obj || typeof obj !== 'object') continue;
    map.set(id, {
      id,
      w: Number(obj.w) || 0,
      h: Number(obj.h) || 0,
      type: obj.type || '',
      sheet: obj.sheet || '',
      note: obj._note || obj.note || '',
      origin: obj.origin || 'bottom',
    });
  }
  _map = map;
  return map;
}

function get(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return load().get(key) || null;
}

function has(id) {
  return !!get(id);
}

function search(query, limit) {
  const q = String(query || '').trim().toLowerCase();
  const lim = Math.max(1, Math.min(40, Number(limit) || 15));
  const all = [...load().values()];
  const hits = (q
    ? all.filter((obj) => `${obj.id} ${obj.type} ${obj.sheet} ${obj.note}`.toLowerCase().includes(q))
    : all
  ).slice().sort((a, b) => {
    const as = q && a.id.toLowerCase().startsWith(q) ? 0 : 1;
    const bs = q && b.id.toLowerCase().startsWith(q) ? 0 : 1;
    if (as !== bs) return as - bs;
    return a.id.localeCompare(b.id);
  });
  return {
    ok: true,
    query: q,
    matchCount: hits.length,
    objects: hits.slice(0, lim),
    hint: 'These ids are catalog ids. placeCatalog and office_place_catalog take them as-is. The 15 names in placeFurniture (desk_small, plant_small, …) are aliases, not this list.',
  };
}

module.exports = {
  get,
  has,
  search,
  load,
};
