# AI Office Blueprint — recreating the hand-built office

You built the Hu4Gzs open-plan office by hand (furniture editor + wall JSON + floor tuning in code). Denizen can now recreate it from **`data/office_blueprint.json`**.

## Single source of truth

| Layer | Where it lives | What it is |
|-------|----------------|------------|
| **Blueprint manifest** | `data/office_blueprint.json` | Merges all layers — start here |
| **Floors** | `office_blueprint.json` → `floors[]` | 7 tileSprite zones (was hardcoded in `office-scene.js`) |
| **Walls** | `data/openplan_walls.json` | 9 segments, door gaps at x=848 divider |
| **Furniture** | `data/furniture_catalog_openplan.json` → `placements` | 89 hand-placed items (`editor_*` instanceIds) |
| **Sprite defs** | same catalog → `objects` | Pixel rects on `mo_black_shadow_32` sheet |
| **Zones** | `data/openplan_zones.json` | Semantic regions (open_plan, lounge, break_area, …) |
| **Spawn points** | `office_blueprint.json` → `spawnPoints` | Player + NPC anchors |

Regenerate the blueprint after editing placements or walls:

```bash
cd apps/office
node scripts/build-office-blueprint.mjs
```

## How the game loads it

Default URL: `?layout=openplan` (no query needed).

1. **Floors** — `office_blueprint.json` floors (fallback: inline `floorZones` in `office-scene.js`)
2. **Walls** — `openplan_walls.json` via `OpenplanWalls.renderLayout`
3. **Furniture** — `furniture_catalog_openplan.placements` (or `/api/layout` if saved per-session)

## Recreate checklist (Fable / agents)

To build a **copy** or **variant** of this office:

1. Copy `office_blueprint.json` → `office_blueprint_myvariant.json`
2. Keep `floors` + `walls.segments` unless changing room shape
3. Edit `furniture.placements` — only use IDs that exist in `furniture_catalog_openplan.objects`
4. Run `npm run validate:catalog`
5. Test: `http://localhost:8888/?layout=openplan`

### Placement rules

- Anchor: **bottom-center** at `(x, y)`
- Grid: 32px for furniture alignment
- Decor on desks: either separate placement at desk coords, or `parentInstanceId` (not used in current 89 placements)
- Door gaps in walls must stay clear — see `openplan_walls.json` `doorGaps`

### Zone map (where things belong)

| Zone | Bounds (approx) | Furniture tags |
|------|-----------------|----------------|
| `open_plan` | x:52–848, y:128–448 | cubicle_desk, divider, chair_, desk_setup |
| `lounge` | SW corner | sofa, corner_sofa, money_ |
| `break_area` | South center | vending, waiting chairs, water_dispenser |
| `side_office_left` | NE | manager desk, money_, cert_ |
| `side_office_right` | SE | coffee_machine, cork_board, bookshelf |
| `top_wall_decor_band` | North strip | whiteboard, bookshelf, ac_unit |

Full bounds: `openplan_zones.json`.

## What was broken before

- Floors lived only in `office-scene.js` (invisible to AI)
- `room-templates.json` → `reference_office_main` had **different coordinates** (stale)
- `openplan_rebuild.json` was a spec, not wired as one loadable file
- No `/layouts/` save on disk unless you POST to `/api/layout`

## Editor workflow (how you built it)

1. `Ctrl+Shift+E` on localhost — furniture editor
2. Drag props from catalog
3. Press **X** — download placements JSON
4. Merge into `furniture_catalog_openplan.json` → `placements`
5. Walls: wall editor mode → `openplan_walls.json`

## Reference image

`assets/ref_Hu4Gzs.png` — visual target for matching layout.
