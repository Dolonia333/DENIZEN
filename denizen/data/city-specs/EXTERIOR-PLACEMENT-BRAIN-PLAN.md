# Exterior Placement Brain — Master Build Plan

**Scope:** Modern Exteriors only (`assets/limezu/ext/`). Interiors / Modern Office out of scope.

**Goal:** Replace hand-stamped PNG collage with a **catalog-driven compiler** that understands what assets are, where they belong, how variants/colors fit biomes, how groups assemble, and how players interact — while using far more of the 6224 Singles.

**Current baseline (this branch):**
- Visual catalog: 24/24 sheets, 2749 `me.*`, 6224 `exs.*`, full Singles→`me.*` links
- `placement-index.json` + merge resolves `me`/`exs` → `img`
- `check-city-plan.py`: **0 defects** on merged plan
- City still uses **~571 / 6224** Singles (~9%); layout is hand-authored `d*.json`

**Denizen MCP:** Not connected in cloud agent VM — NPC wake / bridge tasks deferred until NAS/desktop MCP available.

---

## What “placement brain” means (target)

| Layer | Delivers | Status |
|-------|----------|--------|
| L0 Dictionary | `me.*` / `exs.*` ids, paths, bboxes | **Done** |
| L1 Semantics | role, category, biome, palette, surface, interact | **Schema done** (W0-A) |
| L2 Groups | `grp.*` recipes (multi-tile assemblies) | **Planned** |
| L3 World model | districts = biome + palette + slots + density | **Planned** |
| L4 Compiler | rules → stamps + interactions | **Planned** |
| L5 QA | overlap, biome violations, coverage gates | **Partial** (overlap only) |
| L6 Runtime | sit / enter / read / shop hooks | **Planned** |
| L7 Atlas | packed PNG atlas for load perf | **Planned** |

---

## Sub-agent orchestration (1-pass build)

### Wave 0 — Plan + scaffold (parallel, no deps)
| ID | Group | Task | Output | Model tier |
|----|-------|------|--------|------------|
| W0-A | Schema | `placement-rules.schema.json` + biome/theme map | `data/limezu-visual-catalog/placement-rules.json` (skeleton) | Opus thinking |
| W0-B | Coverage | `report-ext-catalog-coverage.py` + baseline report | `data/limezu-visual-catalog/coverage-report.json` | Sonnet thinking |
| W0-C | Groups | Audit top 50 `multi_tile` → group recipe candidates | `data/limezu-visual-catalog/group-candidates.json` | Sonnet thinking |
| W0-D | Compiler | Design doc + empty `compile-exterior-district.py` CLI | `docs/EXTERIOR-COMPILER.md` + script stub | Opus thinking |

**Gate G0:** Parent merges W0 outputs; schema validated; coverage baseline committed.

- [x] **W0-A** — `placement-rules.json` + `placement-rules.schema.json` land the L1/L3
  vocabularies: **24 roles**, **5 surfaces** + 4 mounts, **14 biomes** with all **24**
  theme sheets mapped, **11 palettes** over the 22 colour tokens that actually occur in
  `exs.*` ids, **6 interact** types (5 core + `board`), **5 density** levels, **12 slots**,
  and **29** ordered `match`→`set` rules. Validated by
  `python3 scripts/validate-placement-rules.py` (schema + referential integrity + a dry
  run of the rules over `registry.jsonl`): **0 errors, 2749/2749 `me.*` resolve to a role**,
  which already clears the G1 ≥90% role target.
- [x] **W0-B** — `report-ext-catalog-coverage.py` + baseline `coverage-report.json`
  (6224 singles, 571 used, Tier A–E all NOT MET — expected pre-compiler)
- [x] **W0-C** — `group-candidates.json` (50 ranked multi_tile candidates) +
  3 authored recipes: `grp.beach.volley_court`, `grp.camping.campfire_set`,
  `grp.subway.station_stairs`
- [x] **W0-D** — `docs/EXTERIOR-COMPILER.md` + `compile-exterior-district.py`
  scaffold (passes A/B/H real; C–G stub hooks)

### Wave 1 — Enrichment (depends G0 schema)
| ID | Group | Task | Output | Status |
|----|-------|------|--------|--------|
| W1-A | Enrich | `enrich-me-placement-rules.py` — tag all 2749 `me.*` | `me-placement-enriched.jsonl` | ✅ 100% role+biome |
| W1-B | Variants | `variant-palette-map.json` — color tokens → palette affinity | palette scoring table | ✅ 22 tokens, 30 families |
| W1-C | Groups | Author 20 `grp.*` JSON recipes | `groups/*.json` | ✅ 20 files, 124 pieces |

