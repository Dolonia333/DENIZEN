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
| L1 Semantics | role, category, biome, palette, surface, interact | **Planned** |
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

### Wave 1 — Enrichment (depends G0 schema)
| ID | Group | Task | Output |
|----|-------|------|--------|
| W1-A | Enrich | `enrich-me-placement-rules.py` — tag all 1295 `me.*` from theme + filename + registry | `me-placement-enriched.jsonl` |
| W1-B | Variants | `variant-palette-map.json` — color tokens → palette affinity | palette scoring table |
| W1-C | Groups | Author first 20 `grp.*` JSON recipes (beach, camping, subway, worksite) | `data/limezu-visual-catalog/groups/*.json` |

**Gate G1:** ≥90% `me.*` have role + biome; 20 groups validate against Singles inventory.

### Wave 2 — Compiler v1 (depends G1)
| ID | Group | Task | Output |
|----|-------|------|--------|
| W2-A | Compiler | Implement fill passes: landmarks, props, canopy, street kit | `scripts/compile-exterior-district.py` |
| W2-B | District | Author `d18-beach-compiler-pilot.json` spec (not hand stamps) | district spec format |
| W2-C | Merge | Wire compiler output → existing merge + `me` resolve | merge integration |

**Gate G2:** Pilot biome compiles to `city-plan.json` with 0 QA defects; coverage +200 Singles vs baseline.

### Wave 3 — Biome rollout (parallel per biome, depends G2)
| ID | Biome | District target |
|----|-------|-----------------|
| W3-1 | beach | extend d8 / d18 |
| W3-2 | wild/camping | d10 |
| W3-3 | urban_core | d1, d2, d15 |
| W3-4 | civic | d3, d5 |
| W3-5 | industrial | d11 |
| W3-6 | military | d12 |
| W3-7 | residential | d6 |
| W3-8 | park | d7 |
| W3-9 | memorial | d9 |
| W3-10 | transit | d13 |

**Gate G3:** Each biome has compiler spec OR migrated stamps; coverage report Tier A/B targets met.

### Wave 4 — Interactions + atlas (depends G2 pilot)
| ID | Group | Task | Output |
|----|-------|------|--------|
| W4-A | Runtime | `interact` field → `full-world.js` sit/enter/read | interaction map in plan |
| W4-B | Atlas | `build-ext-atlas.py` for compiled stamp set | `assets/limezu/ext-atlas/` |
| W4-C | QA | Extend `check-city-plan.py`: biome violations, coverage gate | CI exit codes |

**Gate G4:** Manual browser test `?world=full`; atlas load ≤ prior stamp GET count / 10.

### Wave 5 — Denizen integration (when MCP available)
| ID | Task |
|----|------|
| W5-A | `assign_task` NPC patrol routes per biome |
| W5-B | Visual agent pass on compiled districts via montage QA |
| W5-C | Wire `city.limezu_assets` NAS table to enriched catalog |

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
python3 scripts/enrich-me-placement-rules.py      # after W1
python3 scripts/report-ext-catalog-coverage.py
python3 scripts/compile-exterior-district.py --spec data/city-specs/d18-beach-compiler.json
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py              # prints QA
python3 scripts/check-city-plan.py              # exit 0
python3 scripts/audit-placement-logic.py        # advisory
python3 scripts/render-city-preview.py --crop ... # visual spot-check
```

---

## Coverage targets (Tier A–E)

| Tier | Target |
|------|--------|
| A Buildings/landmarks | 100% `me.*` building category placed somewhere |
| B Props/trees/vehicles | ≥90% role-tagged placeables |
| C Color variants | ≥1 use per variant family across biomes |
| D Fragments | group-only, never solo stamp |
| E Animated | ≥1 anim per theme sheet in matching biome |

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
  enrich-me-placement-rules.py
  report-ext-catalog-coverage.py
  compile-exterior-district.py
  build-ext-atlas.py
docs/
  EXTERIOR-COMPILER.md
```

---

## Status log

| Gate | Status | Notes |
|------|--------|-------|
| G0 | in_progress | Wave 0 sub-agents launched |
| G1 | pending | |
| G2 | pending | |
| G3 | pending | |
| G4 | pending | |
| G5 | blocked | Denizen MCP not connected |
