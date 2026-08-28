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
| Candidate pool | `data/limezu-visual-catalog/me-placement-enriched.jsonl` (W1-A) |
| Palette scoring | `data/limezu-visual-catalog/variant-palette-map.json` (W1-B) |
| Merge flag | `scripts/merge-city-plan.py --compiler-replaces HAND` (W6-B — full district migration) |
| Status | W2-A — all eight passes implemented; W6-B — 6 priority districts fully migrated |

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
| `--passes A,C` | run a subset, debugging one pass at a time (bare letter or full `C_landmarks`); an unknown name is an error, not a silently empty fragment |
| `--validate-only` | check the spec, emit nothing — cheap CI gate on specs |
| `--dry-run` | compile in memory, print counts, write nothing |
| `--qa` | run `check-city-plan.py` on the fragment; exits non-zero on defects |
| | (the gate measures PNG rects, so `--qa` hands it an id-resolved copy — the same resolution `merge-city-plan.py` does — and deletes it afterwards) |
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
| B | Skeleton | reservations, `roads`, resolved slot cell sets | **implemented** (path auto-routing still TODO) |
| C | Landmarks | large solid `stamps` from `landmarks[]` | **implemented** |
| D | Groups | atomic `grp.*` assemblies | **implemented** (recipes pre-validated first) |
| E | Props | per-slot scattered `stamps` | **implemented** |
| F | Canopy | parasols / palms / awnings | **implemented** |
| G | Detail | non-solid decals and dressing | **implemented** |
| H | Life | `anims`, `animBands`, `labels`, `interact` | **implemented** (runtime handlers live in `src/full-world.js`) |

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
   - `between: ["sand", "water"]` → the boundary band: cells of A orthogonally touching a
     cell of B, grown `band_px` wide (the seed row counts as the band's first row) across
     **both** surfaces. A `shore_line` slot therefore owns the wet sand *and* the first
     strip of water, because the shells go on one and the floats on the other.

Each slot keeps two views: the walkable free cells a scatter pass may stand on
(`cells` in the stats) and every cell in the band (`band_cells`). Water stays in the
second view only, and only a role the surface's `roles_allowed` admits can reach it —
that is how a `water_prop` gets to the sea without anything else following it in.

*TODO (W2-B):* auto-route paths between district entrances and landmark anchors (A\* over
free cells), emit them as patches, and reserve the corridor.

### C — Landmarks

Pinned hero objects from `landmarks[]`, largest footprint first, because big inflexible
pieces must claim space before anything small can box them out. `pin: true` means the
anchor is authoritative and must not drift. Per landmark: resolve `me`/`exs` → footprint
via the catalog, snap the anchor so the *sprite* lands on the tile lattice, move it to a
cell whose surface the object accepts (a spiral search out to 3 tiles — skipped entirely
when `pin: true`, which either works where the spec put it or is dropped), reject when
`occ.overlap_ratio()` exceeds 0.30, claim with a clearance halo, and reserve a one-tile
apron in front of anything carrying an `interact` verb so the counter stays reachable.
Then emit `{me, prefer?, x, y, origin, solid, interact?}`. A landmark may also name a
`grp`, in which case pass D's atomic placement runs at that exact anchor.

Marking real obstacles `solid: true` also buys the district a free service from the merge:
`merge-city-plan.py` prunes auto-placed street lamps and trees that land inside any solid
non-structure footprint.

### D — Groups

Expands `grp.*` recipes into multi-stamp assemblies. A recipe (W0-C format) declares
`footprint_tiles`, an `anchor` origin, and `pieces[]` carrying `me`/`exs`, a tile offset
`dx`/`dy`, size, origin and `solid` — e.g. `grp.beach.volley_court` is 12 pieces on a 7×6
tile footprint: two net posts, the modular net panel, eight modular sand court-line tiles,
and a ball mid-court.

A group is **atomic**: either every member lands at `anchor + (dx, dy) × 16` or the whole
group is rejected. This is the direct fix for mistake #1 (stamp collage instead of composed
scenes) and for coverage tier D — fragment Singles like a lone modular court-line tile must
never be stamped solo.

The pass **pre-validates** every referenced recipe first (each piece resolvable, each
offset inside the declared footprint), then samples `count` anchors from the named slot's
free cells in a seeded order and tests each one:

- the union footprint may not touch a `RESERVED` cell — circulation is absolute;
- ≥80% of the union's cells must be the recipe's `surface`, folded onto one of the five
  real surfaces through the rules' `registry_aliases` (recipes say `"ground"`, the surface
  map says `grass`). An unknown surface name means *no constraint*, never *reject*;
- each piece is tested against what **earlier passes** claimed, not against its own
  siblings — pieces overlap each other by design, that is what makes a scene.

Pieces are emitted with their `exs` (a recipe names an exact Single, and some of those
`me.*` roll-ups are not in the placement index at all), and the group's `interact` verb
goes on its first solid piece — the thing a player walks up to — not on all eight
court-line tiles.

### E — Props

Per-slot scatter. The candidate pool is enriched `me.*` (W1-A), filtered by:

- the **slot archetype's** `roles` — the archetype decides what belongs in it, not the
  spec, so a `canopy` density on an `interior_fill` slot is pass F's job and E says so in
  its stats instead of placing it;
- the biome (`biomes_allowed`, plus the always-drawable `universal` kit) and its
  `forbid_tags`;
- **both directions of the surface contract**: the role's `surfaces` and the surface's
  `roles_allowed`. A row's own primary surface is a hard constraint only across the
  walkable/unwalkable line — a pool float must stay on water and a sand mound must stay
  off it, but a sunbed filed under `grass` is fine on sand;
- a **tier-D guard**: `group_only` rows plus the modular autotile pieces, sheet
  `Example_*` cutouts and bare shadows the enrichment did not catch;
- **palette tiers**: `palette` first, `palette_secondary` only if the primary tier is
  empty. Treating them as one set is how a beach ends up with pine trees on it — camping
  conifers score on `festive_market`.

Each role's `density` level resolves through the rules into `props_per_kilopx2` (the count,
over the slot's usable area), `min_spacing_mult` (scaling the role's own `spacing_px`) and
`jitter_px` (sub-tile offset for `align: free` roles), so "dense" means the same thing in
every district.

