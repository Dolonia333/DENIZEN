# Exterior District Compiler

**Scope:** Modern Exteriors only (`assets/limezu/ext/`). Interiors / Modern Office out of scope.

The compiler replaces hand-stamped district fragments with a **declarative spec →
generated fragment** pipeline. Today a district like `d8-beach.json` is ~580 lines of
hand-picked XY: every prop's position is a guess an agent typed, and the city uses ~571 of
6224 Singles. The compiler makes position a *derived* value — the spec says "a 400×280 sand
lounge pocket, a bar pinned here, a volley court in the plaza slot, furniture density
`dense`", and the compiler decides where the other 80 stamps go, using the catalog's
footprints and the biome/role/surface rules, refusing to emit anything that would trip
`check-city-plan.py`.

This is layer **L4** of the placement brain (see
`data/city-specs/EXTERIOR-PLACEMENT-BRAIN-PLAN.md`).

| | |
|---|---|
| Script | `scripts/compile-exterior-district.py` |
| Example spec | `data/city-specs/biome-specs/beach.json` |
| Vocabulary owner | `data/limezu-visual-catalog/placement-rules.json` (W0-A) |
| Group recipes | `data/limezu-visual-catalog/groups/grp.*.json` (W0-C / W1-C) |
| Footprints | `data/limezu-visual-catalog/placement-index.json` |
| Status | W0-D scaffold — plumbing real, fill passes C–G are stub hooks |

**The rules file is authoritative for names.** Every biome, surface, slot archetype, role,
density level, palette and interact verb a spec uses must exist in
`placement-rules.json`; the compiler is its consumer and validates against it. When the
rules file is absent (pre-G0), vocabulary checks self-disable and the compile still runs.

---

## CLI

```bash
python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json
```

| Flag | Purpose |
|------|---------|
| `--spec PATH` | **required** — district spec JSON |
| `--out PATH` | fragment destination (default: `compiler.out`, else `data/city-specs/generated/<id>.json`) |
| `--seed N` | override `compiler.seed` |
| `--passes A_ground,B_skeleton` | run a subset (debugging one pass at a time) |
| `--validate-only` | check the spec, emit nothing — cheap CI gate on specs |
| `--dry-run` | compile in memory, print counts, write nothing |
| `--qa` | run `check-city-plan.py` on the fragment; exits non-zero on defects |
| `--stats-json PATH` | write the `_compiled` provenance block separately |
| `-v` | per-pass stats as they run |

Exit codes: `0` clean, `1` invalid spec (or QA defects with `--qa`), `2` spec not found.

---

## Data flow

```
data/city-specs/biome-specs/<biome>.json      ← district spec (hand-authored, small)
data/limezu-visual-catalog/
  placement-rules.json                        ← biome/role/surface/slot/density  (W0-A)
  groups/grp.*.json                           ← multi-tile recipes               (W0-C/W1-C)
  placement-index.json                        ← me/exs → img + w/h               (exists)
  me-placement-enriched.jsonl                 ← role+biome per me.*              (W1-A)
  variant-palette-map.json                    ← colour token → palette           (W1-B)
            │
            ▼
  scripts/compile-exterior-district.py        ← passes A–H
            │
            ▼
data/city-specs/generated/d18-beach-lounge.json   ← district fragment (me.* stamps)
            │
            ▼
  scripts/merge-city-plan.py                  ← resolves me/exs → img, prunes, nudges
            │
            ▼
  data/city-plan.json → src/full-world.js (?world=full)
```

The compiler does not open PNGs to place things. Footprints come from
`placement-index.json`, which already carries every Single's `w`/`h`, so a compile is
milliseconds and needs no PIL. (Verified: `me.beach.palm_tree` → 64×80 from the index,
identical to the PNG.) PIL is used opportunistically in one place only — validating anim
sheet frame math, where the sheets are not in the Singles index.

---

## Input: the district spec

