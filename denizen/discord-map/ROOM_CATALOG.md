# Discord map — Pixel Spaces room and placement guide

This is the map's art-direction contract. It explains how Discord channels become readable Pixel Spaces rooms without turning the pack into a pile of unrelated sprites.

## Upstream pack facts

- Project page: <https://netherzapdos.itch.io/pixel-spaces>
- UI expansion: <https://netherzapdos.itch.io/pixel-spaces/devlog/618731/pixel-spaces-new-assets-4-ui-expansion-342-assets>
- NPC animation update (July 2026): <https://netherzapdos.itch.io/pixel-spaces/devlog/1584451/pixel-spaces-animation-update->
- The pack is modular. The example scenes are compositions made from tiles and individually exported assets; they are not prebuilt rooms.
- Furniture has front/side variants and connected variants. Choose the orientation and connection state that fits the room instead of loading every variation.
- Premade/custom NPC sheets use 32×32 frames. Character art occupies about 16×16 inside that frame, so the map displays NPC sheets at 2×.
- UI panels, status icons, pointers, and chat bubbles are interface assets. They do not belong on the room floor.
- The purchased pack license is recorded in `PixelSpacesFull/readme.txt`. Do not redistribute the source PNG collection.

Using the pack well means selecting a small, coherent subset for each scene. It does **not** mean showing every available sprite at once.

The checked-in full pack currently contains 2,115 PNG assets. `world-catalog.json`
inventories every one of them, including dimensions and URL, while `game.js`
preloads only the assets referenced by a scene recipe. This distinction is
intentional: complete asset coverage belongs in the catalog; visual density
belongs in a room recipe.

## Code sources

| Concern | Source |
|---|---|
| Asset key → PNG | `game.js` → `ASSETS` |
| Channel → room type | `kitForChannel()` + `KITS` |
| Category → themed building | `THEME_KITS` + `KEYWORD_THEMES` |
| Plain-room placement | `decorateRoom()` |
| Themed-room placement | `placeRoomItems()` |
| Doors and elevators | `placeEntrance()`, `markStairs()`, `updateAutoDoors()` |
| Seating interactions | `SEAT_INFO`, `BED_INFO`, `furn()` |
| Safe NPC standing positions | `furnitureBounds` + `addRoomSlots()` |
| NPC animation rows | `makeAnimsForKey()` |
| Ambient NPC routines | `startAmbientNpc()` + `startLiveBob()` |

## Sprite roles and anchors

Classify an asset before placing it. The role determines its anchor and whether it participates in floor-spacing checks.

| Role | Examples | Phaser origin | Placement rule |
|---|---|---|---|
| Floor furniture | couch, desk, fridge, bed, lamp | `(0.5, 1)` | Bottom sits exactly on `floorY` |
| Connected furniture | counters, sinks, ovens | `(0.5, 1)` | Mark `cluster: true`; align adjacent edges intentionally |
| Surface object | laptop, mug, pastry, monitor | `(0.5, 1)` | Mark `surface: true`; share the supporting furniture's X and offset by the support's rendered height |
| Wall object | poster, clipboard, mounted TV, window | `(0.5, 0)` | Use `wall: true` / `wallDecor()` and position from the room top |
| Character | premade/custom NPC sheet | `(0.5, 24/32)` | Display at 2×; the origin is the actual foot line inside the padded frame |
| Infrastructure | entrance door, elevator | `(0.5, 1)` | Align to a dedicated doorway/shaft recess, never scatter as decor |
| UI | chat bubble, pointer, status icon | varies | Attach to an NPC or HUD; never place as furniture |

### Surface-height examples at 2×

- `Table_medium_2` and base counters are 7 px high → surface offset `14`.
- `Desk_office_*` is 7 px high → monitor/microphone/paper offset `14`.
- `Shelf_medium` is 5 px high → headset/trophy offset `10`.