**Gate G1:** ✅ **done** — 2749/2749 me.* have role + biome; 20 groups validate; variant map OK

### Wave 2 — Compiler v1 (depends G1)
| ID | Group | Task | Output |
|----|-------|------|--------|
| W2-A | Compiler | Implement fill passes: landmarks, props, canopy, street kit | `scripts/compile-exterior-district.py` |
| W2-B | District | Author `d18-beach-compiler-pilot.json` spec (not hand stamps) | district spec format |
| W2-C | Merge | Wire compiler output → existing merge + `me` resolve | merge integration |

**Gate G2:** Pilot biome compiles to `city-plan.json` with 0 QA defects; coverage +200 Singles vs baseline.

### Wave 3 — Biome rollout (parallel per biome, depends G2) ✅
| ID | Biome | Spec | Generated pocket | Stamps |
|----|-------|------|------------------|--------|
| W3-1 | beach | beach.json + beach-shore.json | d18 + d19-beach-shore | 51 + 43 |
| W3-2 | wild | wild.json | d19-wild-camp | 69 |
| W3-3 | urban_core | urban_core.json | d20-urban | 28 |
| W3-3b | commercial | commercial.json | d21-commercial | 46 |
| W3-4 | civic | civic.json | d22-civic | 28 |
| W3-5 | park | park.json | d23-park | 47 |
| W3-6 | residential | residential.json | d24-residential | 45 |
| W3-7 | industrial | industrial.json | d25-industrial | 51 |
| W3-8 | military | military.json | d26-military | 37 |
| W3-9 | memorial | memorial.json | d27-memorial | 74 |
| W3-10 | transit | transit.json | d28-transit | 33 |

**Gate G3:** ✅ All 11 biome specs compile; 12 pockets merged with **0 QA defects**.

### Wave 4 — Interactions + atlas (depends G2 pilot) ✅
| ID | Group | Task | Output | Status |
|----|-------|------|--------|--------|
| W4-A | Runtime | `interact` → `full-world.js` sit/enter/read/shop/play | 19 interactables in plan | ✅ |
| W4-B | Atlas | `build-ext-atlas.py` | 678 imgs → 1 atlas page | ✅ |
| W4-C | QA | `check-city-plan.py` biome + group_only advisories | `--strict-biome` flag | ✅ |

**Gate G4:** Unit tests pass (4/4); browser test deferred to desktop.

### Wave 5 — Denizen integration (when MCP available)
| ID | Task | Offline prep output | Status |
|----|------|----------------------|--------|
| W5-A | `assign_task` NPC patrol routes per biome | `data/city-specs/npc-patrol-routes.json` | ✅ prep done, MCP call pending |
| W5-B | Visual agent pass on compiled districts via montage QA | `data/limezu-visual-catalog/montage-qa-report.json` | ✅ prep done, agent review pending |
| W5-C | Wire `city.limezu_assets` NAS table to enriched catalog | `assets/limezu/_asset-catalog-enriched.json` (+ `.tsv`) | ✅ prep done, NAS run pending |

- [x] **W5-A** — `scripts/build-npc-patrol-routes.py` derives 1-2 patrol
  waypoints per biome (hand-authored `d*.json` bbox center + compiled-pocket
  bbox center) for the 12 biomes with resolvable geometry (all 11 Wave 3
  biomes + `rural`/farm), with a placeholder `npc_role`, a stamp-density
  `dwell_ms`, and `interact_zones` pulled from real interact-tagged stamps.
  Ready for `assign_task`/`delegate_task` (`.cursor/rules/denizen-bridge.mdc`)
  the moment Denizen MCP connects — nothing to derive live, just dispatch.
- [x] **W5-B** — `scripts/montage-qa-compiled-districts.py` renders every
  `data/city-specs/generated/d*.json` fragment via `render-city-preview.py`'s
  real compositor (falls back to stitched stamp thumbnails on a render
  failure) and runs `check-city-plan.py`'s exact defect checks against each
  fragment in isolation (resolving `me`/`exs` → `img` first, same as
  `compile-exterior-district.py --qa`), writing per-fragment stamp/biome/
  defect counts to `montage-qa-report.json`. CLI exits 1 on any hard defect
  (OVERLAP/FLOATING/ROADBLOCK/OFFWORLD/BADANIM/UNRESOLVED) — a visual agent
  still needs to eyeball the renders once MCP is up, but the mechanical gate
  runs today.
- [x] **W5-C** — `scripts/export-limezu-assets-catalog.py` builds
  `assets/limezu/_asset-catalog-enriched.json` (+ `--tsv`): all 6224 `exs.*`
  Singles, `{path, kind, theme, w, h, tags, me, biome, role}`, 100%
  `me`/`biome`/`role` resolved. Schema-compatible with (superset of)
  `infra/setup-city-db-nas.py`'s `city.limezu_assets(path,kind,theme,w,h)` —
  script docstring documents the `ALTER TABLE` + COPY steps to run against
  the live NAS once the bridge is back; nothing there is touched yet.

