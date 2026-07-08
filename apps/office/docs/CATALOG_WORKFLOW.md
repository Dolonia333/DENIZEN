# Catalog workflow — Modern Office openplan

Single pipeline for rebuilding and verifying `furniture_catalog_openplan.json` objects from the Black Shadow 32×32 sheet.

## Prerequisites

Serve from the **Denizen repo root** so sheet PNGs and JSON load:

```powershell
cd c:\Users\zionv\OneDrive\Desktop\Denizen
python -m http.server 8080
```

Open tools under `http://localhost:8080/denizen/`.

## Pipeline

```
Sheet PNG
  └─ extract_sheet_objects.py  →  out/sheet_extract/modern_office_black_shadow_32.objects.json (199 rects)
       └─ sprite-labeler.html   →  label IDs, export furniture_catalog_openplan_v2.objects.json
            └─ validate-catalog.mjs  →  overlap + placement checks
                 └─ verify-sprites.html  →  visual crop check
                      └─ merge into data/furniture_catalog_openplan.json (keep placements[])
```

### 1. Extract (once per sheet change)

```powershell
cd apps/office
py -3 scripts/extract_sheet_objects.py `
  "..\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\2_Modern_Office_Black_Shadow\Modern_Office_Black_Shadow_32x32.png" `
  --grid 32 --snap `
  --out out/sheet_extract/modern_office_black_shadow_32.objects.json
```

Output: `out/sheet_extract/modern_office_black_shadow_32.objects.json` — one rect per connected sprite, no fragments.

### 2. Label (`sprite-labeler.html`)

1. Open `http://localhost:8080/denizen/sprite-labeler.html`
2. Select **Black Shadow 32×32** — loads extract JSON + pre-fills IDs from the current catalog where rects match.
3. Set **Catalog ID** and **Type** for each sprite. Cards with **overlap** badges share pixel rects with another labeled entry — fix before export.
4. **Save catalog** downloads `furniture_catalog_openplan_v2.objects.json`.

### 3. Validate

```powershell
cd apps/office
npm run validate:catalog
```

Checks: overlapping rects, duplicate rects, placement IDs exist, `parentInstanceId` refs (when present).

### 4. Verify visually (`verify-sprites.html`)

Open `http://localhost:8080/denizen/verify-sprites.html` — crops every catalog entry. Use the status bar to compare v1 vs v2 and spot overlap warnings on cards.

### 5. Ship

1. Copy exported `objects` into `data/furniture_catalog_openplan.json` (or replace with v2 + existing `placements`).
2. Update `data/catalog_id_migration.json` if object IDs changed.
3. Re-run `npm run validate:catalog` until it passes.
4. Reload the game (`?layout=openplan`) and confirm props render correctly.

## Key files

| File | Role |
|------|------|
| `out/sheet_extract/modern_office_black_shadow_32.objects.json` | Auto-extracted rects (source of truth for regions) |
| `data/furniture_catalog_openplan.json` | Live catalog — objects + placements |
| `data/furniture_catalog_openplan_v2.objects.json` | Clean labeled objects export (no placements) |
| `data/catalog_id_migration.json` | Old ID → new ID map for placement migration |
| `scripts/validate-catalog.mjs` | CLI validation |
| `sprite-labeler.html` | Label + export |
| `verify-sprites.html` | Visual QA |
| `catalog-explorer.html` | System overview + schema reference |

## Conventions

- Sheet key: `mo_black_shadow_32`
- Origin: `bottom` (bottom-center anchor)
- Depth: `1.5` furniture/surface, `1.6` seats, `2.0` desk decor
- Types: `surface`, `seat`, `decor`, `furniture`, `partition`
- Actions: `use_computer` (desks), `seat` (chairs)
