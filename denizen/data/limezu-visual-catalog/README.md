# LimeZu visual catalog

Vision-labeled inventory of Modern Exteriors theme sheets → durable IDs for city generation.

## Layout

```
data/limezu-visual-catalog/
  sheets-manifest.json          # band slices for every theme sheet
  sheets/<SheetName>/
    _overview.jpg
    band_XX_yA-B.jpg
    meta.json
    labels.json                 # vision labels for this sheet
  singles-montages/             # optional contact sheets of Singles
  registry.jsonl                # flat id → record stream (merged)
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
      "shadow_variant": "unknown",
      "notes": "Place as stamp group, not one 16px single"
    }
  ],
  "row_guide": "Top→bottom narrative of the contact sheet"
}
```

## How to continue

1. Regenerate bands: `python3 scripts/slice-limezu-sheets-for-vision.py`
2. Label a sheet with an agent that can see `band_*.jpg` images
3. Write `labels.json` next to the bands
4. Merge: `node scripts/merge-limezu-visual-catalog.js`