**Bridge stub:** `data/cursor-bridge-queue.jsonl` now carries one
`status: "template"` row (ignored by `list_cursor_work`'s default `pending`
filter) documenting the real persisted row shape and pointing at the three
W5 outputs above — see `docs/DENIZEN_CURSOR_BRIDGE.md` "Row template".

### Wave 6 — Coverage push (depends G3)
| ID | Task | Output | Status |
|----|------|--------|--------|
| W6-A | Catalog coverage showcase — sweep every orphan `me.*` into empty world space | `scripts/compile-coverage-showcase.py` → `generated/d99-catalog-showcase.json` | ✅ 731 stamps, 0 QA defects |

**W6-A notes.** The showcase discovers its own zones at runtime (maximal empty
rectangles carved out of an occupancy grid of every stamp footprint, road,
solid and patch in `city-plan.json`), groups orphans by `biome_primary`,
shelf-packs them by true sprite rect, and paints a ground patch per biome
segment. Emitted stamps carry `showcase: true`, so re-running ignores its own
output — orphan detection and zone discovery stay idempotent as the city grows.
Re-run it after any district lands, since a new district both consumes showcase
zones and retires orphans:

```
python3 scripts/compile-coverage-showcase.py -v
python3 scripts/merge-city-plan.py --include-generated
python3 scripts/compile-coverage-showcase.py --verify-merged   # showcase-scoped QA
```

**Tier A is capped at 43.37% by linking, not by placement.** Only 252 of the
581 building `me.*` are vision-linked to a pixel-perfect Single; the other 329
have no image to stamp. Raising Tier A past this needs `me-to-singles.json`
coverage for those 329, not more districts.

---

## Dependency graph (what must wait)

```
W0 (parallel) ──► G0 ──► W1 (parallel) ──► G1 ──► W2 (sequential core)
                                              │
                    G2 ◄──────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
       W3 (biomes) W4 (runtime) W4 (atlas)
         │           │           │
         └───────────┴───────────┘
                     ▼
                    G4 ──► W5 (Denizen MCP)
```

**Delicate / wait points:**
- Do **not** start W2 compiler fill logic until G1 enrichment exists (needs biome/role).
- Do **not** roll W3 to all biomes until G2 pilot looks good in preview (`render-city-preview.py`).
- Do **not** ship atlas until stamp set stabilizes (after one biome migration).
- **Do** run `check-city-plan.py` after every merge; block if defects > 0.

---

## Testing checklist (every gate)

```bash
python3 scripts/validate-placement-rules.py      # G0 schema + refs + rule dry run
python3 scripts/enrich-me-placement-rules.py      # after W1
python3 scripts/report-ext-catalog-coverage.py
python3 scripts/compile-exterior-district.py --spec data/city-specs/d18-beach-compiler.json
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py              # prints QA
python3 scripts/check-city-plan.py              # exit 0
python3 scripts/audit-placement-logic.py        # advisory
python3 scripts/render-city-preview.py --crop ... # visual spot-check

# Wave 5 prep (offline; see Wave 5 section)
python3 scripts/build-npc-patrol-routes.py            # data/city-specs/npc-patrol-routes.json
python3 scripts/montage-qa-compiled-districts.py      # exit 1 if any generated/d*.json has a hard defect
python3 scripts/export-limezu-assets-catalog.py --tsv # assets/limezu/_asset-catalog-enriched.{json,tsv}
```

---

## Coverage targets (Tier A–E)

| Tier | Target | Baseline (W0-B) | After W3+W4 pockets | After W6-A showcase |
|------|--------|-----------------|---------------------|---------------------|
| A Buildings/landmarks | 100% `me.*` building category placed somewhere | — | 56/581 (9.64%) | **252/581 (43.37%)** — linking-capped |
| B Props/trees/vehicles | ≥90% role-tagged placeables | — | 300/1150 (26.09%) | **599/1150 (52.09%)** |
| C Color variants | ≥1 use per variant family across biomes | — | 140/332 (42.17%) | **237/332 (71.39%)** |
| D Fragments | group-only, never solo stamp | — | 351/2916 (12.04%) | 580/2916 (19.89%) |
| E Animated | ≥1 anim per theme sheet in matching biome | — | 16/24 themes | 16/24 themes |

Overall `me.*` usage: 544/2749 (19.79%) → **1275/2749 (46.38%)**. Numbers come
from `report-ext-catalog-coverage.py` against the merged plan.

