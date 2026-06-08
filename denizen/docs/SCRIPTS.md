# Denizen — Scripts Toolchain

> `scripts/` is the asset pipeline — the offline workshop that turns raw
> sprite sheets into the catalogs and manifests the game reads at runtime.
> This doc separates the scripts you actually run from the
> archaeological ones that linger as exploration scratch.

`scripts/` is **not** part of the runtime. The game server (`server.js`)
never invokes these. They run on your developer machine, write JSON +
PNG artifacts into the repo, and the game picks those up.

## TL;DR — pipeline a contributor actually runs

For a fresh asset import (e.g. dropping in a new LimeZu sheet pack):

```bash
# 1. Slice every sheet into per-sprite PNGs
pwsh scripts/extract_all_sheets.ps1

# 2. Build the canonical catalog
python scripts/build_master_catalog.py

# 3. (Optional) AI-label any sprites that ended up with bad/missing tags
python scripts/label_sprites_ai.py

# 4. Generate visual reference montages (contact sheets) for QA
python scripts/make_sprite_mosaics.py

# 5. Build the browser-side singles manifest for the asset browser UI
node scripts/build_singles_manifest.js
```

Everything else in `scripts/` is either secondary, one-shot, or archaeological.

## Operations & verification scripts

This section documents the production/local-ops scripts that are easy to miss if you only run the asset pipeline.

For deployment flow, see [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md).

### `deploy-production.ps1` (full deploy orchestrator)

Purpose:

- Loads `.env.production`
- Runs migrations
- Verifies schema (SQL + optional REST)
- Runs basic Denizen API smoke checks
- Emits JSON report and exits non-zero on failure

PowerShell:

```powershell
.\scripts\deploy-production.ps1
```

Optional:

```powershell
.\scripts\deploy-production.ps1 -SkipHttpVerification
```

Expected success signal:

- JSON output with `"status": "PASS"`
- `summary.failed` equals `0`

### `apply-all-migrations.ps1` (deterministic migration runner)

Purpose:

- Applies migration `20260606000012` as `postgres`
- Applies migration `20260606000013` as `supabase_admin`
- Applies `20260606000014+` by inferred role

PowerShell (local Docker mode):

```powershell
.\scripts\apply-all-migrations.ps1
```

PowerShell (remote/prod URL mode):

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require"
.\scripts\apply-all-migrations.ps1 -DbUrl $env:SUPABASE_DB_URL
```

Expected success signal:

- Console line: `All targeted migrations applied successfully.`

### `apply-migration-admin.ps1` (single admin migration)

Purpose:

- Applies one migration file as `supabase_admin` against local Docker Postgres.

PowerShell:

```powershell
.\scripts\apply-migration-admin.ps1 "supabase\migrations\20260606000013_platform_tables_admin.sql"
```

Expected success signal:

- Console line: `Applied <migration-file> as supabase_admin`

### `verify-production-schema.js` (schema verification report)

Purpose:

- REST HEAD checks for required Supabase tables
- Optional DB object checks when `SUPABASE_DB_URL` is set

PowerShell:

```powershell
node .\scripts\verify-production-schema.js
```

Expected success signal:

- JSON output with `"status": "PASS"` and `"failed": 0`

### `smoke-onboarding.js` (visitor onboarding smoke)

Purpose:

- Verifies visitor access codes, session creation, anti-spoof behavior, assistant claim token checks, and demo restrictions.

PowerShell:

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8080"
node .\scripts\smoke-onboarding.js
```

Expected success signal:

- Per-check lines prefixed with `PASS`
- Final line: `All <n> smoke checks passed.`

### `smoke-spine-e2e.js` (intelligence spine smoke)

Purpose:

- Verifies health fallback behavior
- Checks `/api/job-crm/maintenance` response shape
- Checks `/api/intelligence/prediction-summary`

