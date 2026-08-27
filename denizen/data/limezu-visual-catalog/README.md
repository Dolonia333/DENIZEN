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
  montages-manifest.json
  montages/<SheetName>/
    index.json / me-vocab.json / vision-links.json
    mosaic_*.png                      # regenerable, gitignored
  sheets/<SheetName>/
    meta.json
    labels.json               # vision labels (tracked)
    _overview.jpg / band_*.jpg  # regenerable, gitignored
```

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

## Next (exteriors only)

1. Convert more district stamps from raw PNG paths → `me.*` / `exs.*`
2. Atlas pack for exterior Singles used by `city-plan.json` (fewer GETs)
3. Multi-tile stamp groups from `me.*` + sibling singles