---

## Branch / PR strategy

- Branch: `cursor/exterior-placement-brain-9232`
- Keep catalog PR #40 mergeable; brain work stacks on top or separate PR #41
- Commit after each gate; push before spawning next wave

---

## Sub-agent group assignments (for parent agent)

| Group | Subagent type | Model | Owns |
|-------|---------------|-------|------|
| **ALPHA** | generalPurpose | claude-opus-5-thinking-high | Schema + compiler architecture |
| **BETA** | generalPurpose | claude-sonnet-5-thinking-xhigh | Coverage + enrichment scripts |
| **GAMMA** | generalPurpose | claude-sonnet-5-thinking-high | Group recipes + multi_tile |
| **DELTA** | explore | composer-2.5 | Biome audit of existing d*.json |
| **EPSILON** | computerUse | inherit | Browser test `?world=full` after G2/G4 |

Parent agent: merge outputs, resolve conflicts, run gates, update this doc checkboxes.

---

## File tree (target)

```
data/limezu-visual-catalog/
  placement-rules.json
  placement-rules.schema.json
  me-placement-enriched.jsonl
  variant-palette-map.json
  coverage-report.json
  groups/
    grp.beach.volley_court.json
    ...
data/city-specs/
  d18-beach-compiler-pilot.json   # spec, not hand stamps
  biome-specs/
    beach.json
    wild.json
    ...
scripts/
  validate-placement-rules.py
  enrich-me-placement-rules.py
  report-ext-catalog-coverage.py
  compile-exterior-district.py
  build-ext-atlas.py
docs/
  EXTERIOR-COMPILER.md
```

**Gate G5:** Offline prep done; live MCP dispatch pending.

### Wave 6 — Full migration + coverage sprint ✅
| ID | Task | Output |
|----|------|--------|
| W6-A | Catalog showcase | `compile-coverage-showcase.py` → d99 (703 stamps, Tier A 43%) |
| W6-B | Full district migration | d6/7/9/10/11/13 `-compiled.json` + `--compiler-replaces HAND` |
| W6-C | Atlas runtime | ext-atlas wired in full-world.js (1870 frames, 100% hit rate) |
| W6-D | Wave 5 prep | NPC routes, montage QA, `_asset-catalog-enriched.json` |
| W6-E | Browser test | `?world=full` loads 3748 stamps, movement OK |

**Promoted merge command (0 QA defects):**
```bash
bash scripts/promote-city-plan.sh
# or manually:
# 1) merge --compiler-replaces HAND --include-pockets (manifest WITHOUT d99)
# 2) python3 scripts/compile-coverage-showcase.py
# 3) merge again with d99 back in manifest.json
python3 scripts/build-ext-atlas.py
python3 scripts/build-day-night-variants.py
```

Active pockets listed in `data/city-specs/generated/manifest.json` (excludes pockets that overlap compiled districts).

**Coverage after W7:** 6161 stamps, 15/15 exterior districts compiler-replaced (d1–d15 except d00/d16/d17), day/night TOD on 339+ light stamps.

### Wave 7 — Full district migration + TOD ✅
| ID | Task | Output |
|----|------|--------|
| W7-A | Derive + compile d1,d2,d3,d4,d5,d8,d12,d14,d15 | `biome-specs/full/d*.json` + `d*-compiled.json` |
| W7-B | Fix pocket overlaps (d25/d26 removed from manifest) | updated `manifest.json` |
| W7-C | Day/night asset swapping | `day-night-variants.json` + `full-world.js` TOD hooks |
| W7-D | Showcase refresh workflow | `promote-city-plan.sh` (showcase after pockets) |
| W7-E | `fish` interact verb | `full-world.js` + test fix |

**Gate G7:** `bash scripts/promote-city-plan.sh` → **6161 stamps, 0 QA defects**.

---

## Status log

| Gate | Status | Notes |
|------|--------|-------|
| G0 | **done** | All W0 deliverables committed; validate-placement-rules OK (2749/2749 roles) |
| G1 | **done** | W1-A/B/C: 100% enrichment, 20 groups, variant map validated |
| G2 | **done** | Beach pilot compiles 51 stamps, 0 QA defects; merge `--include-generated` wired |
| G3 | **done** | 11 biome specs + 12 compiler pockets promoted; 1764 stamps, 0 defects |
| G4 | **done** | interact runtime, atlas builder, extended QA (biome advisory) |
| G5 | **prepped, blocked on MCP** | W5-A/B/C offline artifacts committed |
| G6 | **done** | Full migration + showcase; **3748 stamps**, 0 QA defects |
| G7 | **done** | All d1–d15 compiler-replaced; **6161 stamps**, TOD lights, 0 QA defects |
