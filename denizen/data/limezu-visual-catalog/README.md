# LimeZu visual catalog

Vision-labeled inventory of **Modern Exteriors** theme contact sheets (24/24) for DENIZEN city generation, plus a **pixel-perfect Singles** inventory (every official cutout PNG).

## Status

| Pack | Coverage | Count |
|------|----------|------:|
| Theme sheets labeled (`ext/themes/*.png`) | **24 / 24** | **2749** semantic objects |
| Singles pixel-perfect (`ext/singles/`) | **6224 / 6224** inventoried | **5527** exact sheet placements |
| Singles → `me.*` links | **6224 / 6224** | spatial/filename + montage vision |
| City placement index | **1295** `me.*` → preferred `img` | merge resolves `me`/`exs` stamps |

**Scope: Modern Exteriors only** (interiors out of scope for this catalog).

Official LimeZu **Singles** are the ground-truth cutouts (do not re-slice contact sheets). Vision labels describe semantic stamps on the sheet; Singles are the placeable PNG units.

Regenerate band previews (gitignored JPGs) + merge vision registry:

```bash
python3 scripts/slice-limezu-sheets-for-vision.py --pack exteriors
node scripts/merge-limezu-visual-catalog.js
```

Rebuild pixel-perfect Singles inventory (alpha bbox + exact sheet XY):

```bash
python3 scripts/catalog-limezu-ext-singles-pixelperfect.py
python3 scripts/catalog-limezu-ext-singles-pixelperfect.py --theme 8_Worksite   # one theme
```

Harden Singles → `me.*` links (spatial + optional montage vision overrides):

```bash
python3 scripts/build-limezu-ext-singles-montages.py --only-weak
# after writing montages/<sheet>/vision-links.json from vision pass:
python3 scripts/link-limezu-singles-to-me.py
```

Build placement index + merge city (resolves `me`/`exs` stamps → `img`):

```bash
python3 scripts/resolve_limezu_me_stamps.py
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py
```

District stamp authoring (exteriors):

```json
{ "me": "me.beach.palm_tree", "x": 3900, "y": 4480, "origin": "bc", "solid": true }
{ "me": "me.city_props.lamp_ornate_double", "prefer": "Street_Lamp_1.png", "x": 100, "y": 200, "origin": "bc" }
{ "exs": "exs.21_beach.beach_palm_tree", "x": 3900, "y": 4480, "origin": "bc" }
```

## Layout

```
data/limezu-visual-catalog/
  README.md
  sheets-manifest.json
  registry.jsonl              # vision objects (me.*)
  registry-summary.json
  ext-singles-pixelperfect.jsonl      # one row per Single PNG
  ext-singles-pixelperfect-summary.json
  ext-singles-link-report.json
  me-to-singles.json                  # reverse index me_id → [singles…]
  placement-index.json                # me/exs → preferred stamp img (merge)
  placement-rules.json                # roles/biomes/palettes/surfaces/interact/density
  placement-rules.schema.json         # validation schema for the above
  group-candidates.json               # ranked multi_tile me.* → grp.* recipe candidates (W0-C)
  groups/
    grp.<theme>.<slug>.json           # fully authored stamp-group recipes (pieces + tile offsets)
  montages-manifest.json
  montages/<SheetName>/
    index.json / me-vocab.json / vision-links.json
    mosaic_*.png                      # regenerable, gitignored
  sheets/<SheetName>/
    meta.json
    labels.json               # vision labels (tracked)
    _overview.jpg / band_*.jpg  # regenerable, gitignored
```

## Placement rules (`placement-rules.json`)

Semantics layer for the exterior placement brain (see
`data/city-specs/EXTERIOR-PLACEMENT-BRAIN-PLAN.md`). One file holds the shared
vocabularies the enrichment pass, the group recipes and the district compiler
all key off: 24 **roles** (what an asset structurally is), the 5 paintable
**surfaces** plus wall/roof/air **mounts**, 14 **biomes** covering all 24 theme
sheets, 11 colour **palettes**, the sit/enter/read/shop/play **interact**
contract, 5 **density** levels, 12 named **slots**, and an ordered list of
`match`→`set` rules that derive all of the above from `registry.jsonl`.

```bash
python3 scripts/validate-placement-rules.py     # schema + refs + rule dry run
```

## Enriched placement rows (`me-placement-enriched.jsonl`)

`scripts/enrich-me-placement-rules.py` (W1-A) replays the `placement-rules.json`
`match`→`set` rules over every row of `registry.jsonl` — same predicate and same
"lower priority runs first, later matches override" ordering the validator's dry
run uses — and folds in the theme→biome map, the surface/mount aliases, the
palette colour tokens and the interact contract. One line per `me.*` (2749),
carrying `role`, `biome_primary` + `biomes_allowed`, canonical `surface`,
`palette_affinity`, `color_tokens` (from the me id and its linked `exs.*`
Singles), `interact`, `group_only`, `confidence` (1.0 rule match / 0.8 category
map / 0.5 fallback) and a `source` trail naming every input that contributed:

```bash
python3 scripts/enrich-me-placement-rules.py            # write the jsonl
python3 scripts/enrich-me-placement-rules.py --stats    # coverage only, no write
python3 scripts/enrich-me-placement-rules.py --validate # exit 1 if <90% role+biome
```

