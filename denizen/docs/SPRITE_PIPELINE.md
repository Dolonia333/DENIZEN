# Sprite Pipeline — The Missing Manual

**This is the authoritative map of how sprites get from LimeZu sheets onto the office
screen.** It was reverse-engineered from the code in July 2026 (four-way audit of tools,
data files, office-scene.js, and docs). If another doc contradicts this one, this one wins —
several root-level docs describe abandoned generations (see "What to ignore" at the end).

---

## The one-paragraph version

`data/furniture_catalog_openplan.json` is the **single source of truth**: its `objects` say
what exists (947 defs) and its `placements` say where the default office puts them (99
hand-placed items). Browser tools (served by `npm start`) label sprites; npm `catalog:*`
scripts rebuild and merge the catalog; `office-scene.js` renders it. The in-game editor
(`E` key) is how you place things — export with `X` and paste into `placements`.

**The one safe script order** when touching objects:
```
catalog:rebuild  →  catalog:merge  →  catalog:wire-editor
```
`catalog:merge` alone strips the 725 singles objects from the catalog — **never stop
between merge and wire-editor.** End every session with `validate:catalog` +
`blueprint:build`.

---

## Pipeline map (Gen 3 "openplan" — the only one that reaches the screen)

```
SOURCE ART
  assets/Modern_Office_Black_Shadow_32x32.png    master sheet (texture key mo_black_shadow_32)
  assets/modern_office/singles/*.png             339 hand-cut singles
  assets/Room_Builder_Office_32x32.png           floor/wall tiles (cut at runtime)

LABELING (browser tools — `npm start`, then http://localhost:8080/…)
  /sprite-labeler.html    label rects on the master sheet → download v2.objects.json
  /singles-viewer.html    label the 339 singles → export labels JSON

CATALOG BUILD (npm scripts)
  npm run catalog:rebuild      out/sheet_extract → furniture_catalog_openplan_v2.objects.json
  npm run catalog:singles      singles PNGs → furniture_catalog_modern_office_singles.json
  npm run catalog:merge        v2 objects REPLACE live catalog objects (placements kept)
  npm run catalog:wire-editor  singles + v2 defs merged INTO live catalog  ← must follow merge
  npm run catalog:snap         32px grid-snap all placements (--write)
  npm run validate:catalog     the gate — run it every session
  npm run blueprint:build      → data/office_blueprint.json (.floors is LIVE runtime data)

RUNTIME (index.html → office-scene.js)
  preload loads: furniture_catalog_openplan, openplan_walls, office_blueprint,
                 room-templates (+ one dead file, see below)
  - sheet-crop objects render as canvas crops (cat_<id>)
  - single_file objects load their own PNG on demand (single_<id>)
  - walls: data/openplan_walls.json via src/openplan-walls.js
  - floors: office_blueprint.json .floors → tileSprites
  OVERRIDE LAYER: GET /api/layout → layouts/offices/<officeId>/office-layout.json
  - editor saves REPLACE catalog placements wholesale for that office
  - NPC items (POST /api/place-furniture) are additive on top
```

---

## Workflow A — add a NEW furniture sprite

**Path 1 — standalone PNG (recommended):**
1. Drop a 32px-scale PNG into `assets/modern_office/singles/`.
2. `npm run catalog:singles`
3. `npm run catalog:wire-editor`
4. `npm run validate:catalog`

**Path 2 — new rect on the Black Shadow sheet:**
1. `npm start` → http://localhost:8080/sprite-labeler.html → label the rect
   (IDs pre-fill by rect-matching; overlap detection is built in).
2. Save the downloaded file over `data/furniture_catalog_openplan_v2.objects.json`.
3. `npm run catalog:merge` **then immediately** `npm run catalog:wire-editor`.
4. `npm run validate:catalog`.

## Workflow B — move or place furniture in the office

1. `npm start`, open the office, press **E** → search a catalog id → place/drag →
   **X** exports placements.
