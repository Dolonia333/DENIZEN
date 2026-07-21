# LimeZu Packs — Official Setup Reference

Compiled July 2026 from the five itch.io pack pages (+ their devlogs) and the
documentation bundled inside the purchased zips. This is the authoritative
"how these packs are meant to be used" doc; [SPRITE_PIPELINE.md](SPRITE_PIPELINE.md)
covers Denizen's own office pipeline and [FULL_WORLD.md](FULL_WORLD.md) the
city world that consumes these assets.

## ⚠️ License (all five packs)

- **CAN**: edit and use in any commercial or non-commercial project.
- **CANNOT**: resell or **distribute** the assets, edited or not.
- Credit required: LimeZu, linking https://limezu.itch.io/
- Extracted PNGs live in `assets/limezu/` and are **committed to the repo —
  the repo must stay PRIVATE** (verified private as of 2026-07-21). Never make
  it public, and never publish the sprite files through any other channel.

## The five packs and what each is for

| Pack | Base size | Role | Key contents |
|------|-----------|------|--------------|
| **Modern Interiors** | 16×16 (+32/48 variants) | The core pack | Room_Builder shells, ~20 furniture themes with per-sprite singles, 100+ animated objects, ALL characters + Character Generator, 6_Home_Designs example rooms |
| **Modern Exteriors** | 16×16 (+32/48) | Outdoor companion | City terrain/props, buildings, animated vehicles (incl. helicopter + helipad), many outdoor themes (subway, beach, fire station, graveyard…) |
| **Modern Office** | 16×16 (+32/48) | MI-compatible add-on | Office furniture, 300+ singles, shadow options. Denizen's main office uses the 32× version |
| **Modern Farm** | 16×16 (32/48 upscales) | Farm content | 19 crops (seeds/growth/fruitless/rotten + Crops_Growth animation folder), animals (idle/walk/eat-drink; dogs run/bark), farmer tool animations, Farmer Generator app |
| **Modern UI** | 16×16 grid (+32/48) | Interface | Window frames, 42 buttons, cursors, emotion icons (happy/sad/neutral/angry), dialogue boxes, gamepad UI, animated portraits + Portrait Generator |

All packs: pick ONE tile size and stay consistent. Denizen uses 16× for the
full world / Discord map, 32× for the legacy hand-cut office.

## Character sheets (Modern Interiors — the only pack with characters)

Official layout, confirmed by the bundled guide
(`2_Characters/Character_Generator/Spritesheet_animations_GUIDE.png`):

- Frames are **16×32** (16×16-size pack); sheets are 896 px wide = 56 frame
  columns per row. Directions are ordered **right, up, left, down**, 6 frames
  per direction unless noted.
- Row map (top to bottom):
  | Row | Animation | Notes |
  |-----|-----------|-------|
  | 0 | static poses | 4 single frames, one per direction |
  | 1 | **idle** | 6/dir |
  | 2 | **run** | 6/dir (this is the only locomotion cycle — there is no separate "walk") |
  | 3 | sleep | + bed prop frames on the same row |
  | 4 | sit (front) | 6/dir ×2 facing variants |
  | 5 | sit (side) | |
  | 6 | smartphone | frames 4–9 are the loop |
  | 7 | read book | frames 1–6 are the loop; book props on row |
  | 8 | push cart | + cart props |
  | 9 | pick up | 4-direction |
  | 10 | gift | + gift props |
  | 11 | lift | |
  | 12 | throw | |
  | 13 | hit | |
  | 14 | punch | |
  | 15 | stab | + knife props |
  | 16 | grab gun | |
  | 17 | gun idle | |
  | 18 | shoot | |
  | 19 | hurt | |

- Denizen wiring: `src/full-world.js` uses rows 1–2 (idle/run). Rows 3–19 are
  unused capability — sit/sleep/phone/book map directly onto agent statuses.

### Character Generator compositing order (official)

From the bundled `CHARACTER_GENERATOR.txt`:

```
1 BODY → 2 EYES → 3 OUTFIT → 4 HAIRSTYLE → 5 ACCESSORY
```