```json
{ "me": "me.beach.volley_net", "role": "decor_small", "biome_primary": "beach",
  "biomes_allowed": ["beach", "leisure"], "surface": "sand",
  "palette_affinity": ["coastal", "festive_market"], "color_tokens": [],
  "interact": "play", "group_only": false, "confidence": 1.0,
  "source": ["theme_biomes", "role_rule:decor_small", "rule:rule.scatter.small_decor",
             "registry.surface", "biome.palettes", "rule.interact"] }
```

Objects whose registry `surface` is a mount (`wall` / `roof` / `air` / `ui` /
`any`) have no paintable surface of their own, so the enricher falls through to
the rules', then the role's, then the biome's surfaces, preferring one the biome
actually paints; the `source` trail records which step answered.

## Label schema (`labels.json`)

```json
{
  "sheet": "9_Shopping_Center_and_Markets",
  "pack": "limezu_modern_exteriors",
  "labeled_by": "vision",
  "objects": [
    {
      "id": "me.shopping.facade_sale_center",
      "name": "Shopping center facade with SALE windows",
      "category": "building",
      "tags": ["retail", "facade", "glass"],
      "band": 0,
      "y_hint": [0, 200],
      "surface": "sidewalk",
      "facing": "south",
      "multi_tile": true,
      "notes": "Place as stamp group, not one 16px single"
    }
  ],
  "row_guide": "brief top-to-bottom description of the sheet"
}
```

## How IDs help generation

- `me.<theme>.<slug>` is stable — city recipes reference IDs, not raw LimeZu filenames
- `multi_tile` + `notes` flag objects that must be stamp **groups**
- `surface` / `facing` / `tags` feed Minecraft-like placement rules
- `exs.<folder>.<slug>` Singles ids map 1:1 to PNGs with pixel-perfect `content_bbox` + optional `sheet_x/y`

## Pixel-perfect Singles row

```json
{
  "id": "exs.8_worksite.bucket_1",
  "basename": "ME_Singles_Worksite_16x16_Bucket_1.png",
  "path": "assets/limezu/ext/singles/8_worksite/ME_Singles_Worksite_16x16_Bucket_1.png",
  "w": 16, "h": 16,
  "content_bbox": [1, 0, 15, 16],
  "sheet_x": 112, "sheet_y": 48,
  "match_status": "unique",
  "vision_link": { "me_id": "me.worksite.bucket", "score": 5.5, "confidence": "high", "source": "spatial_filename" }
}
```

- `match_status`: `unique` | `multi` (same cutout appears more than once on the contact sheet) | `unmatched` (Single exists in pack but is not an exact RGB stamp on that theme sheet — common for color variants)
- All canvases are 16px-aligned; `content_bbox` is the opaque footprint inside the canvas
- `vision_link.source`: `spatial_filename` | `vision` (montage override). Confidence: `high` | `medium` | `weak` | `vision`

## Stamp group candidates (`group-candidates.json`)

`scripts/build-limezu-group-candidates.py` scans all `multi_tile: true` `me.*` labels, pulls
their linked `exs.*` Singles from `me-to-singles.json`, and keeps only those whose siblings
(≥2) co-locate within the same 768px sheet vision-labeling band the `me.*` was labeled in —
i.e. the Singles genuinely form one physical multi-piece composition on the contact sheet
rather than a scattered color/size-variant family. Candidates are ranked by piece count +
bbox fill-ratio (compactness) + assembly-keyword signal, and the top 50 are emitted with a
suggested `grp.<theme>.<slug>` id, `pieces[]` (exs id + tile-unit offset inferred from
`sheet_x`/`sheet_y` when the layout is compact), footprint, biome, and a `priority`
(`high`/`medium`/`low`, ordered for W1-C authoring):

```bash
python3 scripts/build-limezu-group-candidates.py
```

## Authored group recipes (`groups/*.json`)

Fully hand-authored `grp.*` stamp-group definitions — used both for mechanically-detected
candidates (e.g. `me.subway.stairs_modular_set`) and for cross-`me.*` composite scenes whose
pieces are scattered across the sheet and have no usable spatial relationship (e.g. a
campfire + folding chairs + stumps). Each recipe lists `pieces[]` with `me`/`exs` id, a tile
(`dx`/`dy`, 16px = 1 tile) offset from the group footprint's top-left, and an
`offset_basis` of `sheet_relative` (derived from the Singles' real `sheet_x`/`sheet_y`,
valid when LimeZu laid the pieces out on the sheet in their composed arrangement) or
`authored` (hand-placed, when the pieces are unrelated on the sheet). See:

- `groups/grp.beach.volley_court.json` — net + 8 modular sand-court line tiles + ball
- `groups/grp.camping.campfire_set.json` — lit fire + folding chairs + stumps + firewood
- `groups/grp.subway.station_stairs.json` — railed stairwell + support pillar + tactile edge

## Next (exteriors only)

1. Convert more district stamps from raw PNG paths → `me.*` / `exs.*`
2. Atlas pack for exterior Singles used by `city-plan.json` (fewer GETs)
3. Author the remaining `grp.*` recipes from `group-candidates.json` (W1-C, ≥20 groups)
4. Keep `check-city-plan.py` clean (see `data/city-specs/EXTERIOR-MISTAKES.md`)
