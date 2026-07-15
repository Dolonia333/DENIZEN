# Discord map — room catalog (for map gen / world builder)

This file documents how Discord channels become buildings and rooms so a local AI (or world builder) can recreate the same logic.

## Sources

| Piece | Where |
|-------|--------|
| Asset keys → PNG paths | `game.js` → `ASSETS` |
| Channel → furniture kit | `kitForChannel(name, type, seed)` + `KITS` |
| Category → themed building | `THEME_KITS` + `KEYWORD_THEMES` |
| Placement rules | `decorateRoom()`, `placeRoomItems()`, `stairsDx` |

## Layout rules (must keep)

1. **Climb lane (left ~14%)** — elevators / stairs only. No furniture.
2. **Min floor gap** — props stay ≥ ~15% of room width apart.
3. **Deterministic seed** — `hashSeed(channelId)` so reloads match.
4. **Sitables** — keys in `SEAT_INFO` / `BED_INFO` register for E / ↑ sit or lie.
5. **Missing assets** — `furn()` skips + records in `scene._missingAssets`.

## Channel kits (`KITS`)

| Kit | When (name keywords) | Feel |
|-----|----------------------|------|
| `lounge` | general, chat, hang, lounge, social | couch + coffee + lamp |
| `library` | read, wiki, book, faq, docs | bookshelves + seat |
| `office` | dev, code, eng, git, ops | desk + chair + shelf |
| `cafe` | cafe, coffee, snack, bar | counter + stool |
| `kitchen` | kitchen, cook, meal | fridge + counter + oven |
| `reception` | welcome, lobby, announce | long table + guest seat |
| `cozy` | afk, sleep, quiet, vent | bed + lamp |
| `gallery` | art, media, photo | aquarium + plants |

Voice channels never use `cozy` (no bedrooms).

## Theme buildings (`THEME_KITS`)

Whole Discord **categories** become set-pieces: cafe, gamer, hospital, museum, police, fire, halloween. Each has:

- shell colors (`wall`, `side`, `roof`, `band`)
- `stairsDx` — climb X inside the pad (keep clear of recipe items)
- 2 recipes of room items: `['f'| 'w'| 'npc'| 'glow', ...]`

## Interaction model

| Action | Control | Implementation |
|--------|---------|----------------|
| Enter building | ↑ near door/elev | `nearbyDoor` → `enterFloor` |
| Elevator open anim | approach / ride | `elevClosed` → `elevSlightly` → `elevOpen` |
| Floor change | ↑/↓ on elev | `nearbyStairs` → `goToFloor` |
| Rooftop | elev up from top floor | `isRoof` floor + vents/tree |
| Sit | E or ↑ near seat | `SEAT_INFO` / `nearbySeat` / `sitOn` |
| Lie on bed | E or ↑ near bed | `BED_INFO` |
| Leave | ↓ (not on elev) | `leaveBuilding` |

## Recreating in map generator

```text
1. Load ASSETS catalog (keys must match PNG files under PixelSpaces*).
2. For each Discord channel:
   kit = kitForChannel(name, type, seed)
   reserve clearXf = 0.14
   place kit items with minGap, skip clear lane
3. For multi-floor stacks:
   place elev at stairsDx (or 0.14 * roomW)
   register stairs links floor[i] ↔ floor[i-1]
   optional roof floor above top
4. Register seats from SEAT_INFO / BED_INFO keys.
```

## Debugging missing sprites

In browser console after map load:

```js
// if the scene exposes it:
[...game.scene.scenes[0]._missingAssets || []]
```

Load errors also log: `[map] asset failed: <key> <src>`.