One spec = one district.

```jsonc
{
  "schema": "exterior-district-spec/1",
  "id": "d18-beach-lounge",                 // fragment id + default output filename
  "district": "D18 Beach Lounge Pocket",    // human label, copied into the fragment
  "biome": "beach",                         // keys into placement-rules.biomes
  "palette": "coastal",                     // placement-rules.palettes
  "palette_secondary": "festive_market",

  "compiler": {
    "version": 1,
    "rules": "data/limezu-visual-catalog/placement-rules.json",
    "seed": 21084,                          // determinism
    "coords": "local",                      // "world" (default) | "local"
    "out": "data/city-specs/generated/d18-beach-lounge.json"
  },

  "bbox": { "x": 3120, "y": 4816, "w": 400, "h": 280 },
  "label": "SAND LOUNGE", "label_at": { "x": 200, "y": 24 },

  // pass A — ground. Paintable surfaces become patches; water becomes an animBand.
  "surfaces": [
    { "surface": "sand", "x": 0, "y": 0, "w": 400, "h": 264, "depth": 0.92 },
    { "surface": "sidewalk", "name": "promenade", "x": 0, "y": 0, "w": 400, "h": 32 },
    { "surface": "water", "x": 0, "y": 264, "w": 400, "h": 16, "shore": "top",
      "anim": "ext/animated/_water_fill_16x16.png", "fw": 64, "fh": 64 }
  ],

  // passes B/E/F/G — scatter targets. `slot` is a placement-rules archetype;
  // `density` is per-role, using the named levels sparse|light|medium|dense|packed.
  "slots": [
    { "slot": "interior_fill", "name": "lounge", "x": 16, "y": 48, "w": 368, "h": 144,
      "density": { "furniture_ext": "dense", "canopy": "dense", "vegetation": "medium" } },
    { "slot": "path_edge", "name": "promenade_edge", "surface": "sidewalk",
      "density": { "street_furn": "medium", "signage": "light" } },
    { "slot": "shore_line", "name": "wet_sand", "between": ["sand", "water"],
      "density": { "decor_small": "dense", "water_prop": "medium" } }
  ],

  // pass C — pinned hero objects.
  "landmarks": [
    { "me": "me.beach.bamboo_bar_sand", "at": { "x": 72, "y": 128 },
      "anchor": "bc", "pin": true, "solid": true, "interact": "shop" }
  ],

  // pass D — group recipes placed into a slot.
  "groups": [
    { "grp": "grp.beach.volley_court", "slot": "court", "count": 1, "interact": "play" }
  ],

  // pass H — interaction wiring; "auto" = every eligible stamp by role/tags.
  "interactions": { "sit": "auto", "read": ["me.beach.sign_direction_big"] },
  "anims": [ { "sheet": "ext/animated/Crabs_16x16.png", "fw": 64, "fh": 64,
               "at": { "x": 280, "y": 248 }, "fps": 5 } ],

  // pass B keep-clear + compile budgets.
  "constraints": {
    "keep_clear": [ { "x": 176, "y": 32, "w": 48, "h": 232, "why": "beach access" } ],
    "max_stamps": 90, "coverage_target_singles": 45,
    "max_solid_cell_ratio": 0.28, "min_free_cell_ratio": 0.45
  },

  "passes": { "A_ground": { "enabled": true }, "...": {} }
}
```

### Field contract

