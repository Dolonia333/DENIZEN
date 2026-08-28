# Modern Exteriors — outside-office mistake inventory

Audit of the played city (`?world=full` → `data/city-plan.json`).  
**Scope: exteriors only.** Verified after merge on this branch.

## QA gate (`scripts/check-city-plan.py`)

| When | Defects |
|------|---------|
| Before this pass | **56** (52 OVERLAP + 4 ROADBLOCK) |
| After | **0** (`defects: none`) |

Merge now prints the QA report after writing the plan.

### Fixed this pass

**ROADBLOCK (4 → 0)** — collision solids covering the street grid  
- `d4-foodmarket`: canal solid crossed N–S road at x=896 → shrunk width to stop at the curb  
- `d11-industrial`: east fence solid sat in the road lane → moved to x=5120  
- `d3-station`: two grass solids straddled the main avenue → capped height above y=1872  

**OVERLAP (52 → 0)** — categories and fixes  
- **Structure vs district (24):** stronger prune in `merge-city-plan.py` (baseline + ≥25% sprite overlap) drops auto lamps/trees/lights that land in district footprints  
- **District vs district:** nudged hotel forecourt props, condo street furniture, camping trees, military tires, residential bushes/lamps, school/palm, graveyard cross; junkyard barrels/wrecks marked `solid: false` (visual clutter, walkable)  

## Systemic mistakes (still true — not all are QA defects)

These are the bigger “outside the office looks wrong / unfinished” issues beyond rect overlap:

1. **Stamp collage, not composed scenes** — most districts place one-off Singles at hand-picked XY. LimeZu contact-sheet compositions were never reconstructed as stamp groups (`multi_tile` is catalog-only).
2. **~571 unique Singles used of 6224** (~9%) — the city barely samples the exterior pack.
3. **No texture atlas** — each stamp is its own GET; load is slow (~minutes of PNGs on cold cache). Dossier notes this.
4. **Stale district `bbox` metadata** — mixed `{x,y,w,h}` vs `{x0,y0,x1,y1}`; `relocate-district.py` never updates bbox (e.g. camping stamps vs declared bbox). Phantom district overlaps in docs.
5. **Two “city” systems** — played world = `city-plan.json` + `full-world.js`. `src/city/cityGenerator.js` is tooling-only and unused by `?world=full`.
6. **Deploy gap** — `infra/deploy-full-world-nas.py` historically omitted `city-plan.json` / `city-specs/` (verify before NAS ship).
7. **Catalog not yet on most districts** — only d00 structure + beach pilots use `me.*`; other districts still hardcode PNG paths.
8. **Tiny fragment Singles** — hundreds of ≤16×32 stamps exist in the pack; a subset in the plan can still look “cut off” if used alone (placement-logic / visual judgment).
9. **`?world=full` + demo mode** — forcing full world may still reset visitor session depending on office entry path (product bug called out earlier; confirm in `office-scene.js` if still present).
10. **Placement-logic advisories** (non-blocking): wall-mount suspects e.g. billboard / traffic sign without a nearby facade.

## How to re-check

```bash
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py          # prints QA at end
python3 scripts/check-city-plan.py          # exit 0 when clean
python3 scripts/audit-placement-logic.py    # advisory roles
```

## Catalog status (exteriors)

| Layer | Status |
|-------|--------|
| Theme sheet vision labels | 24/24 · 2749 `me.*` |
| Singles pixel-perfect | 6224/6224 · 88.8% sheet-matched |
| Singles → `me.*` | 6224/6224 |
| Placement index → city merge | wired (`me`/`exs` resolve to `img`) |
| City QA | **clean** |
