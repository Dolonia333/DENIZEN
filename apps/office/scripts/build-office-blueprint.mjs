#!/usr/bin/env node
/**
 * Merge hand-built office pieces into data/office_blueprint.json
 * so Denizen / Fable 5 can recreate the layout from one file.
 *
 * Run: node scripts/build-office-blueprint.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}

const catalog = readJson('furniture_catalog_openplan.json');
const walls = readJson('openplan_walls.json');
const zonesDoc = readJson('openplan_zones.json');
const rebuild = readJson('openplan_rebuild.json');
const placements = catalog.placements || [];

const xs = placements.map((p) => p.x);
const ys = placements.map((p) => p.y);

const blueprint = {
  id: 'hu4gzs_openplan_handbuilt_v1',
  label: 'Hu4Gzs open-plan office (hand-built)',
  status: 'authoritative',
  referenceImage: rebuild.referenceImage || 'assets/ref_Hu4Gzs.png',
  layoutParam: 'openplan',
  coordinateSpace:
    'World pixels. Furniture anchor = bottom-center at (x,y). Walls from openplan_walls.json tile grid (32px).',
  room: {
    width: walls.info?.worldSize?.w ?? 1280,
    height: walls.info?.worldSize?.h ?? 720,
    originPx: zonesDoc.roomOriginPx || { x: 16, y: 32 },
    placementExtentPx: rebuild.room?.placementExtentPx || {
      xMin: Math.min(...xs, 52),
      xMax: Math.max(...xs, 1228),
      yMin: Math.min(...ys, 64),
      yMax: Math.max(...ys, 700),
    },
  },
  pipeline: [
    { step: 1, name: 'floors', field: 'floors', renderer: 'office-scene.js tileSprite zones' },
    { step: 2, name: 'walls', file: 'data/openplan_walls.json', renderer: 'src/openplan-walls.js' },
    {
      step: 3,
      name: 'furniture',
      file: 'data/furniture_catalog_openplan.json',
      field: 'placements',
      objectDefs: 'objects',
    },
    { step: 4, name: 'zones', file: 'data/openplan_zones.json', field: 'zones' },
    { step: 5, name: 'characters', field: 'spawnPoints' },
  ],
  floors: [
    { id: 'base', x: 640, y: 360, w: 1280, h: 720, tex: 'floor_rb_office', note: 'Full-room underlay' },
    { id: 'open_office', x: 32, y: 64, w: 816, h: 384, tex: 'floor_rb_office' },
    { id: 'manager_office', x: 880, y: 64, w: 368, h: 192, tex: 'floor_rb_wood' },
    { id: 'conference_supply', x: 880, y: 320, w: 368, h: 128, tex: 'floor_rb_dark' },
    { id: 'break_room', x: 32, y: 512, w: 256, h: 144, tex: 'floor_rb_wood' },
    { id: 'reception', x: 384, y: 512, w: 464, h: 144, tex: 'floor_rb_office' },
    { id: 'south_east', x: 880, y: 512, w: 368, h: 144, tex: 'floor_rb_dark' },
  ],
  walls: {
    file: 'data/openplan_walls.json',
    segments: walls.segments,
    info: walls.info,
  },
  zones: zonesDoc.zones,
  furniture: {
    catalogFile: 'data/furniture_catalog_openplan.json',
    placementCount: placements.length,
    uniquePrefabIds: [...new Set(placements.map((p) => p.id))].sort(),
    placements,
  },
  spawnPoints: rebuild.spawnPoints || {},
  editor: {
    exportHint: 'Ctrl+Shift+E furniture editor, drag props, press X to download JSON, merge placements into catalog',
    layoutApi: 'POST /api/layout { placements: [...] }',
  },
  recreate: {
    summary:
      'Load ?layout=openplan. Floors + walls + 89 furniture placements reproduce the hand-built office.',
    commands: [
      'node scripts/build-office-blueprint.mjs',
      'npm run validate:catalog',
    ],
    modes: {
      live: '?layout=openplan (default)',
      assembly: '?mode=assembly&template=reference_office_main (stale template — use catalog placements instead)',
      editor: 'localhost/?editor=1 or Ctrl+Shift+E',
    },
  },
};

const out = path.join(DATA, 'office_blueprint.json');
fs.writeFileSync(out, JSON.stringify(blueprint, null, 2) + '\n', 'utf8');
console.log(`Wrote ${out}`);
console.log(`  placements: ${placements.length}`);
console.log(`  walls: ${walls.segments?.length ?? 0} segments`);
console.log(`  zones: ${zonesDoc.zones?.length ?? 0}`);
