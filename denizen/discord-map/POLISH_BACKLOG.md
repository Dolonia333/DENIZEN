# Discord Spaces — polish backlog

Use with **SPRITE_INVENTORY.md** (numbers) and **ARCHITECTURE.md** (how systems work).  
Goal: use **more of the packs**, cleaner placement, better-looking motion.

Inventory snapshot (regenerate often):

```bash
node discord-map/scripts/inventory-sprites.mjs
```

Approx pack size: **~2140 PNG** · **~1500+ unused candidates** (heuristic).

---

## Priority tracks

### A. Animations (NPCs)

| Task | Where | Notes |
|------|-------|-------|
| Tune walk cycle fps | `NPC_POSE_DEFS.walk` | Currently snappy; try 6–8 fps |
| Idle micro-motion | `idle` | Longer hold, lower fps |
| Sit/lie plant | `NPC_FOOT_ORIGIN_Y`, `SEAT_INFO` | Feet vs cushion |
| Eat readability | `eat` / `eatSit` + `actorEatFood` | Longer repeat, face plate |
| Transition poses | sitFinish / lieFinish | Don’t cut off early |
| Ambient variety | `playAmbientPose` | Use shrug/snicker/wave less spammy |
| F9 gallery QA | `toggleAnimGallery` | Verify every row on all 30 sheets |

**Player debug:** keys 1–6, F8 cycle, F9 gallery.

### B. Sprite placement

| Task | Where | Notes |
|------|-------|-------|
| Room density | `KITS` / `decorateRoom` | Sparse > clutter; avoid climb lane |
| Alignment to floor plank | `furn` origin | Bottom origin on `floorY` |
| Surface props | `SURFACE_HOSTS`, `onSurface` | Laptops/food on tables not mid-air |
| Multi-room parity | text buildings vs themed | Same rules both paths |
| Roof props | rooftop registerFloor | Vents/trees already partial |
| Street filler | outdoor hangouts | Use more Backgrounds pack |

### C. Food (PacksExtra / Pixel Platter)

| Task | Where | Notes |
|------|-------|-------|
| All plates visible | `FOOD_SCALE`, depth | Scale ~1.35 now |
| Host coverage | `seedFoodOnAllTables` | Every table/counter |
| Meal frequency | `block-life` eat hours | Brunch/lunch windows longer |
| Eat feedback | bob + emote | Optional crumbs / empty plate |
| More meals in kits | cafe / kitchen kits | `{ food: true }` entries |

### D. Emotes & UI (mostly unused)

Pull from `PixelSpacesFull/UI/`:

| Folder | Use for |
|--------|---------|
| `Emotes/` | Bubble above NPC on wave/love/argue |
| `Chat Bubbles/` | Speech when socializing |
| `Icons/` | HUD, map markers, channel types |
| `Buttons…` | Future mobile chrome |

Wire into `showEmote` map + `pushLifeEvent` UI.

### E. Expansions (large unused pool)

`PixelSpacesFull/Expansions/`:

- Cafe · Fire Station · Gamer Room · Halloween · Hospital · Museum · Police · Archaeology · Winter 2023/24

**How to adopt one expansion:**

1. Add paths under `ASSETS`.
2. Create or extend a kit in `KITS` / specialty `draw*Building`.
3. Map Discord channel keywords → kit (see name heuristics near `pickKit`).
4. Re-run inventory; unused count should drop.

### F. Pets & animals

- Free packs only in `PacksExtra` (non-commercial).
- More dirs / idle frames; leash-to-owner already soft-bound.
- Future: paid Paws & Whiskers full packs if licensed.

### G. Backgrounds & street

Many `Backgrounds/` (blimps, tents, flowers, houses) are candidates for:

- Parallax far layer
- Gap fillers between buildings
- Seasonal / guild-theme outdoor strips

---

## “How it was done” cheat sheet (this branch)

1. **Air walk fix** — graph pathing; remove Y teleports in `driveResidents`.
2. **Community not work** — rewrite `getActivity` + job tags → activity labels.
3. **Real food** — register full platter; host list; `actorEatFood`.
4. **Organize packs** — keep three roots; inventory script; docs for collaborators.
5. **NAS** — `hotfix-discord-map-nas.py` syncs local tree to docker.

---

## Suggested PR slices (parallelizable)

| PR | Scope | Risk |
|----|-------|------|
| 1 | Emote + chat bubble wiring only | Low |
| 2 | Cafe expansion room kit | Med |
| 3 | NPC pose timing pass | Low |
| 4 | Halloween outdoor strip | Med |
| 5 | Seat/surface height audit + screenshots | Med |
| 6 | Replace free pets with licensed pack | Policy |

---

## Local checklist before PR

- [ ] `node --check discord-map/game.js`
- [ ] `node --check discord-map/block-life.js`
- [ ] Hard refresh play.html — no console texture errors
- [ ] Enter door, climb stairs, sit, eat (player + watch NPC)
- [ ] `node discord-map/scripts/inventory-sprites.mjs` if you added files
- [ ] Bump `play.html` `?v=` if caching fights you

---

## Screenshots / debug dumps

Local `_shot_*.png`, `_verify_*.png`, `_pet_*.png` are **dev artifacts** — do not commit unless needed for a design review. Prefer attaching images on the PR.
