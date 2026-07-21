# Full World — LimeZu Multi-Zone Layout

Build a world like your reference screenshots: **Japanese home**, **prison/infirmary**, **news studio**, **city block**, and **helicopter** — all from the packs in `Downloads\all sprite files`.

## How LimeZu rooms work (matches your reference images)

Every polished room uses **two layers**:

| Layer | Source | What it is |
|-------|--------|------------|
| **Layer 1** | `room-builder/` (floors, `walls_3d`, arches) | Empty shell — tatami-colored floor, 3D wall band, door gaps |
| **Layer 2** | `themes/*.png` + `singles/<theme>/` | Furniture placed on top — tables, beds, cameras, prison bars |

LimeZu ships **finished examples** under `6_Home_Designs/`:

- `examples/japanese_preview.png` — your Japanese interior ref
- `examples/studio_preview.png` — news studio ref
- `examples/japanese_layer1.png` / `layer2.png` — exact stacking order

Denizen renders Layer 1 via [`src/room-tile-renderer.js`](../src/room-tile-renderer.js) and Layer 2 via [`src/RoomAssembly.js`](../src/RoomAssembly.js) or manual sprite placement from `singles/`.

## Your reference images → asset packs

| Your screenshot | LimeZu theme | Manifest paths |
|-----------------|--------------|----------------|
| Japanese house (tatami, shoji) | `20_Japanese_interiors` | `themes/japanese.png`, `singles/japanese/`, `examples/japanese_*` |
| Prison + medical bay | `18_Jail` + `19_Hospital` | `themes/jail.png`, `singles/jail/`, `singles/medical/` |
| News studio | `23_Television_and_Film_Studio` | `themes/studio.png`, `singles/studio/`, `examples/studio_*` |
| Urban city block | Modern Exteriors | `exteriors/city_terrain.png`, `city_props.png`, `cars/` |
| Helicopter sheet | Vehicles animated | `exteriors/helicopters/` |

## Step 1 — Extract sprites from Downloads

Manifest already points at your zips:

`denizen/data/limezu-manifest.json` → `sources.interiors` / `exteriors` / `farm` / `ui`

From `denizen/`:

```powershell
# New themes only (faster)
node scripts/extract-limezu.js japanese
node scripts/extract-limezu.js jail
node scripts/extract-limezu.js studio
node scripts/extract-limezu.js helicopter
node scripts/extract-limezu.js japanese_preview
```

Full extract:

```powershell
node scripts/extract-limezu.js
```

On Windows, the script uses PowerShell + .NET `ZipFile` when `unzip` is missing.

Output lands in `denizen/assets/limezu/` (~1600+ PNGs). Phaser scans `assets/limezu/index.json`.

## Step 2 — Preview room shells

Open with Denizen server running:

- http://localhost:8080/tools/room-preview.html — all `roomTypes` including `japanese_home`, `jail`, `tv_studio`
- http://localhost:8080/tools/tile-inspector.html — fix magenta tiles (wrong frame index)

Room presets live in `data/room-builder-tiles.json`.

## Step 3 — World layout blueprint

`data/full-world-blueprint.json` defines zones:

1. **dolonia_hq** — current 16-NPC office (open plan)
2. **japanese_retreat** — multi-subroom home (genkan, tatami, bedroom, dining)
3. **security_complex** — cells + control room + infirmary (Bouncer / Dan)
4. **news_studio** — cameras, desk, monitors (Sarah demos / broadcasts)
5. **city_plaza** — exterior hub connecting interiors
6. **helipad** — helicopter props from vehicles pack

Coordinates are in **16px tiles** on a 4096×3072 canvas. Adjust `x`/`y`/`cols`/`rows` to taste.

## Step 4 — Build each zone (two approaches)

### A. Fast path — stamp LimeZu Home Designs

For pixel-perfect match to references:

1. Open `assets/limezu/examples/japanese_preview.png` (and `layer1` / `layer2`) in an editor.
2. Create a Phaser **static image** zone background at the blueprint `x,y` (scaled 1:1 or ×2).
3. Add **collision rects** over walls manually.
4. Place NPCs on walkable floor tiles only.

Good for demos; less flexible for NPC `placeFurniture`.

### B. Proper path — procedural (what Denizen is building toward)

Per zone:

```js
import { RoomTileRenderer } from './src/room-tile-renderer.js';
// 1. renderRoom({ roomType: 'japanese_home', cols, rows, doors })
// 2. load singles from assets/limezu/singles/japanese/*.png
// 3. place furniture from theme sheet indices (tile-inspector)
```

Exterior **city_plaza** uses `src/city/cityGenerator.js` + `exteriors/city_terrain.png` tiles — see [CITY_GENERATOR.md](CITY_GENERATOR.md).

Connect zones with `corridors` in the blueprint or `room-builder/arches.png` doorways.

## Step 5 — Wire into the game (current status)

| Piece | Status |
|-------|--------|
| Asset extract manifest | ✅ Updated for japanese / jail / studio / vehicles |
| Room shell types | ✅ `japanese_home`, `jail`, `tv_studio`, `medical_wing` |
| World blueprint JSON | ✅ `data/full-world-blueprint.json` |
| `?seed=` world generator | 🟡 Office recipes only — not full blueprint yet |
| Handcrafted `office-scene.js` | ✅ Current default map |
| Load `?world=full` | ✅ Wired (July 2026) — `src/full-world.js` |

**Open it:** `/office?demo=1&world=full` (local or denizen.dolonia.cloud). The
office `create()` early-returns into `src/full-world.js`, which renders all six
blueprint zones 1:1 at 16px tiles (camera zoom 2): shell rooms via
RoomTileRenderer (HQ open office, security jail + infirmary), stamped LimeZu
Home Designs (japanese retreat, news studio — layer1/layer2 examples), a hand
laid city plaza + avenue (city_terrain/city_props/vehicles/generic_buildings
crops), and the helipad platform + helicopter from the vehicles sheet. WASD
moves a LimeZu char (16×32, idle/walk 4-dir); 8 ambient NPCs wander their
zones; walls/furniture/props are AABB solids with door gaps.

**Try generated office today:**

```
http://localhost:8080/?seed=myworld&layout=reference_office&debug=1
```

**Next code task to ship full world:** add `world=blue` URL param in `office-scene.js` that reads `full-world-blueprint.json`, calls `RoomTileRenderer` per zone, and loads `singles/<theme>/` for furniture.

## NPC assignment (optional)

Map zones to roles from [NPCS.md](NPCS.md):

| Zone | Suggested NPCs |
|------|----------------|
| dolonia_hq | Engineering, PM, leadership |
| japanese_retreat | Bob (research quiet space) or player-only |
| security_complex | Bouncer, Dan, Oscar |
| news_studio | Sarah, Rob |
| city_plaza | Lucy (reception transitions), ambient wander |
| helipad | Oscar / Bouncer patrol exterior |

## Related docs

- [ROOM_GENERATOR.md](ROOM_GENERATOR.md) — single-room furniture rules
- [WORLD_ENGINE.md](WORLD_ENGINE.md) — `generateWorld()` + recipes
- [CITY_GENERATOR.md](CITY_GENERATOR.md) — outdoor streets and lots
- [LAYOUT_AND_REFERENCE.md](../LAYOUT_AND_REFERENCE.md) — why catalog ≠ layout
