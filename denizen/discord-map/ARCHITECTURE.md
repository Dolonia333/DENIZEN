# Discord Spaces Map — architecture & how changes were made

Audience: collaborators improving **animations**, **sprite placement**, **food**, **emotes**, and **pack coverage**.  
Code truth: `game.js` + `block-life.js`. Live NAS deploys the whole `discord-map/` tree.

---

## 1. Runtime overview

```
Browser  →  /discord-map/play.html
         →  block-life.js  (window.BlockLife)
         →  game.js        (Phaser.Game → MapScene)
         →  PNG textures under PixelSpaces* / PacksExtra

Optional: Denizen server /api/discord/map/presence  (who is in VC)
```

| Layer | File | Role |
|-------|------|------|
| Shell | `play.html` | Loads Phaser, cache-bust query on scripts |
| Data sim | `block-life.js` | Residents, needs, schedule, relationships (no Phaser) |
| View + AI glue | `game.js` | Build city, place art, path NPCs, drive life goals |
| Touch | `mobile-touch.js` | On-screen controls |

---

## 2. Coordinate & floor model

- Side-scroller: walk on **horizontal floor lines** (`floorY`), not free 2D physics for NPCs.
- Outdoor street: `this.groundY`.
- Indoors: `this.floors` Map of `{ id, roomKey, floorY, minX, maxX, isRoof? }`.
- Player enters via **doors** (`registerDoor`), climbs via **stairs** (`registerStairs`), rooms via **passages** (`registerPassage`).
- Furniture/NPCs use **bottom origin** (`setOrigin(0.5, 1)` or `NPC_FOOT_ORIGIN_Y`) so feet sit on `floorY`.

### Pathing (why NPCs no longer walk on air)

**Problem:** `driveResidents` used to set `sprite.y = targetFloorY` then horizontal-tween X → floating at wrong height outdoors.

**Fix:**

1. `buildNavEdges()` — graph edges from doors, stairs, passages + outdoor node `__out`.
2. `findNavNodePath(start, goal)` — BFS.
3. `planActorPath(fromX, fromY, toX, toY, toFloorId)` — waypoint list; **warp** only at door/stair X.
4. `actorNavigateTo` / `_runNextNavStep` — walk each segment; Y changes only on `warp: true`.
5. Life goals call `actorNavigateTo` (never free Y snap).

Touch points: search `planActorPath`, `actorNavigateTo`, `driveResidents` in `game.js`.

---

## 3. Sprite loading (`ASSETS`)

Near top of `game.js`:

