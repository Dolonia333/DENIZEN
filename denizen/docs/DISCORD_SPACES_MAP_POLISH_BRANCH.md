# Branch: `feature/discord-spaces-map-polish`

Collaborator entry point for the **Discord Spaces pixel map** work that is live on NAS.

## Why this branch exists

- Capture **all map + life-sim + pack** changes in one place.
- Document **how pathing / community life / food / pets** were implemented.
- Inventory **~2000+ sprites** so the team can wire unused emotes, expansions, and decor.
- Make **localhost = edit-ready copy of what NAS serves**.

## Checkout

```bash
git fetch origin
git checkout feature/discord-spaces-map-polish
cd denizen
npm install
npm start
# http://localhost:8080/discord-map/play.html
```

## Read first

| Doc | Purpose |
|-----|---------|
| [discord-map/README.md](../discord-map/README.md) | Run locally, pack tree, deploy |
| [discord-map/ARCHITECTURE.md](../discord-map/ARCHITECTURE.md) | Systems + “how it was done” |
| [discord-map/POLISH_BACKLOG.md](../discord-map/POLISH_BACKLOG.md) | What to improve next |
| [discord-map/SPRITE_INVENTORY.md](../discord-map/SPRITE_INVENTORY.md) | Used vs unused sprites |
| [docs/DISCORD_BOT_AND_SPACES.md](./DISCORD_BOT_AND_SPACES.md) | Bot + product context |

## NAS deploy (already used for live)

```bash
# Denizen OS/infra with SYNO credentials
py -3 hotfix-discord-map-nas.py
```

## Status snapshot

- Neighbors (no job grind): hang / visit / stroll / eat / sleep
- Door/stair pathing for NPCs (no air-walking)
- Pixel Platter food on tables; NPCs walk to plates and eat
- Free pet cat/dog packs under `PacksExtra/`
- Inventory script: `node discord-map/scripts/inventory-sprites.mjs`
