# LimeZu visual catalog

Vision-labeled inventory of **Modern Exteriors** theme contact sheets (24/24) for DENIZEN city generation, plus a **pixel-perfect Singles** inventory (every official cutout PNG).

## Status

| Pack | Coverage | Count |
|------|----------|------:|
| Theme sheets labeled (`ext/themes/*.png`) | **24 / 24** | **2749** semantic objects |
| Singles pixel-perfect (`ext/singles/`) | **6224 / 6224** inventoried | **5527** exact sheet placements |
| Interiors (`themes/*.png`) | 0 / ~26 | pending |

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

## Layout

```
data/limezu-visual-catalog/
  README.md
  sheets-manifest.json
  registry.jsonl              # vision objects (me.*)
  registry-summary.json
  ext-singles-pixelperfect.jsonl      # one row per Single PNG
  ext-singles-pixelperfect-summary.json
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
  "vision_link": { "me_id": "me.worksite.bucket", "score": 5.5 }
}
```

- `match_status`: `unique` | `multi` (same cutout appears more than once on the contact sheet) | `unmatched` (Single exists in pack but is not an exact RGB stamp on that theme sheet — common for color variants)
- All canvases are 16px-aligned; `content_bbox` is the opaque footprint inside the canvas

## Next

1. Montage vision pass to harden weak `vision_link`s (filename heuristics only today)
2. Label interior theme sheets the same way
3. Wire `exs.*` registry into `compile-city-structure` / district recipes / atlases