```js
const PACK = './PixelSpaces';
const FULL = './PixelSpacesFull/Individual Assets';  // or similar
const PACKS_EXTRA = './PacksExtra';
const ASSETS = {
  couchBlue: `${PACK}/Furniture/...`,
  foodBurger: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Burger.png`,
  emoteHeart: `${FULL}/UI/Emotes/Heart_green.png`,
  // ...
};
```

- Preload: every `ASSETS` key → Phaser texture of the same name.
- **To use a new PNG:** add a key to `ASSETS`, then reference that key in kits / `furn` / `placeFood` / emote map.

NPC sheets are **not** single-frame PNGs in ASSETS alone — see `NPC_SHEETS` + `makeAnims` / `playSheetPose`.

---

## 4. NPC animations

### Sheet layout

- File: `PixelSpaces/NPCs/Male|Female/NPC N.png`
- Grid: **32×32 cells**, **8 columns × 14 rows**
- `NPC_POSE_DEFS` maps pose name → `{ row, frames, fps, repeat, loop? }`

| Pose | Typical use |
|------|-------------|
| walk | row 0 loop |
| idle | row 1 loop |
| jump | one-shot |
| sit / sitIdle / sitFinish | furniture |
| lie / lieIdle / lieFinish | beds |
| eat / eatSit | food |
| shrug snicker wave hurt | ambient social |

### How to improve animations

1. Tune `NPC_POSE_DEFS` fps / frames / repeat.
2. `poseDurationMs(pose)` drives busy timers.
3. In-game: **F9** gallery, **F8** cycle, keys **1–6**.
4. `playSheetPose(sprite, sheetKey, pose, { onDone })` is the single entry point.
5. Seated lock: `actor.seatedY` must be re-applied every life tick so bounce/path doesn’t lift sitters.

Foot plant: `NPC_FOOT_ORIGIN_Y` — art isn’t flush to cell bottom; adjust if characters float.

---

## 5. Furniture placement

| Helper | Job |
|--------|-----|
| `furn(key, x, floorY, depth, scale, floorId)` | Place image; auto-register seats/beds/food hosts |
| `placeFood(key, x, plateY, …)` | Pixel Platter on table surface |
| `decorateRoom` / kits | Channel-themed layouts |
| `SURFACE_HOSTS` | Height of table tops for props/food |
| `SEAT_INFO` / `BED_INFO` | Sit surface heights |

### Kits

- `KITS` — named room themes (library, office, cafe…).
- Channel name heuristics pick a kit.
- Expansions (Cafe, Halloween…) mix into themed buildings via `THEME_KITS` / specialty drawers.

### Placement polish checklist

- Keep left band clear for climb doors (~`xf` 0.12–0.22).
- Origin bottom on floor plank (`floorY`).
- Surface props: `onSurface: true` or `SURFACE_PROPS` set → sit on nearest host.
- After map build: `seedFoodOnAllTables()` fills empty hosts.

---

## 6. Food system

| Piece | Role |
|-------|------|
| `FOOD_KEYS` | All platter texture keys |
| `FOOD_HOST_KEYS` | Tables/counters that hold food |
| `foodHosts[]` | Filled by `furn()` when host placed |
| `seedFoodOnAllTables()` | Ensures every host has plate sprites |
| `nearestFoodFor(actor)` | Pick plate for AI |
| `actorEatFood(actor, food)` | Navigate to plate → `eat` pose → bob sprite |
| `forceResidentsEatFood()` | Demo meal shortly after spawn |

**Improving food:** add more keys to ASSETS + FOOD_KEYS; place via kits `{ key: 'food', food: true }`; tweak `FOOD_SCALE`.

---

## 7. Community life (`block-life.js`)

- **No workplace grind.** Activities: hang, visit, stroll, chill, social, eat, sleep, home, play, follow.
- UI tag: `activityLabel(act)` only (e.g. `eating`, not `barista · work`).
- Day clock: ~45 real seconds ≈ 1 block hour.
- Needs: hunger, energy, social, fun → goal overrides in `driveResidents`.

`driveResidents` maps goals → world targets + `actorNavigateTo` / `actorEatFood` / sit.

---

## 8. Pets

- Sheets: `PacksExtra/Cats`, `PacksExtra/Dogs` (8 dirs × 4 walk frames on row 0).
- `PET_FOOT_ORIGIN_Y`, distance-driven frame advance (`PET_PX_PER_STEP`).
- Patrol on `groundY`; do not free-float Y.

---

## 9. Emotes & UI pack

Loaded under ASSETS (`emoteHeart`, `emoteFire`, …).  
`showEmote(sprite, pose)` pops a short-lived image above the character.

**Unused emotes / chat bubbles / icons** are listed in `SPRITE_INVENTORY.md` — wire more into `showEmote` map and ambient social beats.

---

## 10. NAS ↔ git parity

| Location | Content |
|----------|---------|
| Git branch `feature/discord-spaces-map-polish` | Source of truth for this polish wave |
| Local `denizen/discord-map/` | Edit here |
| NAS container `/app/discord-map/` | Deployed copy via `infra/hotfix-discord-map-nas.py` |

Deploy copies the **entire** map tree (including packs). After deploy, hard-refresh clients.

To “pull NAS mentally”: this branch **is** what was hotfixed live for pathing, community life, and food. Prefer git over SSHing the container.

---

## 11. Key search terms in `game.js`

```
ASSETS
NPC_POSE_DEFS
playSheetPose
furn placeFood seedFoodOnAllTables actorEatFood
planActorPath actorNavigateTo driveResidents
registerFloor registerDoor registerStairs registerPassage
decorateRoom KITS FOOD_KEYS PET_
```

---

## 12. Tests / sanity

```bash
node --check discord-map/game.js
node --check discord-map/block-life.js
node discord-map/scripts/inventory-sprites.mjs
# optional: Playwright against localhost or NAS play.html
```

Console markers:

- `[map] food sprites: N total…`
- `[map] block life: N residents…`
- `[map] sent N residents to eat real food…`
- `[map] pets walking…`
