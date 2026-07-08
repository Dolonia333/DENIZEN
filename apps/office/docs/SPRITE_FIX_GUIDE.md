# Why Sprites Look Wrong — and How to Fix Them

If furniture shows as **random stripes**, **half a chair**, **magenta squares**, **pieces of other sprites in the crop**, or **wrong objects**, you are almost certainly using the **wrong build pipeline** for that PNG. Denizen has four different systems; they are not interchangeable.

**LimeZu-specific placement (layers, spacing, naming):** see **[LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md)** — LimeZu does not ship names for `Singles_42`; you label them yourself in **limezu-sprite-browser.html**.

---

## Quick diagnosis

| What you see | Cause | Fix |
|--------------|-------|-----|
| Horizontal color **stripes** / smeared tiles | Grid size wrong (e.g. 32×32 cut from 48×48 sheet) | Match `tileWidth`/`tileHeight` to the real cell size — see [TILE_INDEX_NOTES.md](../TILE_INDEX_NOTES.md) |
| **Magenta** 16×16 squares on floors/walls | Wrong **frame index** in `room-builder-tiles.json` | http://localhost:8080/tools/tile-inspector.html → copy correct `frame` |
| Random chunk of a big PNG | Treated a **theme sheet** as a tile grid | Do **not** grid-slice `themes/japanese.png`; use `singles/japanese/*.png` |
| Missing / blank furniture | `url_path` points to file that does not exist | Run `node scripts/extract-limezu.js` then `node scripts/build-limezu-singles-catalog.js` |
| Desk looks like a shelf | Wrong **(x,y,w,h)** in catalog | http://localhost:8080/sprite-labeler.html or sprite-cutter.html |

---

## Rule 1 — Pick ONE pipeline per asset

```
What are you placing?
│
├─ LimeZu furniture (Japanese, jail, studio, gym…)
│     → ONE file per object in assets/limezu/singles/<theme>/
│     → catalog: source_type "single_file" + url_path (NOT tile index)
│     → Build catalog: node scripts/build-limezu-singles-catalog.js
│
├─ Modern Office desks/chairs (your current HQ)
│     → Sheet Modern_Office_Black_Shadow_32x32.png
│     → catalog: pixel rect x,y,w,h on sheet "mo_black_shadow_32"
│     → Fix labels: sprite-labeler.html
│
├─ Room floor + 3D walls (empty shell)
│     → room-builder/floors.png + walls_3d.png
│     → frame index in data/room-builder-tiles.json
│     → Fix indices: tools/tile-inspector.html
│
└─ RPG Maker MV floor/wall autotiles (legacy path)
      → 48×48 tiles-catalog.json
      → python build_tiles_catalog.py after tilesheets-config.json
```

**Never** run `build_tiles_catalog.py` on LimeZu `singles/` — those PNGs are already one object each.

---

## Rule 2 — LimeZu singles (Japanese, jail, studio…)

After extract:

```powershell
cd apps/office
node scripts/extract-limezu.js japanese
node scripts/build-limezu-singles-catalog.js
```

Each entry looks like:

```json
"kotatsu_01": {
  "source_type": "single_file",
  "single_id": "kotatsu_01",
  "url_path": "assets/limezu/singles/japanese/Japanese_Interiors_Black_Shadow_Singles_42.png",
  "w": 32,
  "h": 24,
  "origin": "bottom"
}
```

Preview without guessing:

```
http://localhost:8080/tools/limezu-single-preview.html
```

Place in a room template (`data/room-templates.json`):

```json
{ "id": "kotatsu_01", "x": 200, "y": 180, "z_index": 1.5 }
```

`RoomAssembly` loads the **whole PNG** — no cropping.

---

## Rule 3 — Modern Office sheet (reference_office)

1. Open `sprite-labeler.html` with server running.
2. Label each cut with a stable ID (`desk_pod`, `chair_office`, …).
3. Save → replace `data/furniture_catalog_openplan.json`.

Catalog uses **pixel coordinates**, not frame numbers:

```json
"desk_pod": { "sheet": "mo_black_shadow_32", "x": 64, "y": 0, "w": 128, "h": 96 }
```

Multi-tile objects (2×2 rug) need **four** tiles combined into one texture — see [TILE_INDEX_NOTES.md](../TILE_INDEX_NOTES.md).

---

## Rule 4 — Room shells (walls/floors)

LimeZu Room Builder = **16×16** cells.

1. Open `tools/tile-inspector.html`.
2. Select `assets/limezu/room-builder/floors.png` (or walls_3d).
3. Click the tile you want → copy `frame` into `data/room-builder-tiles.json`.
4. Reload `tools/room-preview.html` — **no magenta** = correct.

---

## Rule 5 — Match reference screenshots 1:1

LimeZu shipped **finished rooms** as layer stacks:

| Reference | Copy these into `assets/limezu/examples/` |
|-----------|-------------------------------------------|
| Japanese house | `japanese_preview.png`, `japanese_layer1.png`, `japanese_layer2.png` |
| TV studio | `studio_preview.png`, `studio_layer1.png` … |

Fastest way to match the ref: use the **preview PNG as a static background** image in Phaser, then add collision boxes. Procedural placement comes second.

---

## Common mistake: master_furniture_catalog.json

`data/master_furniture_catalog.json` is **auto-generated** and often points at paths like:

`assets/moderninteriors-win/...` (full zip tree — may not exist).

Your extracted assets live at:

`assets/limezu/singles/japanese/...`

Use **`data/furniture_catalog_limezu.json`** (from the build script) for LimeZu placement, or fix `url_path` to the `limezu/` tree.

---

## Recommended workflow (in order)

1. `node scripts/extract-limezu.js` — get PNGs on disk  
2. `node scripts/build-limezu-singles-catalog.js` — catalog with correct paths  
3. `tools/limezu-single-preview.html` — confirm one sprite looks right  
4. `tools/tile-inspector.html` — fix room shell if needed  
5. `sprite-labeler.html` — only for Modern Office **sheet** cuts  
6. Add placements to `room-templates.json` or `office-layout.json`  

---

## Still stuck?

Tell me **which asset** (e.g. "Japanese kotatsu" or "office desk") and **what it looks like** (stripes / magenta / wrong object). That maps to exactly one row in the table above.
