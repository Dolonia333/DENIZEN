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
- [x] Street filler between buildings (`placeStreetFiller`)
- [ ] Roof caps on plain voice/text office-park buildings (still painted rects)
- [ ] Section palette shifts along the block

### Stage 2 — NPC life — done
- [x] All 14 anim rows registered in `makeAnims`
- [x] Ambient dwell: wave / shrug / snicker / jump (`tickAmbient`)
- [x] Two NPCs same room → face + wave
- [x] Player sit / lie (pre-existing)
- [x] Ambient eat near food spots
- [x] UI emotes above heads on pose
- [ ] Chat bubble sprites behind soft-text speech (assets ready; not wired to presence text)

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
- [ ] Jump on door enter
- [ ] hurt anim on rate-limit events
- [ ] More room recipe variants

## Verification
1. `node --check discord-map/game.js`
2. Open `discord-map/test-anim.html` or `/discord-map/` with bot presence
3. Expect: roofs on themed shells, street houses between blocks, pets, food, HUD, ambient waves
4. Console: minimize `[map] asset failed` lines