PowerShell:

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8080"
node .\scripts\smoke-spine-e2e.js
```

Expected success signal:

- `PASS` lines for each check
- Final line: `Smoke spine summary: pass=<n> fail=0`

### `robinhood-live-smoke.js` (live auth + watchlist + suggestion smoke)

Purpose:

- Verifies market auth status
- Seeds default watchlist when needed
- Adds `NVDA` to watchlist
- Creates and verifies a DB-backed trade suggestion marker

PowerShell:

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8080"
node .\scripts\robinhood-live-smoke.js
```

Expected output modes:

- If not authenticated: JSON output with OAuth connect URL and rerun guidance
- If authenticated and healthy: JSON output with `"ok": true`
- On failure: JSON output with `"ok": false` and non-zero exit

### Common ops sequence (pre-deploy)

```powershell
.\scripts\apply-all-migrations.ps1 -DbUrl $env:SUPABASE_DB_URL
node .\scripts\verify-production-schema.js
npm run test:visitor
node .\scripts\smoke-onboarding.js
node .\scripts\smoke-spine-e2e.js
```

### Compute mesh smokes

Run against a live Denizen server. Default URL is `http://127.0.0.1:8081` in the Dolonia lab (`PORT=8081` in `.env`).

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8081"
node .\scripts\smoke-mesh-complete.js
node .\scripts\smoke-mesh-jobs-flow.js
node .\scripts\smoke-nas-fleet.js
node .\test-compute-integration.js
node .\scripts\smoke-credit-economy.js
```

| Script | Checks |
|--------|--------|
| `smoke-mesh-complete.js` | Session, node register/claim/complete, contribution flow (~13 checks) |
| `smoke-mesh-jobs-flow.js` | Enqueue → queue progress lifecycle (~5 checks) |
| `smoke-nas-fleet.js` | Fleet report token, NAS metrics in `/api/health` (~4 checks) |
| `test-compute-integration.js` | Queue transitions, HTTP routes, mocked DB (~33 checks) |
| `smoke-credit-economy.js` | Compute credit accrual and contribution tracker |

Full mesh deploy + smokes in one command (from repo root):

```powershell
py infra/finish-all-mesh.py
```

See [COMPUTE_MESH.md](COMPUTE_MESH.md), [../../infra/README.md](../../infra/README.md), and [TESTING.md](TESTING.md).

### Desktop smokes

Verify Denizen Desktop onboarding, feedback API, and release readiness against a running server:

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8081"
node .\scripts\smoke-desktop-onboarding.js
node .\scripts\smoke-desktop-feedback.js
node .\scripts\smoke-desktop-release.js
```

| Script | Checks |
|--------|--------|
| `smoke-desktop-onboarding.js` | Demo session, desktop client headers, org policy, local-client gating |
| `smoke-desktop-feedback.js` | Feedback submission endpoint and session auth |
| `smoke-desktop-release.js` | `desktop/package.json` publish config, workflow files, auto-updater; chains feedback smoke |

`smoke-desktop-release.js` is also the pre-tag gate for [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml).

### Catalog scripts (openplan pipeline)

For the Modern Office openplan furniture catalog. Full workflow: [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md).

```powershell
# Rebuild v2 objects from sheet extract + placement mappings
npm run catalog:rebuild

# Validate objects + placements (overlap, duplicate rects, parent refs)
npm run validate:catalog
npm run validate:catalog:strict

# Merge v2 objects into live catalog
npm run catalog:merge

# Snap placement coordinates to grid
npm run catalog:snap

# Build singles manifest for modern office assets
npm run catalog:singles
```

| Script | Purpose |
|--------|---------|
| **`build_openplan_v2_catalog.py`** | Builds `furniture_catalog_openplan_v2.objects.json` from sheet extract + existing placements; emits `catalog_id_migration.json` |
| **`validate-catalog.mjs`** | CLI validation — overlapping rects, duplicate rects, placement ID refs, `parentInstanceId` chains |
| **`merge-catalog.mjs`** | Merges v2 `objects` into `furniture_catalog_openplan.json` while preserving `placements` |
| **`snap-placements.mjs`** | Snaps placement x/y to grid (--write to persist) |
| **`build-modern-office-singles-catalog.js`** | Scans modern office singles → catalog entries |
| **`extract_sheet_objects.py`** | Connected-component extract from sheet PNG → per-sprite rects JSON (step 1 of pipeline) |