2. Persistence choices:
   - **Canonical default (recommended):** paste exported placements into the
     `placements` array of `data/furniture_catalog_openplan.json`
     (`{id, instanceId, x, y}`; bottom-center anchor, world 1280×720).
   - **Per-office save** (POST /api/layout): quick, but REPLACES the 99 catalog
     defaults wholesale for that office.
3. `npm run catalog:snap` → `npm run validate:catalog` → `npm run blueprint:build`.
4. Hard-refresh (Ctrl+Shift+R). The JSONs use a fixed `?v=…` cache-buster in
   office-scene.js preload — bump it if a change refuses to appear.

**Walls:** edit `data/openplan_walls.json` (7 segments, tileSize 32) or use the in-game
wall editor, then `npm run blueprint:build`.

---

## The LimeZu multi-pack world (exteriors / interiors / farm / UI)

A healthy parallel branch, not yet wired into the main office scene:

```
scripts/extract-limezu.js         zips → assets/limezu/ (exteriors, farm, themes,
                                  singles, room-builder, characters, ui, animated)
src/room-tile-renderer.js         renders 12 room shells (japanese_home, jail,
                                  tv_studio, medical_wing, gym, library, …)
src/RoomAssembly.js               furniture layer (live only under ?mode=assembly)
src/city/cityGenerator.js         roads/buildings; /api/generate-city endpoint (tested)
data/full-world-blueprint.json    6 designed zones: dolonia_hq, japanese_retreat,
                                  security_complex, news_studio, city_plaza, helipad
tools/room-preview.html           preview every room shell
docs/FULL_WORLD.md                zone design + NPC assignments
```

Missing piece (as of this writing): a `?world=full` mode in office-scene.js that reads the
blueprint, renders each zone with RoomTileRenderer, dresses it from
`assets/limezu/singles/<theme>/`, and connects zones via the city plaza.

---

## Known traps (from the audit)

- **`catalog:merge` last = data loss.** Objects drop 947 → 223 and every singles
  placement orphans. Always follow with `catalog:wire-editor`.
- **`data/sheet_extract/` vs `out/sheet_extract/`** are unsynced twins (labeler reads
  data/, rebuild reads out/). Copy after re-extracting.
- **validate:catalog has 22 pre-existing rect overlaps** in the whiteboard/desk cluster
  and one duplicate rect (`whiteboard_line_chart` = `whiteboard_pie_chart`). Fix in the
  labeler when touching that area; don't let new errors hide among them.
- **NPC placement ids ≠ catalog ids.** server.js ALLOWED_PREFABS uses ids like
  `desk_2x2` that don't exist in the catalog — see the alias map in office-scene.js
  (`NPC_PREFAB_ALIASES`) which translates them at render time.

## What to ignore (abandoned generations — art is safe, tools feed nothing)

- Gen 1: `tilesheets-config.json`, `build_tiles_catalog.py`, `tiles-catalog.json`,
  `data/sprite-map-modern-office.json`, `assets-catalog*.json`, `data/assets-index.json`
- Gen 1.5: `src/city/RoomAssembly.js` + `src/city/RoomBuilder.js` (the LIVE one is
  `src/RoomAssembly.js`), `SYSTEM_SUMMARY.md`, `ROOM_ASSEMBLY_GUIDE.md`
- Gen 2: `asset-browser.html/js` (image paths broke in the Denizen → "Denizen OS"
  folder rename), `data/master_furniture_catalog.json` (22MB; its office-scene fallback
  branches can never trigger), `build_assets_catalog.py` (dead hard-coded path)
- Superseded docs: `SYSTEM_SUMMARY.md`, `ROOM_ASSEMBLY_GUIDE.md`, `TILE_INDEX_NOTES.md`,
  `LAYOUT_AND_REFERENCE.md`, `ASSEMBLY.md`, `REFERENCE_*.md`
