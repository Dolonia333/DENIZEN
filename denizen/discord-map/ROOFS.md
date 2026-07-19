# Roofs — Pixel Spaces building caps

Official pack ([Pixel Spaces](https://netherzapdos.itch.io/pixel-spaces)) ships **two roof families** plus snow and rooftop props.

## Asset families

| Family | Files | Look |
|--------|-------|------|
| **Roof_1** (gable) | `Roof_1_{color}_connecting` + `_end` | Tall shingles, classic house |
| **Roof_2** (flat) | `Roof_2_{color}_connecting` + `_end` | Low modern slab |
| **Snow** | `Roof_snowpile_*` | Layered on top of either |
| **Deck props** | vents, trees, crane | Walkable rooftop clutter |

Colors (Roof_1): red, blue, green, orange, purple, black, yellow  
Colors (Roof_2): red, blue, green, orange, purple, grey, yellow  

## Visual editor (drag / cut / example)

Open **`denizen/tools/roof-composer.html`**:

1. Pick Roof_1 / Roof_2 + color  
2. **Load code layout** — starts from the live packing  
3. **Drag** tiles, **Cut** a box to carve a mid piece, arrow-nudge  
4. **PNG example** + **JSON recipe** export  
5. Drop JSON into `roof-examples/` and bake into `drawRoofCap` (`roofRecipeFor` / `pieces`)

Starter recipes: `roof-examples/gable-default.json`, `flat-default.json`.

Serve from repo root if `file://` blocks images, e.g. `npx serve .` then open `/denizen/tools/roof-composer.html`.

## How the map picks a roof

`pickRoofSpec(theme, seed)` → `{ style, color, snow? }`

| Theme cue | Style | Typical color |
|-----------|-------|----------------|
| winter / snow | snow | blue + piles |
| hospital / museum / office | flat | grey / blue |
| police | flat | black→grey |
| fire | flat | red |
| cafe | gable | orange |
| gamer | gable | purple |
| halloween | gable | black |
| default / text blocks | gable / flat / garden mix | palette color |

Then:

1. `drawRoofCap(left, top, bw, roofSpec)` — uses `roofRecipeFor(style)` (or Composer `pieces[]`)
2. `markRooftopDeck` — walkable floor
3. `decorateRooftop(..., style)` — vents / trees / crane / snow blobs

Pass a Composer export straight through:

```js
roofSpec: {
  style: 'gable',
  color: 'red',
  pieces: [ /* from roof-composer Export JSON */ ],
}
// or override packing knobs:
roofSpec: { style: 'gable', color: 'red', parametric: { connStep: 13, ridgeInset: 14 } },
```

## Force a style in a theme kit

In `THEME_KITS` or `drawThemeBuilding` cfg:

```js
roofSpec: { style: 'flat', color: 'grey' },
// or
roofSpec: { style: 'snow', color: 'blue', snow: true },
// or legacy:
roofKey: 'roof2BlueC',
```

## Polish tips

- **Gable** for homes / cozy / seasonal  
- **Flat** for institutional / Discord blue VC / offices  
- **Snow** only on winter zones (or rare lucky buildings)  
- **Garden** rooftop = trees + one vent  
- **Utility** rooftop = vents + occasional crane  
- Don’t `setDisplaySize` roof tiles — tile them or skip the last gap  

## Climb to roofs

Rooftops are registered floors (`isRoof: true`) with stairs from the top room. Player: climb door **↑**.
