# City Restructure Plan — THE NEXT SESSION STARTS HERE

User verdict on the current city (2026-07-22): districts are islands on a
grass void; sprites read misplaced; no real urban structure. Correct. The
fix is structural, and the reference material we never used is the set of
FULL-CITY example maps in the gallery scratch dir:

    scratchpad/ext-refs/gallery/50.png  (2360x1875 — biggest native PNG)
    scratchpad/ext-refs/gallery/26.png  (2444x1356)
    scratchpad/ext-refs/gallery/62.gif  (2656x1502)
    scratchpad/ext-refs/gallery/25.gif  (1608x1346)
(If the scratchpad is gone, re-download: itch.io modernexteriors gallery,
`/original/` URLs — see scripts in git history, commit aa5e068.)

## What was in flight when the session hit its usage limit

A workflow (`city-structure-grammar`) was launched to pixel-measure those
maps and derive the CITY STRUCTURE GRAMMAR. All 5 agents failed on the
session limit before doing any work. Re-run it first — the script is saved
at the workflows dir, run id wf_a1444212-04e, or just re-issue: 4 agents
measure (grid module, road+sidewalk widths, block sizes, paving coverage,
building setback/spacing/party-walls, prop rules, edge transitions), 1
synthesizes `data/city-specs/structure-grammar.md` ending with a concrete
street-grid proposal for our 6144x6400 world.

## The plan (agreed direction)

1. **Structure grammar** (above) — numbers, not vibes.
2. **City compiler tool** (`scripts/compile-city-structure.py`): master
   grid spec (JSON: arterial + local roads, blocks) → GENERATES the roads,
   sidewalks, and full block paving programmatically. Structure comes from
   code; agents only dress blocks. Core rule from the user: the urban core
   must be CONTINUOUS fabric — no grass voids between buildings; grass
   only in parks and at the rural edge (farm/camping/graveyard/beach).
3. **Placement QA tool** (`scripts/check-city-plan.py`): detect stamp
   overlaps, floating props (no ground patch beneath), off-block
   buildings, solids blocking roads. Run in every merge.
4. **Re-fit districts onto blocks**: each district gets assigned block
   footprints from the compiled grid; agents re-fit their fragments INTO
   the blocks (buildings flush to sidewalk edges, LimeZu setbacks),
   using render-city-preview.py eyes as before.
5. **NAS database as persistent build memory** (user explicitly asked):
   supabase Postgres on the NAS — access pattern in
   `infra/create-demo-org-nas.py` (docker exec psql, password from
   /volume1/docker/supabase-project/.env). Create:
   - `limezu_assets(path, kind, theme, w, h, tags)` — full catalog of all
     ~9k extracted sprites with dimensions (build it locally with PIL,
     bulk-insert via psql COPY).
   - `city_state(key, value jsonb, updated_at)` — build state, decisions,
     door pairings, district status; so any future session pulls context
     from the DB instead of re-deriving.
6. Merge, browser-verify at play zoom in MANY spots, deploy, commit.

## Current state (all committed through 5e0fa708)

- 17 district fragments in data/city-specs/d*.json + preview PNGs
- data/city-plan.json: 940 stamps, 96 anims, 23 animBands, 30 npcs,
  4 vehicles, 14 portals; world 6144x6400
- Engine (src/full-world.js): declarative renderer — patches/roads/
  stamps/anims/animBands/solids/labels/portals(teleport+href)/npcs/
  vehicles; always-fresh plan fetch; per-district preview tool
  scripts/render-city-preview.py; merge via scripts/merge-city-plan.py
  (wires subway + shop-door teleports automatically)
- Interiors band (y5700-6300): 5 walkable shops with two-way doors
- Known issues queue: D3/D12 bbox overlap (~x5200-6100 y1600-2100, both
  claim it — noted by the LIFE agent); wave-3 in-browser smoke never ran
  (pane was hidden); load time ~2min on dev server (consider a packed
  texture atlas later); D4 overlaps the legacy plaza props (jumbled).
- The legacy hand-coded zones (plaza/HQ shell/japanese/security/studio in
  full-world.js `build()`) should eventually migrate into plan fragments
  so the compiler owns ALL structure.

## Deploy notes

NAS: docker cp pattern (see infra/deploy-full-world-nas.py). ext assets +
farm/cut + new singles already deployed through wave 3. Only changed code/
data need pushing next time.
