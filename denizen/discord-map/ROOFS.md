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

1. `drawRoofCap(left, top, bw, roofSpec)` — end caps + connecting run (no stretch)
2. `markRooftopDeck` — walkable floor
3. `decorateRooftop(..., style)` — vents / trees / crane / snow blobs

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