Browser tools (serve from **multbot repo root** on port 8080):

- `sprite-labeler.html` — label sprites, export v2 objects
- `verify-sprites.html` — visual crop QA
- `catalog-explorer.html` — schema reference and overview

## Pipeline overview

```
   raw sheets (assets/*.png)
            │
            ▼
   extract_all_sheets.ps1  ──┐ orchestrator
   extract_sheet_objects.py  ┘ background removal + bounding box → per-sprite PNGs
            │
            ▼
   slice_sheet_scanner.py   (grid variant of the above, for grid-aligned sheets)
            │
            ▼
   build_master_catalog.py  ──▶ assets-catalog.json + assets-catalog.scanned.json
            │
            ├── label_sprites_ai.py        (AI labels via a vision model)
            ├── autolabel_from_path.py     (heuristic labels from filename)
            └── patch_catalog_labels.py    (manual fixes to specific entries)
            │
            ▼
   build_ui_catalog.py      ──▶ ui-windows.json   (filtered subset for in-game UI)
            │
            ▼
   make_sprite_mosaics.py   ──▶ montage_*.png + montage_*.map.json  (visual reference)
            │
            ▼
   build_singles_manifest.js  ──▶ data/singles-manifest.json  (browser UI manifest)
```

## What each script actually does

### Sprite extraction (essential)

| Script | Purpose |
|---|---|
| **`extract_all_sheets.ps1`** | PowerShell orchestrator — walks the `assets/` directory and calls `extract_sheet_objects.py` on every sheet. The right entry point for a bulk import. |
| **`extract_sheet_objects.py`** | Auto-extracts sprites from a sheet via background removal + connected-component bounding boxes. Writes one PNG per sprite into a singles directory. Works on irregular-layout sheets. |
| **`slice_sheet_scanner.py`** | Grid-aware variant of the above for sheets that *are* on a regular grid (32px / 48px tiles). Faster and more accurate when the grid is consistent. |

### Catalog building (essential)

| Script | Purpose |
|---|---|
| **`build_master_catalog.py`** | Reads every single-sprite PNG, builds the master catalog (`assets-catalog.json`) with one entry per sprite. Each entry has filename, dimensions, semantic labels (direction, variant, anim_state, entity_type), and source sheet. **This is the file the game reads at runtime.** |
| **`build_ui_catalog.py`** | Filters the master catalog down to UI-only sprites (windows, dialog frames, etc.) and writes `ui-windows.json`. |
| **`build_singles_manifest.js`** | Node utility: scans the singles directory, writes a thin JSON manifest the browser-side asset browser (`asset-browser.html`) consumes. Run after the catalog so the manifest matches. |

### Labeling (often needed)

| Script | Purpose |
|---|---|
| **`label_sprites_ai.py`** | Sends each sprite to a vision model and stores the returned labels. Use when filename heuristics aren't enough (e.g. third-party packs with unhelpful names like `tile_0042.png`). |
| **`autolabel_from_path.py`** | Heuristic fallback: parses labels out of filenames + folder structure. Cheap, no API calls, often "good enough." |
| **`patch_catalog_labels.py`** | Apply manual corrections to specific entries — useful when an AI label is wrong but everything else is fine. |
| **`auto_tag_objects.py`** | Assigns higher-level tags (`furniture`, `decor`, `prop`, `tile`) on top of the AI/heuristic labels. |

### Visual reference (good for QA)

| Script | Purpose |
|---|---|
| **`make_sprite_mosaics.py`** | Generates `montage_*.png` contact sheets — one big image showing every sprite of a given category. Pair with `montage_*.map.json` which maps mosaic pixel coords back to sprite IDs. |
| **`make-montage.js`** | Node variant — same idea, used when you want a single montage from a JSON-described set. |