Surface objects must bypass loose-floor collision resolution. If a cup and its table share X, that is intentional. Moving only the cup creates the familiar “floating cup” bug.

## Composition rules

1. Give each room one purpose: work, lounge, kitchen, reception, gallery, or a named expansion theme.
2. Use one primary furniture cluster, one secondary piece, and at most one wall accent in a small room.
3. Keep a continuous character path at least 28–32 rendered pixels wide.
4. Do not add a second random decoration pass after a room kit. A kit is the composition.
5. Plants are accents, not filler. Use them only where the room concept calls for greenery; never append one to every room.
6. Loose cups, laptops, food, headsets, and papers require a supporting surface.
7. Wall art belongs above a clear wall section, not behind an elevator or over a channel label.
8. Deterministic `hashSeed(channelId)` may choose color/style variants, but it must not change the room's purpose or density.
9. Presence slots are checked against rendered furniture bounds. If a requested slot overlaps a desk, counter, display, or chair, `addRoomSlots()` finds the closest clear point in the room.

## Channel kits

Each plain-channel kit has three complete layout recipes. The room ID picks one
recipe deterministically, and the selected recipe may then choose a color/style
variant. Two channels can therefore share a purpose without sharing an exact
silhouette.

| Kit | Typical channel names | Recipe family |
|---|---|---|
| `lounge` | general, chat, social | sofa lounge, paired reading seats, or media lounge |
| `library` | rules, wiki, docs, guide | bookcase nook, shelf-and-books corner, or reading table |
| `office` | dev, code, ops, bugs | laptop desk, monitor workstation, or long shared desk |
| `cafe` | coffee, snack, bar | service counter, two-seat table, or refreshment counter |
| `kitchen` | cook, meal, recipe | fridge/oven line, sink line, or cupboard prep line |
| `reception` | welcome, lobby, announce | front table, check-in workstation, or waiting area |
| `cozy` | AFK, quiet, sleep | single bed, bunk corner, or reading bedroom |
| `gallery` | art, media, showcase | habitat display, artifact cases, or wall-art exhibit |

Voice channels use social or meeting compositions, never bedrooms.

## Doors and elevators

### Exterior doors

Pixel Spaces names the door files by leaf pose. In this cutaway presentation:

| Map key | Source file | What it looks like here |
|---|---|---|
| `doorShut` | `Door_wood_opened.png` | broad front-facing leaf that shuts the recess |
| `doorOpen` | `Door_wood_closed.png` | narrow edge-on leaf that leaves the recess open |

The map shows `doorShut` at rest, switches to `doorOpen` on approach, and holds it briefly during entry so the door does not snap shut on the same frame as the teleport.

### Elevator architecture

- A same-level two-room building uses two ordinary street doors; it does not pretend the second door is an elevator.
- A multi-floor building has one coherent vertical core, not an elevator in every room column.
- The indoor shaft center must be far enough from the room edge to contain the complete sprite.
- Indoor elevator doors render at 1.5× to preserve walking space; NPCs remain 2×.
- A single-room themed building does not receive an elevator solely for decorative rooftop access.
- Multi-floor elevator states progress `elevClosed` → `elevSlightly` → `elevOpen` and remain open long enough for the transition to read.

## Theme recipes

`THEME_KITS` can use:

```text
['f', key, dx, scale, rise]       floor/surface sprite; positive rise moves it above floor
['w', key, dx, topOffset, scale]  wall-mounted sprite
['npc', stableSeed, dx]           decorative character
['glow', color, alpha]            restrained room-wide lighting
```

For a surface sprite, `rise` must equal the rendered height of its support. Mounted assets such as `TV_mounted_*` must use `w`, not a large floor rise.

## Interaction model

