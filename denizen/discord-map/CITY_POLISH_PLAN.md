# Discord Map — "City Block" Polish Plan

**Goal:** the map reads like the Pixel Spaces store example — a polished city
block you walk down, one building per Discord category, every room designed
(not random), NPCs using **every** animation row, food, pets, pack UI.

**Status (2026-07-16):** Grok finished Claude's incomplete Stage 1–4 wiring.

---

## Room grammar

1. **Plaque, not text badge**: UI panel-tab + name + up to 3 stars (occupancy).
2. **Vertical composition**: wall band → furniture line → baseboard.
3. **Semantic clusters**: anchor + satellites; climb lane clear.
4. **Left lane stays clear** (elevator shaft dx 14–58).
5. **Purpose read**: glanceable room identity.

## Building grammar

1. **Real roof** on themed buildings (`drawRoofCap` + theme `roofKey`).
2. **Foundation** dirt strip under themed buildings.
3. **Street rhythm**: building → filler (house/shop/bench/tree) → next building.
4. Section palette / day-night still backlog.

---

## Stages

### Stage 1 — Look — mostly done
- [x] Roof sprite caps on themed buildings
- [x] Dirt foundation under themed buildings
- [x] UI panel-tab room plaques + star occupancy (`updatePlaqueStars` from presence)
- [x] Plaque stars INSIDE the tab (2026-07-17 — no more wall-decor collisions)
- [x] Street filler between buildings (`placeStreetFiller` + lamppost/hydrant/billboards)
- [x] Roof caps on plain voice/text buildings
- [x] Text building dynamic grid — odd last room spans full width, no dead slabs
- [x] Voice building content-driven height — no empty placeholder rooms
- [x] Storefront ground bands: lit windows flank the enter prompt (all shells)
- [x] Backdrop extended across full world width (`extendBackdrop`: clouds,
      ridges, skyline, hills, pack blimps) — zones no longer sit in bare cyan
- [x] Status happiness faces only for voice members (text members were all
      wearing the blue "meh" face)
- [x] Roof ridge fix (2026-07-18): gable connecting tiles were buried under the
      walkable deck rail — only end eaves showed. Lift ridge above the deck and
      tighten end↔connector joints so pitched roofs read as one continuous cap.
- [x] Wall decor collision: occupancy list per room (kit items + seeded extra
      + plaque zone) — skip, never stack
- [x] Door clearance: furniture bands start past the climb-door leaf edge
      (+~20px) in both decorateRoom and themed recipes (edge-aware lane skip)
- [x] Pack door art (2026-07-18): street entrances use `Door_*_double.png`
      (wood/glass/grey by theme); climb doors get indoor frames + ajar
      `*_opened` leaves; approach swaps street doubles → opened texture
- [x] Atmospheric perspective: mid mountains/ridges tinted blue-grey at
      ~0.6 alpha, extendBackdrop repeats match originals, billboards muted
- [x] Phaser vendored locally (phaser.min.js) — CDN outage no longer kills
      the map
- [x] No door on rooftops — climb up/down works without a leaf standing on
      the deck (stairs interaction unchanged)
- [x] Room-to-room passages show a real side-view door leaf in the shared
      wall opening
- [x] Block Park at the end of the street (replaces the scaled-tree "green
      box"): trees, bushes, lamppost, umbrella snack table, sittable benches
- [x] Real street: concrete sidewalk + curb + asphalt road with dashed
      centerline, storm drains, manholes (was sidewalk over bare dirt)
- [x] Background layers locked vertically (scrollFactor sf,1) — no more
      floating skyline blocks / drifting horizons in open zones
- [x] HUD safe-area layout (layoutHud): ENVELOP crops the design edges on
      16:9 hosts — panels/clock now inset to the visible rect, re-laid on
      resize and zoom changes; event strip hidden until it has content
- [x] Section palette shifts along the block
- [x] Elevator doors (2026-07-18): hospital/police/museum/gamer climb
      lanes use `Elevator_*` pack art; proximity opens/closes
- [x] Soft-text pack chat bubbles + shadow behind presence captions
- [x] Jump/step-in on door enter / floor climb / leave
- [x] Animation tuning: slower walk/idle, longer eat, less ambient wave spam

### Stage 2 — NPC life — done
- [x] All 14 anim rows registered in `makeAnims`
- [x] Ambient dwell: wave / shrug / snicker / jump (`tickAmbient`)
- [x] Two NPCs same room → face + wave
- [x] Player sit / lie (pre-existing)
- [x] Ambient eat near food spots
- [x] UI emotes above heads on pose
- [x] Chat bubble sprites behind soft-text speech (assets ready; not wired to presence text)
- [x] Hospital ward cast (2026-07-18): expansion nurse/surgeon sheets, patients in beds, staff attend bedside; Discord members in hospital channels claim beds
- [x] Anonymous street cast (2026-07-18): `spawnDecorNpcs` sidewalk life + curb strollers (BlockLife residents still off)

### Stage 3 — Food + pets — done
- [x] Pixel Platter on cafe/kitchen/lounge surfaces + theme table hosts
- [x] Player E near food → `eat` / `eatSit`
- [x] Cats + dogs spawn (street dog walk; cat near couch)
- [ ] ⚠ LICENSE: free pet packs are NON-COMMERCIAL — swap to paid before sale

### Stage 4 — HUD — partial
- [x] Server-name panel + block/room counters (scrollFactor 0)
- [ ] Minimap strip
- [ ] Settings/help buttons

### Stage 5 — Backlog
- [ ] Day/night cycle
- [ ] Weather
- [ ] NPC street pathing between buildings
- [x] Jump on door enter
- [ ] hurt anim on rate-limit events
- [ ] More room recipe variants

## Verification
1. `node --check discord-map/game.js`
2. Open `discord-map/test-anim.html` or `/discord-map/` with bot presence
3. Expect: roofs on themed shells, street houses between blocks, pets, food, HUD, ambient waves
4. Console: minimize `[map] asset failed` lines