### Cleanup / data hygiene

| Script | Purpose |
|---|---|
| **`cleanup_bad_names.py`** | Renames sprites whose filenames contain invalid characters or duplicates. |
| **`detect_bad_crops.py`** | Flags sprites whose bounding boxes look wrong (likely failures from `extract_sheet_objects`). |

### Archaeological / one-shot (don't run these by default)

These exist for historical reasons. If you're confused why they're here:
they were used once to bootstrap the catalog and stayed in case the same
problem comes back. Skim before deleting.

- `crop-tile.js` — manual single-tile cropper
- `match-tile.js`, `match_tile.py`, `reference_match.py` — template-match
  algorithms for finding "this sprite looks like that one"
- `pick-office-props.js`, `pick_*.png`, `pick2_*.png` — manual picker UI
- `match_*.png`, `match_chair_tx4_ty8.png`, `match_monitor_tx4_ty28.png`
  — outputs from earlier match runs
- `chair_crop*.png`, `chair_try_*.png` — chair-extraction experiments
- `export_aseprite_prefabs.ps1` — Aseprite-specific export (only useful
  if you're building prefabs in Aseprite)
- `export_catalog_sprites.js` — re-exports a subset of the catalog to PNG
- `add_mo_singles_to_catalog.py`, `add_all_mo_sizes_to_catalog.py` — bulk
  population helpers from the initial import
- `scan-sprites.js` — early scanner, superseded by `extract_sheet_objects`
- `*.scan.json`, `*.grid32.json`, `*.grid48.json`, `*.scan16.json`,
  `*.scan32.json`, `*.scan48.json` — output dumps from past scans
- `montage_*.png` / `montage_*.map.json` — past montages, regenerated by
  `make_sprite_mosaics.py`

## Languages + dependencies

| Lang | Why | Install |
|---|---|---|
| Python 3 | Most extraction + cataloging scripts | `pip install pillow numpy` (basic), plus `requests` if you use AI labeling |
| Node.js | A few JS-only utilities (catalog + manifest builders, montage maker) | `npm install` inside `scripts/` reads `scripts/package.json` |
| PowerShell | Two orchestrators (`extract_all_sheets.ps1`, `export_aseprite_prefabs.ps1`) | Pre-installed on Windows; `pwsh` on Linux/macOS |

`scripts/package.json` + `scripts/node_modules/` exist for the Node side.
Run `npm install` from inside `scripts/` if you're going to run any of
the `.js` scripts.

## Adding a new script

1. Put it in `scripts/`. Pick the language that fits — Python for image
   manipulation, Node for JSON/catalog work, PowerShell only for
   filesystem orchestration that's already PowerShell-y.
2. **Document the inputs and outputs at the top of the file** in a
   comment block. The existing scripts mostly do this; new ones should.
3. If it's part of the canonical pipeline, add it to the **TL;DR**
   section at the top of this doc.
4. If it's a one-shot exploration, add it to the **archaeological**
   section so future readers know not to run it by default.

## See also

- [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) — openplan extract → label → validate → ship
- [TOOLS_GUIDE.md](../TOOLS_GUIDE.md) — the in-browser tools (Sprite
  Cutter, Catalog Explorer, Asset Browser) that consume the artifacts
  these scripts produce
- [ENGINE_AND_SPRITES.md](../ENGINE_AND_SPRITES.md) — Phaser scene
  lifecycle + sprite sheet formats, i.e. how the catalog gets used at
  runtime
- [CATALOG_OVERVIEW.md](../CATALOG_OVERVIEW.md) — what the LimeZu pack
  contains, before this pipeline runs
- [CATALOG_CONVENTIONS.md](../CATALOG_CONVENTIONS.md) — the field
  vocabulary the catalog uses
- [TESTING.md](TESTING.md) — mesh/desktop smoke run order
- [COMPUTE_MESH.md](COMPUTE_MESH.md) — compute mesh architecture