| Field | Required | Meaning |
|-------|:--------:|---------|
| `id`, `district`, `biome`, `bbox` | yes | identity + placement envelope |
| `surfaces[]` | yes | the ground plan — without it every solid lands `FLOATING` |
| `compiler.seed` | no (0) | seeds every per-pass RNG stream |
| `compiler.coords` | no (`world`) | `local` = all rects/points are relative to `bbox` |
| `compiler.out` | no | default output path |
| `palette`, `palette_secondary` | no | variant scoring for passes E–G |
| `slots[]` | no | archetype + area (rect, `surface`, or `between`) + per-role `density` |
| `landmarks[]` | no | pinned `me`/`exs`/`grp` at a point; `pin` = anchor is authoritative |
| `groups[]` | no | `grp` recipe × `count` into a named slot |
| `interactions{}` | no | verb → `"auto"` or an explicit id list |
| `anims[]` | no | pass-through animated objects (frame math validated) |
| `constraints{}` | no | `keep_clear` rects plus walkability/coverage budgets |
| `passes.*` | no | per-pass `enabled` plus pass-specific knobs |

Rects accept either `{x, y, w, h}` or `{"rect": [x, y, w, h]}`; points accept `{x, y}` or
`[x, y]`.

### `coords: "local"` and relocatable districts

With `coords: "local"`, every rect and point in the spec is relative to `bbox`, so the
whole district relocates by editing `bbox` alone. That is the fix for mistake #4 in
`data/city-specs/EXTERIOR-MISTAKES.md`, where `relocate-district.py` moved a district's
stamps but left its `bbox` behind, producing phantom district overlaps in the docs.
`world` (the default) keeps absolute coordinates, matching how the existing hand-authored
fragments and `placement-rules.json`'s own `example_district_spec` are written.

### Validation

`validate_spec()` runs before any pass, so no pass has to defend against bad input. Errors
abort; warnings print and continue.

**Structure** — required keys; `bbox` ints, positive, inside the 6656×6400 world
(pre-empts `OFFWORLD`); every rect well-formed and inside `bbox` under the declared coords
mode. Pass A snaps patch *sizes* up, so only the bbox **origin** must sit on the 16px
lattice — an off-grid origin shifts the grout grid and reads as broken seams.

**Vocabulary, against `placement-rules.json`** — `surfaces[].surface`, `slots[].slot`
archetype, `slots[].density` role names and levels, `groups[].slot` resolving to a declared
slot, and `landmarks[].at` inside the bbox are **errors**. Unknown biome, palette or
interact verb are **warnings** (the rules file may lag a new biome).

**Catalog** — a `landmarks[].me` that is not in the placement index is an **error**: merge
would fail to resolve it. A `grp` with no recipe file yet is a **warning** (W1-C lag).

```
$ python3 scripts/compile-exterior-district.py --spec broken.json --validate-only
error: surfaces[0].surface 'lava' is not a placement-rules surface
error: slots[0].slot 'nonexistent_slot' is not a placement-rules slot archetype
error: slots[1].density role 'not_a_role' is not a placement-rules role
error: slots[1].density.canopy level 'ludicrous' is not one of ['dense','light','medium','packed','sparse']
error: landmarks[0].me 'me.beach.does_not_exist' is not in the placement index (merge would fail to resolve it)
error: constraints.keep_clear[0] (0, 0, 9000, 10) escapes the district bbox (400x280, coords=local)
warn: biome 'swamp' is not in placement-rules biomes
spec INVALID: 6 error(s)
```

---

## Passes A–H

Ordering principle: **constrain before you fill, and place the least flexible thing
first.** Ground defines what surfaces exist; circulation reserves what must stay empty;
landmarks and groups claim large footprints while space is still available; then props,
canopy and detail fill progressively smaller gaps in what is left. Nothing later can
invalidate something earlier, so no pass ever needs to back out another pass's work.

| Pass | Name | Emits | Status |
|------|------|-------|--------|
| A | Ground | `patches` + the surface map | **implemented** |
| B | Skeleton | reservations, `roads`, resolved slot cell sets | **implemented** (`between` band derivation TODO) |
| C | Landmarks | large solid `stamps` from `landmarks[]` | stub hook (W2-A) |
| D | Groups | atomic `grp.*` assemblies | stub hook (W2-A); recipes pre-validated |
| E | Props | per-slot scattered `stamps` | stub hook (W2-A) |
| F | Canopy | parasols / palms / awnings | stub hook (W2-A) |
| G | Detail | non-solid decals and dressing | stub hook (W2-A) |
| H | Life | `anims`, `animBands`, `labels` | **implemented**; `interact` wiring TODO (W4-A) |

