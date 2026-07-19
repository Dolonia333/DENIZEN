# Discord Spaces Map (Pixel Spaces life block)

Phaser 3 side-scroller for Denizen: Discord guild categories → buildings, channels → rooms, named **neighbors** with community life (not jobs), pets, food, sit/lie, and door/stair pathing.

**Live NAS:** `https://denizen.dolonia.cloud/discord-map/`  
**Branch for polish work:** `feature/discord-spaces-map-polish`

---

## Quick start (localhost = same code as NAS)

From the **denizen** package root (where `server.js` lives):

```bash
# install once
npm install
cd discord-bot && npm install && cd ..

# run the main Denizen server (serves /discord-map/*)
npm start
# default: http://localhost:8080/discord-map/
# or: http://localhost:8080/discord-map/play.html
```

Static files are served from `discord-map/` (see `server.js` route `/discord-map/`).

### Optional: no server (static only)

```bash
npx --yes serve discord-map -p 5173
# open http://localhost:5173/play.html
```

Presence/API features need the full Denizen server + optional Discord bot.

### Hard refresh after edits

`play.html` cache-busts scripts (`?v=see4`). Bump that when shipping, or hard-refresh (Ctrl+F5).

---

## Repo layout (packs organized)

```
discord-map/
├── play.html              # Full game shell (preferred)
├── index.html             # Connect / closet entry
├── game.js                # Phaser scene, pathing, food, furniture, life AI
├── block-life.js          # Pure community sim (needs, relationships, day clock)
├── mobile-touch.js
├── world-catalog.json     # Generated catalog of pack paths
├── build-catalog.py       # Rebuild world-catalog.json
├── scripts/
│   └── inventory-sprites.mjs   # Used vs unused sprite report
├── SPRITE_INVENTORY.md    # Human summary of pack usage
├── sprite-inventory.json  # Machine-readable inventory
├── ARCHITECTURE.md        # How systems work + change guide
├── POLISH_BACKLOG.md      # Animations, placement, unused art
│
├── PixelSpaces/           # Base pack (~642 PNG)
│   ├── NPCs/Male|Female/  # 30 character sheets
│   ├── Furniture/         # Bathroom Bedroom Kitchen Living Room
│   ├── Objects/
│   ├── Backgrounds/
│   └── Infrastructure/    # Doors elevators roofs stairs
│
├── PixelSpacesFull/       # Full pack + expansions + UI (~1473 PNG)
│   ├── Individual Assets/ # Prefer variants from here in ASSETS
│   ├── Expansions/        # Cafe, Halloween, Hospital, Police, Winter…
│   ├── UI/Emotes/         # Floating reaction emotes
│   ├── UI/Chat Bubbles/
│   ├── UI/Icons/
│   └── Tilesets & SpriteSheets/
│
└── PacksExtra/            # Third-party free packs
    ├── Cats/              # Paws & Whiskers cat sheet (NON-COMMERCIAL)
    ├── Dogs/              # Golden retriever sheet (NON-COMMERCIAL)
    └── PixelPlatter/      # Food plates (burger pizza fruit…)
```

Regenerate inventory anytime:

```bash
node discord-map/scripts/inventory-sprites.mjs
```

---

## What shipped on this branch (NAS-aligned)

| Area | What was done |
|------|----------------|
| **NPC pathing** | `planActorPath` BFS over doors/stairs/passages; `actorNavigateTo` — no free Y warp mid-air |
| **Community life** | No jobs/work tags; hang/visit/stroll/eat/sleep/social |
| **Food** | All Pixel Platter plates registered; `seedFoodOnAllTables`; `actorEatFood` walks to plate + eat anim + bob |
| **Pets** | Free cat/dog sheets, distance-driven walk, foot origin on ground |
| **Sit/lie** | Seat/bed registry, seatedY lock, sitIdle/lieIdle |
| **Discord map social** | Reactions + `,eat` → `people[].action` → pose + held Pixel Platter food; no permanent head chrome |
| **Map polish** | Elevators + proximity; soft colored bubbles; section atmos palettes; door enter step; anim tune |
| **Deploy** | `infra/hotfix-discord-map-nas.py` packs `discord-map/` + bot onto NAS docker |

See **ARCHITECTURE.md** for file-level “how it was done,” including the presence action channel.

---

## Collaborate: improve animations & placement

1. Checkout this branch locally.
2. Run localhost (above).
3. Use **F8** pose cycle / **F9** anim gallery in-game.
4. Keys **1–6** on player: jump wave shrug snicker eat hurt.
5. From Discord (with bot + presence): react 👋 / 🍕 or `,eat pizza` while on the map.
6. Edit `NPC_POSE_DEFS` / `furn()` / kits — see ARCHITECTURE.md.
7. Pull unused art from **SPRITE_INVENTORY.md** / **POLISH_BACKLOG.md**.
8. PR against `feature/discord-spaces-map-polish` (or stack onto it).

Canonical bot/Spaces product doc: [`../docs/DISCORD_BOT_AND_SPACES.md`](../docs/DISCORD_BOT_AND_SPACES.md).

---

## Deploy to NAS (operator)

```bash
# from Denizen OS/infra with SYNO_* in .env
py -3 hotfix-discord-map-nas.py
```

Maps local `denizen/discord-map/` → container `/app/discord-map/`.

---

## License notes

- **Pixel Spaces** packs: follow the asset author’s commercial license for your product.
- **PacksExtra Cats/Dogs:** free **non-commercial** readmes — replace before commercial ship if needed.
- **Pixel Platter:** check pack terms separately.