Eyes go UNDER the outfit (collars/hoods must cover the chin), hair over the
outfit, accessories on top. `src/discord-avatar/bake.js` follows this order.
Exception noted by LimeZu: the two kid pajama outfits need no hairstyle.

## Shadow variants (Modern Interiors / Office)

Sprites ship in FOUR shadow versions — pick one per scene and stay consistent:

1. **classic** — soft shadow baked in (indoor default)
2. **shadowless** — no shadow (`Theme_Sorter_Shadowless`, singles too)
3. **black shadow** — hard black shadow (the main office's
   `Modern_Office_Black_Shadow_32x32.png` is this variant)
4. **shadow hue** (Jan 2023 update) — a shadow tint made specifically so
   interior sprites match **Modern Exteriors** scenes. Use these when placing
   interior furniture outdoors.

## Room building (Modern Interiors)

Official components in `1_Interiors/<size>/Room_Builder_subfiles/`:

- `Room_Builder_Floors` — floor materials
- `Room_Builder_Walls` — flat wall patterns
- `Room_Builder_3d_walls` — the 3D-perspective wall band (300th update; what
  `src/room-tile-renderer.js` renders)
- `Room_Builder_borders`, `Room_Builder_Baseboards` — trim overlays that
  composite ONTO any wall pattern (266th update)
- `Room_Builder_Arched_Entryways` — 4 arch styles, "usable on any wall
  pattern" (309th update)

`6_Home_Designs/` contains finished example rooms (preview + separated layer
files) — official reference for how rooms should be assembled; Denizen stamps
the Japanese home and TV studio ones directly in the full world.

No official tile-index documentation exists — the indices in
`data/room-builder-tiles.json` are Denizen's own pixel-analysis decode. The
only written manual LimeZu ships is the RPG Maker import one (floors → A2,
walls → A4).

## Exteriors specifics

- Use `ME_Theme_Sorter_<size>/`; the `Old_Sorting/` subfolder inside it was
  "left behind by mistake" — ignore it.
- Animated objects ship as **.gif AND spritesheet**; the bundled
  `GIF FORMAT ISSUE.txt` warns gifs lose transparency (street-lamp glow etc.)
  — always use the PNG spritesheets.
- Autotiles exist only for Godot/Game Maker Studio (26 terrains); Phaser use
  means hand-picking tiles (see `src/full-world.js` EXT_RECTS).
- Characters are NOT in this pack — always from Modern Interiors (official
  pairing).

## Farm specifics

Farmer characters have their own animation guide
(`16x16/Characters_16x16/00_ANIMATIONS_GUIDE.png`): idle, walk, harvest,
walk-shovel, dig, walk-watering-can, watering, walk-axe, chopping,
walk-fishing-rod, fishing (+ no-hook variant). Tool overlays are separate
sheets (`ANIMATIONS_GUIDE_TOOLS.png`). The Farmer Generator is a standalone
app (`Farmer Generator Setup.exe` in Downloads).

## UI pack specifics

- Emotion icons (happy/sad/neutral/angry) — direct fit for agent mood bubbles.
- Animated portraits: talk / nod / shake-head, **10 frames each** (the only
  official frame counts LimeZu publishes anywhere).
- The Portrait Generator app (`Portrait_Generator_Setup.exe`) shares
  accessories/eye colours with the MI Character Generator — portraits can
  match walk sprites.
- Frames are meant for 9-slice stretching (community guidance).

## What Denizen uses today vs. available headroom

Used: Room Builder floors + 3D walls; ~10 furniture theme singles; 2 Home
Designs; city terrain/props/vehicles/buildings; 3 animated objects; character
rows 1–2; Character-Generator layers for Discord avatars.

Unused headroom (ordered by fit):
1. Character rows 3–9 (sit at desks, sleep, phone, book, push cart) for agents
2. UI emotion icons + portrait system for agent dialogue
3. ~100 more animated objects (fish tanks, elevators, escalators…)
4. Exteriors themes: subway entrance, fire station, graveyard (Halloween!),
   beach, post office
5. Farm zone: crops + animals + farmer
6. More Home Designs rooms
7. Character Generator bodies for unique per-agent walk sprites