| Action | Control | Implementation |
|---|---|---|
| Enter | ↑ near entrance | `nearbyDoor()` → open hold → `enterFloor()` |
| Change floor | ↑/↓ at the one elevator core | `nearbyStairs()` → `goToFloor()` |
| Cross paired rooms | walk through shared edge | `registerPassage()` |
| Sit/lie | E or ↑ near furniture | `SEAT_INFO` / `BED_INFO` → `sitOn()` |
| Wave | Q | plays the real `wave` row and holds it until completion |
| Jump pose | Space | plays the real `jump` row without changing floor collision |
| Leave | ↓ away from an elevator transition | `leaveBuilding()` |

## NPC animation and activity model

The July 2026 premade sheets are 256×448: 8 columns × 14 rows of 32×32
cells. Each row includes a small text label after its usable art, so animation
ranges must use the exact frame counts below. Including a label cell produces a
visible glitch.

| Row | Runtime suffix | Frames | Use |
|---:|---|---:|---|
| 0 | `walk` | 4 | movement tween, looped |
| 1 | `idle` | 3 | natural standing idle, looped |
| 2 | `jump` | 2 | local Space pose; occasional outdoor cast action |
| 3 | `sit` | 3 | transition onto a registered chair/couch/stool |
| 4 | `sitIdle` | 3 | seated hold, looped |
| 5 | `sitFinish` | 3 | transition back to the floor line |
| 6 | `lie` | 6 | transition onto a registered bed/coffin/treatment table |
| 6 | `lieIdle` | 1 | hold the final lie-down frame |
| 7 | `lieFinish` | 6 | get-up transition |
| 8 | `eat` | 2 | standing food/drink action |
| 9 | `eatSit` | 2 | seated cafe/kitchen action |
| 10 | `hurt` | 3 | medical/emergency/dig context action |
| 11 | `shrug` | 7 | social ambient response |
| 12 | `snicker` | 2 | social ambient response |
| 13 | `wave` | 4 | greeting/social response and local Q control |

Decorative cast members do not bob vertically. `startAmbientNpc()` walks them
between the room's clear occupancy points, reserves at most one compatible seat,
plays the appropriate sit/lie intro, holds or eats, plays the finish animation,
and returns them to the floor before walking again. A reserved seat is excluded
from local-player interaction so two sprites cannot occupy it.

Sit-idle and lie-idle use measured contact corrections from the updated sheet:
the opaque seated art ends at source y=19 and the held lie frame at y=20, while
the walking foot origin is y=24. At 2× scale the runtime adds 10 px for sitting
and 8 px for lying after the intro, which places the visible body on the furniture
surface instead of above it.

Live Discord members keep their authoritative room slot and periodically use
wave, shrug, or snicker. Channel changes interrupt the pose, play the existing
multi-leg walk, and restart the social routine after arrival. They do not lie or
sit unless a furniture-aware routine owns a seat; this prevents a generic pose
from looking like it is floating in open space.

## Adding a new room safely

1. Pick one semantic kit or expansion recipe.
2. Classify every sprite as floor, connected, surface, wall, infrastructure, character, or UI.
3. Place the primary furniture cluster first.
4. Put supported objects at their support's X and measured rendered height.
5. Add no more than one optional wall accent.
6. Reserve a transport lane only if the room actually contains the building's elevator core.
7. Register seats/beds through `furn()` and confirm their floor ID.
8. Give room occupancy slots an explicit `minX`/`maxX` area; let `addRoomSlots()` move them out of rendered furniture bounds.
9. Reload the public and setup map views; inspect at least one narrow and one wide room.
10. Walk to each exterior entrance and confirm shut → open → held-open → shut behavior.
11. Wait through one complete ambient chair/bed cycle; confirm intro → hold → finish and a return to `floorY` before walking.
12. Check `scene._missingAssets` and the browser console for load failures.

## Missing-sprite diagnostics

`furn()` records missing asset keys in `scene._missingAssets`, and Phaser logs `[map] asset failed: <key> <src>` for a failed file load. Fix the key/path; do not replace a missing semantic piece with a random available sprite.