Variant selection is **coverage-aware**: candidates rotate least-used-first, and within a
candidate the Single is chosen by palette score among the variants that share the id's
canonical footprint (so a `Grey_Shell` family never yields a signboard) with a penalty on
Singles this district already spent. That is what turns a compile into coverage instead of
repeating the same six PNGs (mistake #2, coverage tier C).

### F — Canopy

Overhead cover (parasols, palms, awnings, market tents) last among the solids, because it
overhangs what pass E placed and must see the ground props to avoid burying an interactable
or blocking a sightline. The rules give `canopy` `layer: overhead` with a y-sort depth bias
and `collision: none` — its tile stays walkable, so it claims `CLEAR`, not `SOLID`, and it
is the one role allowed to stand on a cell pass E dressed with `DECOR`. Its *ground* claim
is one tile, not the sprite's full width: a parasol has a single pole, and its shade is
supposed to fall across the loungers. Candidates come from `passes.F_canopy.candidates`
when the spec names them, otherwise from the enriched pool (where a parasol filed
`furniture_ext` is promoted on the strength of the `canopy` role's own `tags_any`).

### G — Detail

High-count, zero-collision dressing — shells, starfish, sand holes, litter, decals — into
cells that are still empty. Claims `DECOR` only and never sets `solid`, so pass G cannot
create an `OVERLAP` defect by construction. It runs `decor_small` and `water_prop` over
every slot that declares them, but never above `medium`: pass E already spent the slot's
headroom at the declared level, and G is the sweep-up.

### H — Life

Everything that makes the district move or respond: `anims`, `animBands` (including the
water surfaces pass A reserved, with `shore: "top"` foam), `vehicles`, `labels`, `portals`
and NPC anchors. Frame math is validated against sheet dimensions to pre-empt `BADANIM`.

Then `interactions{}` is wired onto the stamps C–G actually chose — which is why this runs
last. `"auto"` matches the verb's rules entry (role + `tags_any`) or the asset's own
enriched `interact`; an explicit list matches by `me` id, or by the `grp` recipe that
emitted the stamp (in which case only the group's primary piece is wired). A verb pass C
or D already attached wins and is counted, never overwritten.

*TODO (W4-A):* the runtime handlers in `src/full-world.js`, and `npc_anchor` spawn hints —
`npcs` entries need a `char` the renderer can spawn, which the compiler cannot invent.

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
`check-city-plan.py` flags at 35%. The compiler rejects above **0.30**, leaving the merge's
own nudges some headroom, so a compiled district is clean because it was never allowed to
be dirty.

Cells and sprites are deliberately different things:

| | what it covers |
|---|---|
| **claim** (a solid) | the bottom **24px band** of the sprite — exactly the collider `src/full-world.js` builds for `solid: true`, so the grid can never disagree with the runtime |
| **claim** (a non-solid) | the full sprite rect, as `DECOR` or `CLEAR` |
| **ground test** | the same 24px band (one tile wide for an overhead piece) — what must be *free* is the ground the sprite stands on, not the whole PNG |
| **overlap test** | the full sprite rect, solids only — the pair the QA gate compares |

That split is why a 64×80 palm costs one tile row instead of five, and why a parasol may
shade a lounger without either of them being a defect.

`constraints{}` are live budgets, not decoration: `max_stamps`, `min_free_cell_ratio` and
`max_solid_cell_ratio` stop a scatter mid-role rather than being reported after the fact,
and `budget_breaches()` prints anything a compile still could not honour.

### Determinism

`ctx.rng(pass_letter, salt)` returns a `random.Random` seeded from
`seed:district_id:pass:salt` — one stream per pass, and per slot or recipe within a pass,
never a shared global stream. So adding pass G does not reshuffle what pass E placed, and
re-running with the same spec, seed and catalog reproduces the fragment **byte for byte**
(the `_compiled` block deliberately carries no timestamp). Diffs stay reviewable.

### Provenance

Every fragment carries a `_compiled` block: spec path, seed, rules version, coords mode,
per-pass stats, occupancy stats, a `coverage` block (stamps, unique `me.*` ids, unique
Singles, and whether `coverage_target_singles` was met) and any unresolved catalog ids.
`_doc` marks the file generated. When a district looks wrong, the fragment itself says
which spec and seed made it.

Per-pass stats are written to be read: every scatter reports `placed` against `want`, how
many `attempts` it took and how big the candidate `pool` was, and every rejection carries
its reason (`no candidates`, `not a plaza role`, `0/2 placed in clearing`). A thin district
tells you *why* it is thin.

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

`merge-city-plan.py` globs `data/city-specs/d*.json` by default — **non-recursive**, so
`data/city-specs/generated/` is deliberately *outside* the merge, so recompiling a district
can never disturb the currently-clean QA gate by accident.

**W2-C landed the promotion switch:** pass `--include-generated` to also merge
`data/city-specs/generated/d*.json`, keeping generated and hand-authored fragments in
visibly separate directories with zero risk to the default (no-flag) merge, which is
byte-for-byte unchanged.

```bash
python3 scripts/merge-city-plan.py                     # hand-authored districts only (unchanged default)
python3 scripts/merge-city-plan.py --include-generated # + every data/city-specs/generated/d*.json
```

Either way the compiler must respect what merge already does:

- **Filename** must start with `d` and end `.json`; **never** `d00*`, which merge treats as
  structure furniture eligible for pruning.
- Merge resolves `me`/`exs` → `img` before footprint math, so compiled stamps must carry
  `me`/`exs` and may carry `prefer`.
- Merge prunes `d00` street furniture that lands inside any solid non-structure footprint —
  compiled solids get that cleanup free.
- Merge nudges building-keyword stamps off the street grid. Compiled districts should not
  need it; if the nudge count rises after a compile, pass B under-reserved.

### `--compiler-replaces HAND`: full district migration (W6-B)

`--include-generated` is additive — it keeps the hand district's own stamps/anims AND
appends the compiled fragment's, which is why the promotion flow above only ever points it
at a district whose hand fragment has already been emptied out. **Full district
migration** — swapping a hand district's exterior stamps for compiler output while it is
still sitting in `data/city-specs/d*.json` — needs a surgical merge instead:

```bash
python3 scripts/merge-city-plan.py --compiler-replaces HAND
```

Per hand fragment `data/city-specs/d{N}-*.json`, if a matching
`data/city-specs/generated/d{N}-compiled.json` exists:

| Taken from the **compiled** fragment | Taken from the **hand** fragment |
|---|---|
| `stamps`, `anims`, `labels` | `roads`, `solids`, `animBands`, `portals`, `npcs`, `vehicles` |
| `patches` too, **if** the spec set `compiler.full_bbox: true` | `patches`, otherwise (the compiler only painted a pocket, so the hand ground plan is still authoritative outside it) |

Districts with no `d{N}-compiled.json` merge unchanged. `--include-generated` and
`--compiler-replaces` are mutually exclusive — passing both is a no-op for
`--include-generated` (a printed note explains why): every generated file
`--compiler-replaces` needs is already folded in per-district.

```
--compiler-replaces HAND: 6 compiled district(s) available: [6, 7, 9, 10, 11, 13]
compiler-replaces summary:
  D10: d10-camping.json -> d10-compiled.json  stamps 51->300, anims 5->5, labels 1->1, patches from generated (9)
  D11: d11-industrial.json -> d11-compiled.json  stamps 60->220, anims 5->5, labels 1->1, patches from generated (3)
  D13: d13-subway.json -> d13-compiled.json  stamps 60->320, anims 5->5, labels 2->1, patches from generated (4)
  D6: d6-residential.json -> d6-compiled.json  stamps 59->420, anims 9->5, labels 2->1, patches from generated (10)
  D7: d7-park.json -> d7-compiled.json  stamps 60->400, anims 8->5, labels 1->1, patches from generated (11)
  D9: d9-graveyard.json -> d9-compiled.json  stamps 60->280, anims 8->7, labels 1->1, patches from generated (4)
```

**Full-bbox specs** live in `data/city-specs/biome-specs/full/d{N}-{biome}.json` — same spec
format as any other biome-spec, but sized to cover the *entire* hand district's footprint
(`compiler.full_bbox: true`) rather than a pocket, and usually with a corrected `bbox`: several
hand districts have a stale declared bbox that no longer matches where `relocate-district.py`
actually left their content (`data/city-specs/EXTERIOR-MISTAKES.md` #4) — the full-bbox spec
uses the district's *real* footprint, verified clear of its neighbours, and documents the
correction in its own `_doc`. Compile each the normal way:

```bash
python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/full/d6-residential.json --qa -v
```

**W6-B migrated six priority districts** this way — every one compiles standalone with
`defects: none`, and the full city plan is `defects: none` after `--compiler-replaces HAND`:

| District | Biome | Hand stamps | Compiled stamps |
|---|---|---:|---:|
| D6 Residential | residential | 59 | 420 |
| D7 Grand Park | park | 60 | 400 |
| D9 Graveyard/Memorial | memorial | 60 | 280 |
| D10 Camping/Wild | wild | 51 | 300 |
| D11 Industrial Yard | industrial | 60 | 220 |
| D13 Subway/Transit | transit | 60 | 320 |
| **Total** | | **350** | **1940** |

Full city plan: **1215 → 2790 stamps** (+1575) merging these six via `--compiler-replaces
HAND`, still `defects: none` (the delta isn't a clean 1:1 with the table above because
`merge-city-plan.py`'s structure-furniture pruning and building-nudge steps react to the new
stamp set too — see below).

**Two merge-time collision fixes came out of this migration**, both in the post-merge
cleanup steps, neither behind a flag (they apply to every merge, `--compiler-replaces` or
not, and are provably non-regressive — the default hand-only merge stays `defects: none`
with the identical `pruned`/`nudged` mechanism):

- *Structure-furniture pruning* used to ignore any obstacle under 24×24px ("tiny decals
  don't matter"). The compiler's `G_detail`/`E_props` passes place real 16×16–32×16 solid
  decor (rocks, wood scraps, flowers) far denser than any hand district did, so that floor
  started letting auto-placed lamps/trees land right on top of them. The floor is gone, and
  the overlap-ratio test now divides by whichever rect is smaller (obstacle or furniture),
  so a tiny decal fully swallowed by a lamp's footprint is caught exactly like a lamp
  swallowed by a building.
- *Building-off-street nudging* keys off filename substrings (`"school"`, `"villa"`, …) that
  false-positive on non-building props filed in the same catalog folder (a bleachers prop
  under `13_school/`, a tree house under `7_villas/`). The nudge's collision guard checked
  the candidate spot against other buildings and roads only — extended to check against
  every solid stamp, so a nudge can't shove a falsely-flagged prop onto compiler-placed decor
  that wasn't there when the heuristic was written.

### Promoting a compiled district

Once a district's fill passes (C–G) are far enough along that you want it live in
`data/city-plan.json`, promote it like this:

1. **Compile** the spec (and iterate until `--qa` is clean):

   ```bash
   python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/<biome>.json --qa
   ```

   This writes `data/city-specs/generated/<id>.json` (per `compiler.out`, default
   `data/city-specs/generated/<id>.json` — leave it there; only the `generated/` directory
   is picked up by `--include-generated`).

2. **Merge with the flag** to fold it into the live plan:

   ```bash
   python3 scripts/merge-city-plan.py --include-generated
   ```

   The console reports `including N generated fragment(s): [...]` so you can confirm
   exactly which files were folded in.

3. **Gate on QA** — the merge step already shells out to `check-city-plan.py`, but always
   re-run it standalone and require exit code `0` before committing:

   ```bash
   python3 scripts/check-city-plan.py
   ```

4. **Check catalog coverage** (optional but recommended — confirms the promoted
   district is actually spending new Singles, not just adding empty patches):

   ```bash
   python3 scripts/report-ext-catalog-coverage.py
   ```

5. **Commit both** the spec's generated fragment (`data/city-specs/generated/<id>.json`,
   so reviewers can diff what compiled) and the regenerated `data/city-plan.json`.

To un-promote (pull a district back out while it's reworked), just go back to running
`merge-city-plan.py` without `--include-generated` and commit the regenerated
`city-plan.json` — nothing needs deleting since the fragment lives outside the default
glob.

Full loop:

```bash
python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json --qa
python3 scripts/compile-city-structure.py
python3 scripts/merge-city-plan.py --include-generated   # resolves me/exs, prints QA
python3 scripts/check-city-plan.py                        # exit 0 required
python3 scripts/report-ext-catalog-coverage.py            # advisory: catalog usage delta
python3 scripts/audit-placement-logic.py                  # advisory
python3 scripts/render-city-preview.py --crop 3120 4816 3520 5096   # x0 y0 x1 y1
```

---

## QA contract

The compiler is designed so `check-city-plan.py` cannot find these defects, rather than
fixing them after the fact:

| Defect | Prevented by |
|--------|--------------|
| `OVERLAP` | occupancy `SOLID` claims + `overlap_ratio` reject at 0.30, below the 0.35 the gate flags |
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
                     'wet_sand': {…'cells': 66, 'band_cells': 125,
                                  'derived_from': 'surface_boundary'}}}
  pass C_landmarks  {'placed': 3, 'groups': 0, 'group_stamps': 0, 'pending': 0}
  pass D_groups     {'groups': 1, 'stamps': 12, 'pending': 0, 'recipes_checked': 1}
  pass E_props      {'placed': 27, 'slots': 4, 'by_slot': {'lounge': {'furniture_ext':
                     {'placed': 10, 'want': 10, 'attempts': 36, 'pool': 20}, 'canopy':
                     'not a interior_fill role', …}, …}}
  pass F_canopy     {'placed': 6, 'by_slot': {'lounge': {…}}, 'candidates': 'spec'}
  pass G_detail     {'placed': 3, 'by_slot': {…}, 'candidates': 'spec'}
  pass H_life       {'labels': 1, 'anims': 2, 'animBands': 1,
                     'interactions': {'sit': 16, 'shop': 1, 'read': 1, 'play': 1}}
compiled seed=21084: {'patches': 3, 'stamps': 51, 'anims': 2, 'animBands': 1, 'labels': 1}
coverage: 50 unique Singles from 51 stamps (39 me.* ids), target 45 MET
checked data/city-specs/generated/d18-beach-lounge.qa.json: 51 stamps
defects: none
```

---

## Load-time atlas (W4-B / W6-C)

`scripts/build-ext-atlas.py` packs every unique Singles PNG referenced by
`data/city-plan.json` stamps into one sheet:

```bash
python3 scripts/build-ext-atlas.py
#   964 images -> 1 atlas page(s)
#     page 0: atlas.png (4094x1210)
#   HTTP requests: 964 singles -> 1 atlas page(s), 963 fewer requests
```

Output lands in `assets/limezu/ext-atlas/`:

- `atlas.png` — every packed stamp PNG on one (or more, past `--max-size`) page(s).
- `atlas.json` — frame map: `frames["ext/singles/…png"] = {x, y, w, h, id?, page?}`,
  plus `pages[]` metadata. `page` is only present once a plan outgrows a single
  4096×4096 page (not the case today — 964 images fit on one 4094×1210 page).

**Wired into `src/full-world.js`** (W6-C): `buildFullWorld()` loads `atlas.json`
+ `atlas.png` as a normal Phaser image (`fw_ext_atlas`) alongside the rest of the
first-pass assets. Once loaded, `setupExtAtlas()` registers every page-0 frame as
a named sub-frame of that one texture via `texture.add(planKey(img), 0, x, y, w, h)`
— Phaser's native texture-atlas mechanism, so a stamp draws with
`scene.add.image(x, y, 'fw_ext_atlas', frameKey)` instead of its own texture.
`renderCityPlan()` then skips queuing an individual `scene.load.image()` for any
stamp whose `img` the atlas already covers, and logs the hit rate:

```
[FullWorld] ext-atlas: ready — 964 frame(s) from assets/limezu/ext-atlas/atlas.png
[FullWorld] ext-atlas: 1764/1764 stamp refs (100%) served from the atlas — 0 stamp refs
fell back, 0 actual individual GET(s) queued (atlas on)
```

Any stamp added after the last atlas build (or any run with the atlas
missing/failed) automatically falls back to its own individual
`scene.load.image()` — the atlas is a pure load-time optimization, never a hard
dependency. **Re-run `build-ext-atlas.py` after merging plan changes** that add
new `img` references, or the hit rate drifts down toward the fallback path.

Debug: append `?world=full&atlas=0` to disable the atlas entirely (every stamp
falls back to an individual load) — useful for A/B-ing load time or isolating an
atlas-only rendering bug.

Multi-page atlases (image set outgrows one 4096×4096 sheet) are not wired yet —
`setupExtAtlas()` only loads/registers page 0; frames on any later page fall
back to individual loads until a second `fw_ext_atlas_1`-style texture is added.

---

## What is left

The pipeline, validation, emitter and QA contract are settled; every pass is a single
function returning a stats dict, so the remaining work is additive.

1. **B** — auto-route paths (A\* over free cells) between district entrances and landmark
   anchors, emit them as patches and reserve the corridor. Pure geometry (W2-B).
2. **W2-C** — make `--include-generated` the default once the generated districts are
   reviewed (the switch itself already exists), and re-baseline the coverage report.
   `--include-generated` merges clean today: 1266 stamps, 0 defects, 0 missing.
3. **W3** — roll the remaining biome specs. Nothing in the compiler is beach-specific; a
   biome needs enrichment coverage for the roles its slots declare, which is where a thin
   pass shows up as `{'placed': 0, 'skipped': 'no candidates'}`.
3b. **W6-B follow-on** — seven hand districts still have no full-bbox spec:
   `d1-mainstreet`, `d2-shopping`, `d3-station`, `d4-foodmarket`, `d5-civic`, `d8-beach`,
   `d12-military` (plus `d14-farm`/`d15-downtown`/`d16-interiors`/`d17-life` if in scope —
   `d16`/`d17` are interiors-flavoured and may not need it at all). Same recipe as the six
   done: derive the district's *real* footprint (not necessarily its declared `bbox` —
   check `EXTERIOR-MISTAKES.md` #4 first), write
   `data/city-specs/biome-specs/full/d{N}-{biome}.json` with `compiler.full_bbox: true`,
   compile with `--qa` until clean, then re-run
   `merge-city-plan.py --compiler-replaces HAND` and `check-city-plan.py` to confirm the
   full plan is still `defects: none`.
4. **W4-A** — `npc_anchor` → `npcs` (the renderer needs a `char` per NPC that the compiler
   has no basis to choose). The runtime `interact` handlers are done: `merge-city-plan.py`
   carries the verb through the me→img resolve untouched, and `src/full-world.js` collects
   every tagged stamp into `state.interactables` (footprint, verb, `me`, `img`, anchor) and
   runs `sit` / `read` / `shop` / `play` / `enter` when the player is within 48px and presses
   E, Space, the mobile action button, or taps the object. Each interaction also fires a
   `denizen:city-interact` window event, so a real shop or quest system can hook the verbs
   without touching the renderer.
5. **W4-C** — the extra QA gates: biome violation, coverage regression against the previous
   compile, and turning `budget_breaches()` from a warning into a gate.

Two data-quality notes for whoever owns the catalog, since the compiler can only place what
the enrichment describes: `me.beach.seagull` is filed `vegetation` (so it lands as a solid
obstacle), and several beach `me.*` roll-ups referenced by group recipes are missing from
`placement-index.json` — pass D works around that by emitting the piece's `exs`.
