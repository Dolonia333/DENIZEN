# LimeZu visual catalog

Vision-labeled inventory of **Modern Exteriors** theme contact sheets (24/24) for DENIZEN city generation.

## Status

| Pack | Sheets labeled | Objects |
|------|----------------|--------:|
| `limezu_modern_exteriors` (`ext/themes/*.png`) | **24 / 24** | **2749** |
| Interiors (`themes/*.png`) | 0 / ~26 | pending |
| Singles file↔id linking | pending | use `notes` + filename hints |

Regenerate band previews (gitignored JPGs):

```bash
python3 scripts/slice-limezu-sheets-for-vision.py --pack exteriors
node scripts/merge-limezu-visual-catalog.js
```

## Layout

```
data/limezu-visual-catalog/
  README.md
  sheets-manifest.json
  registry.jsonl              # flat stream of all objects
  registry-summary.json
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

## Next

1. Link Singles PNG basenames → `me.*` ids (montage vision pass per folder)
2. Label interior theme sheets the same way
3. Wire registry into `compile-city-structure` / district recipes
