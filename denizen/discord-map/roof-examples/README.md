# Roof examples

Hand-authored roof layouts used by `drawRoofCap` in `game.js`.

## Edit visually

1. Open **`denizen/tools/roof-composer.html`** in a browser (from a local static server if file:// blocks images).
2. Choose family/color → **Load code layout**.
3. **Drag** tiles, **Cut** a box to carve a custom mid piece, nudge with arrows.
4. **Export PNG** (visual example) + **Export JSON** (recipe).
5. Drop the JSON here (or replace `gable-default.json` / `flat-default.json`) and have the agent bake it into `game.js`.

## Files

| File | Used for |
|------|----------|
| `gable-default.json` | Roof_1 pitched packing knobs (baked into `roofRecipeFor`) |
| `flat-default.json` | Roof_2 slab packing knobs |
| `gable-red-example.png` | Visual starter example (composer-equivalent pack) |
| `gable-red-example.json` | Matching piece list for that PNG |
