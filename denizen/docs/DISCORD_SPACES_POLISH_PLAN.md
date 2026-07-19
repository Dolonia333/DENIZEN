# Discord Spaces — Full Pixel Subgame Polish Plan

**Goal:** Turn `discord-map/` into a polished **city-block life sim** for Discord: walk the street, enter buildings that map to categories/channels, rooms that look intentionally designed (not random clutter), NPCs that use **every** Pixel Spaces animation, food/eat, sit/lie, pets, backgrounds, and full UI pack.

**Branch:** `feature/discord-bot-and-app`  
**Primary code:** `discord-map/game.js`, `discord-map/world-catalog.json`, `discord-map/ROOM_CATALOG.md`  
**Art:** Pixel Spaces by [Netherzapdos](https://netherzapdos.itch.io/pixel-spaces) (base + Full + UI Expansion)  
**Agent protocol:** Claude implements in small PRs; **Grok steers, reviews, finishes incomplete work**, keeps Claude on track and token-efficient.

### Shipped since original audit (2026-07-18)

| Item | Notes |
|------|--------|
| Phase G map social | Reactions + `,eat` → poses / Pixel Platter; permanent head chrome removed |
| Elevators | Theme climb lanes use elevator art + proximity open/close |
| Soft chat bubbles | Colored pack bubbles; pop on snippet change |
| Section atmosphere | `SECTION_ATMOS` palettes on plain shells |
| Door enter | `playEnterStep` on enter / floor change / leave |
| Anim tune | Slower walk/idle; longer eat; softer ambient |
| Door art | Pack doors + open textures; elev themes |
| Bot music / Last.fm | Real Lavalink + Last.fm API (not stubs) — see [`DISCORD_BOT_AND_SPACES.md`](./DISCORD_BOT_AND_SPACES.md) |

**Reference mockups (pack author):** UI Expansion devlog — build menu, NPC needs panel, furniture shop, tasks menu.  
**Animation source of truth:** Animation Update (sit / sit idle / sit finish / lie / eat / eat sitting / hurt / shrug / snicker / wave).

---

## 0. Current state (audit — do not re-litigate)

| Area | Status | Gap |
|------|--------|-----|
| Asset packs in repo | `PixelSpaces/` (~642 PNG) + `PixelSpacesFull/` (~1473 PNG) + UI | Full pack on Desktop is same generation; re-download only if itch updates again |
| Catalog | `world-catalog.json`: **2115** assets, **~320 used** by map (~15%) | Massive unused furniture / BG / food / UI |
| NPC sheets | 30 premade, **256×448**, 8×14 cells of 32×32 | Rows 0–13 fully defined in catalog |
| Animations wired | walk, idle, sit, sitIdle, sitFinish, lie, lieIdle, lieFinish | **Missing:** jump, eating, eating_sit, hurt, shrug, snicker, wave |
| Room logic | `KITS` + `THEME_KITS` + layout bands (elevator lane left) | Sparse kits; still feels thin/random vs author examples |
| Sit / lie | SEAT_INFO / BED_INFO + E/↑ | Works; needs polish + more seat types |
| Food | Kitchen objects exist (apple, banana, mug, etc.) | **Not** placed as interactables; no eat anim trigger |
| UI pack | Status icons, chat bubbles, panels partially used | No needs bars, shop, room nameplates occupancy, full HUD |
| Pets | LimeZu `animated_cat` + `assets/limezu/farm/animals/dog.png` | **Not** in discord-map; style mismatch risk |
| City street | Buildings from Discord categories | Backgrounds (mountains, clouds, houses, shops) underused |
| Discord bot | Presence → rooms, avatar bake, hangout | Map polish is independent; presence hooks needed for emotes |

### NPC row map (already in `world-catalog.json`)

| Row | Name | Frames (real; skip label col) | Wired today? |
|-----|------|-------------------------------|--------------|
| 0 | move / walk | 4 | ✅ |
| 1 | idle | 3 | ✅ |
| 2 | jump | 2 | ❌ |
| 3 | sit | 3 | ✅ |
| 4 | sit_idle | 3 | ✅ |
| 5 | sit_finish | 3 | ✅ |
| 6 | lie_down | 6 | ✅ |
| 7 | lie_finish | 6 | ✅ |
| 8 | eating | 2 | ❌ |
| 9 | eating_sit | 2 | ❌ |
| 10 | hurt | 3 | ❌ |
| 11 | shrug | 7 | ❌ |
| 12 | snicker | 2 | ❌ |
| 13 | wave | 4 | ❌ |

**Rule:** never include the text-label cell after the last real frame (already documented).

---

## 1. Product vision (what “done” looks like)

A Discord server feels like a **small city block**:

```text
[sky + parallax BG]  mountains / clouds / blimps
[street]  sidewalk · trees · flowers · benches · outdoor doors
[building A]  category "General" → multi-floor rooms per channel
[building B]  category "Gaming" → gamer-themed shell + rooms
[building C]  category "Cafe" → cafe expansion furniture
...
[parks / dig / winter outdoor zones]  special outdoor kits
```

**Player / members:**

1. Walk street → enter door → climb floors (elevator/stairs lane left).  
2. Sit on couches/stools, lie on beds (real anims).  
3. Eat food props in kitchen/cafe (standing + sitting eat).  
4. Wave / shrug / snicker on social cues (join VC, mention, hangout).  
5. See cats/dogs roaming rooms or street.  
6. HUD: room name + occupancy, status (hunger/energy/comfort optional), mic status, chat bubbles — **Pixel Spaces UI only**, not emoji.

**Aesthetic rules (non-negotiable):**

1. **Never random scatter.** Every room uses a **recipe** with zones.  
2. **Clear left climb lane** (~14–22% width) — no furniture.  
3. **Groups stay together** (desk + chair + laptop; couch + coffee table).  
4. **Sparse > cluttered** — max density by room size; prefer 4–8 anchor objects + 2–4 props.  
5. **Surfaces host props** — laptops/mugs on desks, not floating.  
6. **Deterministic seeds** from channel/guild IDs — reload looks identical.  
7. **Color story** — wall tint + floor strip + 1 accent furniture color family per building.

---

## 2. Architecture for Claude (split work so usage stays low)

**Do not** keep growing one 3k-line `game.js` forever. Extract modules (still browser-loadable via script tags or a tiny bundler later):

| Module | Responsibility |
|--------|----------------|
| `map/assets-registry.js` | All ASSETS keys → paths; load helpers |
| `map/npc-anims.js` | Full row → Phaser anim keys for every sheet |
| `map/room-recipes.js` | KITS, THEME_KITS, zone placer |
| `map/layout-engine.js` | Bands, collision, surfaces, sit/eat spots |
| `map/street-builder.js` | Outdoor city block, BG layers, doors |
| `map/pets.js` | Cat/dog spawn + idle roam |
| `map/ui-hud.js` | Pixel Spaces UI panels/icons/bars |
| `map/presence-bridge.js` | Poll Discord presence → sprites/emotes |
| `game.js` | Scene glue only |

**If extraction is too risky in one pass:** keep `game.js` but add files and `import` only if play.html already supports modules; otherwise sequential IIFE files in order.

**Catalog first:** extend `world-catalog.json` + `build-catalog.py` so every new key is registered before use.

---

## 3. Phase plan (PR-sized chunks)

### Phase A — Foundation (1–2 sessions) ✅ gate for everything else

**A1. Asset completeness check**

- Diff Desktop `PixelSpaces Full Pack (1)` vs `discord-map/PixelSpacesFull/`.  
- If NPC sheets grew past 14 rows after re-download, re-measure and update row map.  
- Copy any missing food/UI files into repo paths used by game.  
- **Pets:** copy LimeZu cat sheet + dog into `discord-map/pets/` (or `PixelSpacesFull/Extras/`) with README note: third-party LimeZu, separate license from Pixel Spaces.

**A2. Full animation registry** (`makeAnims` expansion)

For every `npc_m*` / `npc_f*` (and baked avatar sheets if same grid):

```text
walk, idle, jump,
sit, sitIdle, sitFinish,
lie, lieIdle, lieFinish,
eat, eatSit,
hurt, shrug, snicker, wave
```

Helper: `playNpc(sprite, 'wave')` with fallback to idle if missing frames.

**A3. Wire actions → anims**

| Trigger | Anim |
|---------|------|
| Move A/D | walk |
| Stop | idle |
| Sit on seat | sit → sitIdle |
| Stand from seat | sitFinish → idle |
| Lie on bed | lie → lieIdle |
| Stand from bed | lieFinish → idle |
| Use food prop | eat or eatSit if seated |
| Other player joins same room | wave (once) |
| Soft presence (text only) | shrug or snicker (rare) |
| Optional jump key | jump |

**Acceptance:** open `test-anim.html` / play map; cycle all anims with a debug key (`F8` anim test cycle).

---

### Phase B — Room layout system (biggest visual win)

**B1. Zone model** (already sketched in `world-catalog.json` → formalize in code)

```text
| elev lane | anchor furniture | activity cluster | right wall |
| 14–58 px  | 66–130           | 130–210          | 210–252   |
  (source px inside ~258 room inner width; scale with room)
```

**B2. Room recipes (not random lists)**

Each kit becomes a **recipe** with slots:

```js
{
  id: 'lounge',
  wallFamily: 'warm',
  slots: [
    { zone: 'anchor', role: 'sofa', keys: ['couchBlue',...], sit: true },
    { zone: 'activity', role: 'table', keys: ['coffee'], near: 'sofa' },
    { zone: 'activity', role: 'light', keys: ['lamp','lamp2'] },
    { zone: 'right', role: 'plant', keys: ['floraFern',...] },
    { zone: 'wall', role: 'art', keys: ['clipboard',...], wall: true },
  ],
  foodSpots: [], // optional
  petSpots: [{ zone: 'activity', chance: 0.35 }],
  maxItems: 6,
}
```

**B3. Expand kits to use more of the pack**

| Kit | Discord keywords | Must feel like |
|-----|------------------|----------------|
| lounge | general, chat, hang | sofa cluster + coffee + lamp + plant |
| library | docs, wiki, faq | bookshelves wall + reading chair |
| office | dev, eng, ops | desk + chair + laptop ON desk + shelf |
| cafe | coffee, snack | counter run + stools + pastry displays (Cafe exp) |
| kitchen | cook, meal | fridge + counter + oven + **food props** |
| bedroom / cozy | afk, sleep, quiet | bed + nightstand + lamp (no voice bedrooms) |
| gamer | game, arcade | Gamer Room expansion set |
| hospital | support, help | Hospital expansion |
| museum | art, gallery | displays + rails |
| police | mod, staff | desk + barrier |
| fire | alert, emergency | Fire Station props |
| halloween | meme, spook | Halloween set |
| bathroom | (optional room fragment) | sink/toilet only if channel name matches |

**B4. Theme building shells**

- Roof color families already exist — ensure **front doors** scale to facade, windows optional glass panes, side depth color, ground strip.  
- Street props between buildings: bush, flower, bench, lamp, fence ends (Backgrounds pack).  
- Parallax layers: far mountains → mid trees → street.

**B5. Placement algorithm**

1. Resolve kit from channel name + seed.  
2. Place elev/stairs first in elev lane.  
3. For each slot in recipe order: pick variant by seed, place in zone with **minGap**, snap Y to floor or surface host.  
4. Register seats / beds / **food** / pet spots.  
5. If room too short vertically, drop low-priority wall art first.

**Acceptance:** same guild layout is stable; screenshots of lounge/office/cafe/kitchen look “designed”; no overlaps; climb lane clear.

---

### Phase C — Food, needs, sit/lie polish

**C1. Food props**

Register ASSETS keys:

- `apple`, `bananas`, `orange`, `pineapple`, `mug`, `glassWater`, cafe pastries, etc.

**C2. Interactables**

```text
FOOD_INFO = { apple: { anim: 'eat', durationMs: 1800 }, mug: {...}, ... }
```

- Press E near food → play eat (or eatSit if seated) → optional toast.  
- Soft “hunger” meter optional (UI progress bar) — **cosmetic first**, no hard sim required for v1.

**C3. Sit/lie polish**

- More seats: cafe stools, waiting chairs, benches, thrones (theme).  
- Correct surfaceH per furniture.  
- Depth sorting: seated player behind table front edge when needed.

**Acceptance:** player can sit, stand, lie, eat in kitchen/cafe with correct anim rows.

---

### Phase D — Pets (cats & dogs)

**D1. Import assets** into `discord-map/pets/`:

- Cat: LimeZu `animated_cat` (16×16 sheet) — scale carefully (×2 or ×3).  
- Dog: `assets/limezu/farm/animals/dog.png` — measure frames before anim.

**D2. Behavior (lightweight)**

- Spawn 0–2 pets per building (seeded).  
- Idle walk between petSpots; sit near couches; avoid elev lane.  
- No combat — pure ambience + depth sorting.

**Acceptance:** pets visible in lounge/street; no blocking doors.

---

### Phase E — Full UI pack HUD

Use `PixelSpacesFull/UI/` only (see itch UI Expansion):

| HUD element | Asset family | Behavior |
|-------------|--------------|----------|
| Room nameplate | Panel + frame | Channel name + occupant count |
| Mic / mute / deaf | Status_happiness_* | From presence flags |
| Soft text | ChatBubble_* | Recent text snippet |
| Boost / nitro | Boost icon | Boosters |
| Optional needs | Progress bars + hunger/energy icons | Local cosmetic or hangout-driven |
| Help / settings | Gear, panels | Pause overlay |
| Pointer | Pointer_* | Local player / open mic |

**Author mockups to mirror (not clone 1:1):** NPC info panel, tasks strip, build menu (can be map legend for free tier).

**Acceptance:** zero emoji for status; mobile readable; free watermark still works.

---

### Phase F — City block & backgrounds

**F1. Outdoor composition**

- Sky gradient + clouds (parallax slow).  
- Far mountains (season keyword → autumn/snow variants).  
- Mid trees / rooftop trees.  
- Street: sidewalk, doors, shop/house facades where no Discord category.  
- Optional outdoor zones: winter dig, archaeology (existing theme keys).

**F2. Building rhythm**

- Alternate width (museum wider).  
- Roof variety Roof_1 / Roof_2 colors by theme.  
- Rooftop walkable: vents + tree (already partially there).

**Acceptance:** screenshot from street reads as a city block, not empty blue void.

---

### Phase G — Discord presence personality

> **Shipped (2026-07-18):** permanent mute/open-mic/boost head chrome was **removed**. Organic feedback is Discord **message reactions** + `,eat [food]` → `people[].action` → pose + fade emote + held Pixel Platter sprite. See [`DISCORD_BOT_AND_SPACES.md`](./DISCORD_BOT_AND_SPACES.md).

| Event | Map reaction |
|-------|--------------|
| Join VC | wave anim once + chat bubble optional |
| Chat reaction (wave/shrug/laugh/jump/hurt/heart) | matching NPC pose + brief emote fade |
| Food reaction or `,eat` | eat/eatSit + held food (or nearest table plate) |
| Text soft presence | brief bubble (+ caption) |
| Move channel | walk path to new room slot |
| Idle long in AFK room | sit or lie if bed nearby |

Bot: `tracker.setMapAction` + ungated misc `onReactionAdd` / `,eat`. Map: `playPresenceAction` + `live.lastActionTs`.

---

### Phase H — QA, catalog, docs

1. Rebuild `world-catalog.json` (`build-catalog.py`) — track `usedByMap` rising toward **≥600** high-value assets (not every duplicate color).  
2. Update `ROOM_CATALOG.md` + this plan’s “done” checklist.  
3. Smoke: `test-anim.html`, mobile touch, public view mode.  
4. Capture before/after screenshots in `discord-map/_shot_*.png` pattern.  
5. No broken loads: `_missingAssets` empty for default demo guild.

---

## 4. Layout cookbook (for Claude — aesthetic rules)

### Lounge (general)

```text
[elev] [ sofa ] [ coffee table ] [ lamp ] [ plant ]
         wall: small art / clipboard high
```

### Office (dev)

```text
[elev] [ desk+laptop ] [ chair facing desk ] [ shelf ] [ plant ]
```

### Cafe

```text
[elev] [ counter run + pastry ] [ stool stool ] [ plant/pot ]
```

### Kitchen

```text
[elev] [ fridge ] [ counter + food props ] [ oven ] [ sink ]
```

### Cozy / AFK

```text
[elev] [ bed ] [ nightstand+lamp ] [ plant ]
```

**Pairing rules:**

- Chair always adjacent to desk (±1 slot), never opposite wall alone.  
- Coffee table always nearer sofa than elev.  
- Bookshelves flush to wall band, not mid-floor.  
- Food only on counters/tables/fridge-adjacent.  
- Never place two large sofas in a room under min width.

---

## 5. Agent collaboration protocol (Claude + Grok)

### Roles

| Agent | Does | Does not |
|-------|------|----------|
| **Claude** | Implements one phase slice per session; small diffs; runs local visual checks when possible | Rewrite all of game.js; invent new art; ignore zone rules |
| **Grok (CLI)** | Writes/refines this plan; reviews diffs; measures sheets; finishes incomplete modules; unblocks Claude; keeps scope tight | Duplicate Claude’s work unless Claude stalled |
| **User** | Approves phase order; provides re-downloaded packs / pet art; aesthetic thumbs up/down | — |

### Efficiency rules for Claude

1. **One phase sub-letter per PR/session** (e.g. only A2 anims).  
2. **Read** `ROOM_CATALOG.md` + this plan + relevant game.js section **before** coding.  
3. Prefer **data** (recipes JSON) over new algorithms.  
4. After each slice: list files changed + how to verify in browser.  
5. If blocked >15 min on asset paths, stop and ask Grok/user.  
6. Do not add npm deps unless necessary (Phaser CDN already).

### Grok review checklist (every Claude handoff)

- [ ] Climb lane still clear  
- [ ] Seeded deterministic placement  
- [ ] No label-frame in anims  
- [ ] Surfaces host props  
- [ ] New keys in ASSETS + catalog  
- [ ] No emoji status regressions  
- [ ] Sit/eat/lie still work  
- [ ] File size / monorepo noise (don’t commit huge accidental copies)

### Handoff template (Claude → Grok)

```text
PHASE: B2
DONE: ...
FILES: ...
VERIFY: open play.html / test-anim.html — expect ...
BLOCKED: ...
NEXT SUGGESTED: ...
```

---

## 6. Suggested execution order (fastest path to “wow”)

1. **A2+A3** — all anims wired + debug cycle (cheap, visible).  
2. **B2+B3+B5** — recipe rooms (biggest quality jump).  
3. **F1** — street/backgrounds (city block feel).  
4. **C** — food/eat.  
5. **E** — room nameplates + needs UI.  
6. **D** — pets.  
7. **G** — presence personality.  
8. **H** — catalog/docs/QA.

---

## 7. Out of scope (v1)

- Full economy / furniture shop purchases  
- Multiplayer physics authority server  
- Replacing Denizen main office (LimeZu) with Pixel Spaces  
- AI-generated art from pack (license forbids)  
- 100% of 2115 assets placed (use **coverage targets**, not every duplicate)

---

## 8. Success metrics

| Metric | Target |
|--------|--------|
| NPC anim coverage | 14/14 rows used in code paths |
| Map asset usage | ≥600 catalog entries referenced (or ≥2× current 320) |
| Room kits with full recipes | ≥10 kits |
| Theme buildings polished | ≥7 themes |
| Interactables | sit, lie, eat |
| Pets | cat + dog ambient |
| UI | nameplate + status + bubbles from pack only |
| Determinism | same guildId → same layout hash |
| Feel test | user says “looks designed, not random” |

---

## 9. Immediate next action

**Grok or Claude starts Phase A2** (full `makeAnims` + debug cycle) **without** waiting on pets or UI. That unblocks sit/eat/wave work and is low risk.

When user re-downloads the latest itch Animation Update, re-measure one `NPC 1.png` — if dimensions ≠ 256×448, stop and update the row map before any anim work.

---

*Living document — update checkboxes as phases complete. Owner: Discord Spaces map (`discord-map/`).*