### A — Ground

Each `surfaces[]` entry is painted in order, snapped to the 16px lattice (origin down, size
up) so all patches share one grout grid:

- **Paintable** surfaces (`grass`, `sidewalk`, `asphalt`, `sand` — the only tiles
  `full-world.js` renders) become fragment `patches` at the surface's `default_depth`.
- **Water** is paintable in the rules but has `tile: null`: pass A reserves it
  `UNWALKABLE | RESERVED` and pass H emits it as an `animBands` entry. Any surface with
  `walkable: false` gets the same treatment, so only `water_prop`/boat roles can ever be
  placed there.

Simultaneously it rasterizes a **surface map** into the occupancy grid: every cell records
which surface it ended up as. Later passes ask `occ.surface_at(x, y)` instead of guessing —
that is how a sand-only prop stays off the promenade, and why the `FLOATING` defect cannot
occur: ground exists across the district before anything is placed.

### B — Skeleton

Circulation and slot geometry, before anything can block it:

1. `constraints.keep_clear[]` → `RESERVED` cells (walkways, doorway aprons, waterlines).
2. `roads[]` → fragment `roads` plus a one-tile `RESERVED` shoulder, so no later pass can
   drop a solid into a driving lane (`ROADBLOCK`).
3. **Slot resolution** — each declared slot becomes a concrete set of free cell indices,
   which is what passes E–G scatter into:
   - an explicit rect → the cells it covers;
   - `surface: "sidewalk"` → every cell of that surface (`derived_from: patches`);
   - `between: ["sand", "water"]` → *TODO (W2-A)*: walk the surface map for cells of A
     adjacent to B and dilate by the archetype's `band_px`. Until then a `shore_line` slot
     resolves to **zero** cells rather than to the wrong ones, and says so in the stats.

*TODO (W2-A):* auto-route paths between district entrances and landmark anchors (A\* over
free cells), emit them as patches, and reserve the corridor.

### C — Landmarks

Pinned hero objects from `landmarks[]`, largest footprint first, because big inflexible
pieces must claim space before anything small can box them out. `pin: true` means the
anchor is authoritative and must not drift. Per landmark: resolve `me`/`exs` → footprint
via the catalog, snap the anchor to a cell whose surface the object accepts, reject when
`occ.overlap_ratio()` exceeds the rules' `reject_on` threshold, claim with an entrance
halo, emit `{me, prefer?, x, y, origin, solid}`.

Marking real obstacles `solid: true` also buys the district a free service from the merge:
`merge-city-plan.py` prunes auto-placed street lamps and trees that land inside any solid
non-structure footprint.

### D — Groups

Expands `grp.*` recipes into multi-stamp assemblies. A recipe (W0-C format) declares
`footprint_tiles`, an `anchor` origin, and `pieces[]` carrying `me`/`exs`, a tile offset
`dx`/`dy`, size, origin and `solid` — e.g. `grp.beach.volley_court` is 12 pieces on a 7×6
tile footprint: two net posts, the modular net panel, eight modular sand court-line tiles,
and a ball mid-court.

A group is **atomic**: its union footprint is tested against the occupancy once, and either
every member lands at `anchor + (dx, dy) × 16` or the whole group is rejected. This is the
direct fix for mistake #1 (stamp collage instead of composed scenes) and for coverage tier
D — fragment Singles like a lone modular court-line tile must never be stamped solo.

Placement is W2-A's work. Today the pass **pre-validates** every referenced recipe instead:
each piece must resolve in the catalog, and each offset must fit the declared footprint.
Data problems surface now rather than during W2-A.

### E — Props

Per-slot scatter. The candidate pool is enriched `me.*` (W1-A) filtered by the biome's
`forbid_tags`, the slot archetype's `roles`, and the surface's `roles_allowed`; anchors come
from a jittered sample seeded per slot. Each role's `density` level resolves through the
rules into `target_coverage`, `min_spacing_mult` (scaling the role's own `spacing_px`),
`props_per_kilopx2` and `jitter_px`, so "dense" means the same thing in every district.

Variant selection is **coverage-aware**: `palette` scores the colour family and the pass
biases toward Singles the city has not used yet, so a district spends new assets instead of
repeating the same six PNGs (mistake #2, coverage tier C).

### F — Canopy

Overhead cover (parasols, palms, awnings, market tents) last among the solids, because it
overhangs what pass E placed and must see the ground props to avoid burying an interactable
or blocking a sightline. The rules give `canopy` `layer: overhead` with a y-sort depth bias
and `collision: none` — its tile stays walkable, so it claims `CLEAR`, not `SOLID`.

### G — Detail

High-count, zero-collision dressing — shells, starfish, sand holes, litter, decals — into
cells that are still empty, up to the density level's `target_coverage`. Claims `DECOR` only
and never sets `solid`, so pass G cannot create an `OVERLAP` defect by construction.

### H — Life

Everything that makes the district move or respond: `anims`, `animBands` (including the
water surfaces pass A reserved, with `shore: "top"` foam), `vehicles`, `labels`, `portals`
and NPC anchors. Frame math is validated against sheet dimensions to pre-empt `BADANIM`.

*TODO (W4-A):* attach `interact` verbs from `interactions{}` to the stamps C–G placed
(`"auto"` = every stamp whose role and tags match the verb's rules entry). It runs last
precisely because interaction attaches to objects the earlier passes chose.

---

## Compiler internals

### Occupancy grid

A 16px cell grid over the bbox with, per cell, a surface name and a flag byte:

| Flag | Meaning |
|------|---------|
| `RESERVED` | circulation / keep-clear — nothing may be placed |
| `SOLID` | a solid footprint stands here |
| `DECOR` | a walkable decal or prop stands here |
| `CLEAR` | clearance halo around a solid (soft: decor and canopy may still land) |
| `UNWALKABLE` | water and the like — only `water_prop` / boat roles |

Plus a list of claimed solid world-rects backing `overlap_ratio(rect)`, which returns the
worst overlap as a fraction of the *smaller* sprite — the exact metric
`check-city-plan.py` flags at 35%. The compiler's accept/reject test and the QA gate
therefore measure the same thing, and a compiled district is clean because it was never
allowed to be dirty.

### Determinism

`ctx.rng(pass_letter, salt)` returns a `random.Random` seeded from
`seed:district_id:pass:salt` — one stream per pass, and per slot or recipe within a pass,
never a shared global stream. So adding pass G does not reshuffle what pass E placed, and
re-running with the same spec, seed and catalog reproduces the fragment **byte for byte**
(the `_compiled` block deliberately carries no timestamp). Diffs stay reviewable.

### Provenance

Every fragment carries a `_compiled` block: spec path, seed, rules version, coords mode,
per-pass stats, occupancy stats and any unresolved catalog ids. `_doc` marks the file
generated. When a district looks wrong, the fragment itself says which spec and seed made
it.

---

## Output: the district fragment

Same shape as the hand-authored `d*.json` fragments, so `merge-city-plan.py` needs no
special case:

```jsonc
{
  "_doc": "GENERATED by scripts/compile-exterior-district.py from … — do not hand-edit",
  "district": "D18 Beach Lounge Pocket",
  "id": "d18-beach-lounge",
  "biome": "beach",
  "bbox": { "x": 3120, "y": 4816, "w": 400, "h": 280 },
  "_compiled": {
    "spec": "data/city-specs/biome-specs/beach.json", "seed": 21084,
    "rules_version": "0.1.0", "coords": "local",
    "passes": { "A_ground": { "patches": 3, "unpaintable_surfaces": 1 }, … },
    "occupancy": { "cells": 450, "occupied_cells": 0, "reserved_cells": 92,
                   "unwalkable_cells": 50, "free_ratio": 1.0 },
    "catalog_misses": []
  },
  "patches": [ { "tile": "sand", "x": 3120, "y": 4816, "w": 400, "h": 288, "depth": 0.92 } ],
  "roads": [], "stamps": [],
  "anims": [ { "sheet": "ext/animated/Crabs_16x16.png", "fw": 64, "fh": 64,
               "x": 3400, "y": 5064, "fps": 5 } ],
  "animBands": [ { "sheet": "ext/animated/_water_fill_16x16.png", "fw": 64, "fh": 64,
                   "x": 3120, "y": 5072, "w": 400, "h": 32, "fps": 5,
                   "depth": 0.96, "shore": "top" } ],
  // note both ground surfaces end at y=5104: a district whose bbox height is not a
  // multiple of 16 snaps up, and every surface must snap the same way or the odd
  // one out leaves a sliver of bare world grass along the edge.
  "solids": [], "labels": [ { "x": 3320, "y": 4840, "text": "SAND LOUNGE" } ],
  "portals": [], "npcs": [], "vehicles": []
}
```

**Stamps are emitted as catalog ids, never as `img` paths:**

```json
{ "me": "me.beach.umbrella_blue_open", "x": 3200, "y": 4960, "origin": "bc", "solid": true }
{ "me": "me.city_props.lamp_ornate_double", "prefer": "Street_Lamp_1.png", "x": 3140, "y": 4830, "origin": "bc" }
```

`merge-city-plan.py` stays the single place where ids become PNGs, so re-picking a variant
in the catalog re-skins every compiled district without recompiling. Anchors follow the
role's rules entry (`bc` bottom-centre for most props): the anchor is the point on the
ground the object stands on, which is what the occupancy grid reasons about.

---

## Integration with merge

`merge-city-plan.py` globs `data/city-specs/d*.json` — **non-recursive**. So the default
output directory `data/city-specs/generated/` is deliberately *outside* the merge:
compiling cannot disturb the currently-clean QA gate (0 defects on 1215 stamps) while
passes C–G are still stubs.

Promoting a compiled district at W2-C is one of:

1. **Recommended** — add `generated/d*.json` to the merge glob, keeping generated and
   hand-authored fragments in visibly separate directories.
2. Point `compiler.out` at `data/city-specs/d18-beach-lounge.json` so the existing glob
   picks it up with no merge change.

Either way the compiler must respect what merge already does:

- **Filename** must start with `d` and end `.json`; **never** `d00*`, which merge treats as
  structure furniture eligible for pruning.
- Merge resolves `me`/`exs` → `img` before footprint math, so compiled stamps must carry
  `me`/`exs` and may carry `prefer`.
- Merge prunes `d00` street furniture that lands inside any solid non-structure footprint —
  compiled solids get that cleanup free.
- Merge nudges building-keyword stamps off the street grid. Compiled districts should not
  need it; if the nudge count rises after a compile, pass B under-reserved.

Full loop:

```bash
python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json --qa
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py            # resolves me/exs, prints QA
python3 scripts/check-city-plan.py            # exit 0 required
python3 scripts/audit-placement-logic.py      # advisory
python3 scripts/render-city-preview.py --crop 3120 4816 3520 5096   # x0 y0 x1 y1
```

---

## QA contract

The compiler is designed so `check-city-plan.py` cannot find these defects, rather than
fixing them after the fact:

| Defect | Prevented by |
|--------|--------------|
| `OVERLAP` | occupancy `SOLID` claims + `overlap_ratio` reject below the 0.35 the gate flags |
| `FLOATING` | pass A paints ground across the bbox before any placement; surface checked per anchor |
| `ROADBLOCK` | pass B reserves road lanes plus a one-tile shoulder before C–G run |
| `OFFWORLD` | validation bounds-checks bbox against 6656×6400; every rect is bbox-checked |
| `BADANIM` | pass H validates `fw`/`fh` against sheet dimensions |
| `MISSING` | unknown `landmarks[].me` is a validation error; misses land in `_compiled.catalog_misses` |

Extra gates for W4-C: biome violation (a prop whose tags hit the biome's `forbid_tags`),
coverage regression (fewer unique Singles than the previous compile), and budget breach
(`max_stamps`, `max_solid_cell_ratio`, `min_free_cell_ratio`,
`coverage_target_singles`).

---

## Current example: `beach.json`

A 400×280 sand lounge pocket at world `(3120, 4816)` — verified empty ground: no stamp,
patch, road or solid of any existing district falls there. It sits west of D8's boardwalk
(D8 starts at x=3600), below D7 park (ends y=4800) and above the underground subway band
(starts y=5120), so it reads as the natural western continuation of the shoreline.

Four surfaces (a sand shelf under the whole bbox, promenade, access ramp, a thin animated
waterline), four slots
(`path_edge` promenade, `interior_fill` lounge, `plaza` court, `shore_line` wet sand), three
pinned landmarks (bamboo bar, lifeguard chair, direction sign), one group recipe
(`grp.beach.volley_court`), and a reserved beach-access corridor. Every `me.*` id, the
volley court's 12 recipe pieces and all three anim sheets resolve against the catalog today.

```
$ python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json --qa -v
rules: data/limezu-visual-catalog/placement-rules.json v0.1.0 biomes=14 roles=24 slots=12
spec OK: d18-beach-lounge (D18 Beach Lounge Pocket) biome=beach 400x280 @(3120,4816)
  pass A_ground     {'patches': 3, 'unpaintable_surfaces': 1}
  pass B_skeleton   {'keep_clear': 1, 'roads': 0, 'slots': {'promenade_edge': {…'cells': 50},
                     'lounge': {…'cells': 180}, 'court': {…'cells': 63},
                     'wet_sand': {…'cells': 0, 'derived_from': 'surface_boundary'}}}
  pass C_landmarks  {'placed': 0, 'pending': 3, 'todo': True}
  pass D_groups     {'groups': 0, 'pending': 1, 'recipes_checked': 1, 'todo': True}
  …
  pass H_life       {'labels': 1, 'anims': 2, 'animBands': 1, 'todo': True}
compiled seed=21084: {'patches': 3, 'anims': 2, 'animBands': 1, 'labels': 1}
stub passes (no fill logic yet): C_landmarks, D_groups, E_props, F_canopy, G_detail, H_life
checked data/city-specs/generated/d18-beach-lounge.json: 0 stamps
defects: none
```

---

## Handoff to W2-A

Land the fill passes one at a time, in letter order — each only needs the occupancy grid
and the catalog, both of which already work. Per the master plan, **do not start C–G until
gate G1** (enrichment) lands, since they need role/biome per `me.*`.

1. **B (finish)** — `between` / `surface_boundary` band derivation, so `shore_line` and
   `road_edge` slots resolve. Pure geometry over the existing surface map; no G1 dependency.
2. **C** — landmark resolution (footprint → snap → reject → claim → emit). Smallest useful
   pass; unblocks visual review of the pilot.
3. **D** — group placement, on top of the recipe pre-validation already in the pass. Biggest
   quality win per line, and only needs W1-C to author more recipes.
4. **E/F/G** — scatter; needs W1-A enrichment for role/biome filtering and W1-B for palette
   scoring.
5. **H (finish)** — `interact` wiring, paired with W4-A runtime hooks.

Each pass is a single function returning a stats dict. The pipeline, validation, emitter and
QA contract stay untouched.
