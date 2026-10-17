# Denizen — Scene Runtime

> Status: **Phase 0/1 shipped.** One shared Phaser 3 kernel
> (`window.DenizenSceneRuntime`) boots the office and exposes frozen
> scene commands. Discord Spaces and the full city keep their own
> scene files behind a thin adapter / helpers — no engine swap.

## Goal

Unify office, full-world, and Discord Spaces on **one modular Phaser 3
runtime** instead of three divergent Phaser clients. Nexen Three.js
stays a separate optional 3D hub.

## Surfaces

| Surface | Scene file | Runtime role today |
|---------|------------|--------------------|
| Office HQ | `office-scene.js` | Boots via `DenizenSceneRuntime.boot` |
| Full city | `src/full-world.js` | Shares cull / atlas helpers when loaded |
| Discord Spaces | `discord-map/game.js` | Thin adapter stub (`discordAdapter`) |

## Frozen public commands

These names are the contract. Callers (MCP office-act, AgentOfficeManager,
Discord bridge) should use them — do not grow three divergent verb sets.

| Command | Meaning |
|---------|---------|
| `spawn` | Place an actor (player / NPC / guest) |
| `navigate` / `walkTo` | Path / walk to a world point or named target |
| `use` / `interact` | Use furniture / interactable under or near the actor |
| `speak` | Show dialogue / bubble from an actor |
| `broadcast` | Push world / presence state to listeners |
| `setBlockers` | Update collision / walkability blockers |

Dispatch goes through `DenizenSceneRuntime.commands.dispatch(cmd, payload)`.

## Module map

```
docs/SCENE_RUNTIME.md          — this contract
src/scene-runtime.js           — IIFE → window.DenizenSceneRuntime
  ├── boot / preferCanvas      — Phaser.Game config + Canvas-default
  ├── LAYERS                   — ground / wall / furniture / actors / HUD
  ├── culling                  — chunk buckets (from full-world)
  ├── atlas                    — texture-atlas register / frame lookup
  ├── commands                 — frozen command bus
  └── discordAdapter           — stub mapping onto Discord map scene
```

**Stays in scene files:** layout, furniture catalogs, NPC AI, Discord
floor-graph, city generation. The kernel owns boot, layers, cull, atlas
helpers, and the command names — not content.

## Layers

Depth bands (Phaser `setDepth` conventions; scenes may still Y-sort
within a band via `DenizenMapEngine.footY`):

| Layer | Depth | Contents |
|-------|------:|----------|
| `GROUND` | 0 | Floors, roads, ground stamps |
| `WALL` | 10 | Walls, wall trim |
| `FURNITURE` | 20 | Props, desks, decor |
| `ACTORS` | 30 | Player, NPCs, vehicles |
| `HUD` | 1000 | Scroll-factor-0 overlays |

## Perf policy

- **Canvas is default** until atlases + chunk culling make WebGL safe on
  locked-down GPUs. Opt in with `?webgl=1`.
- Soft FPS / path / ambient knobs come from
  `DenizenDeviceProfile.lightPerf()`.
- Loader caps (`maxParallelDownloads: 4`) stay in the shared boot config.

## Spatial contract (direction)

Walkability, collision, and pathfinding should eventually come from one
layout source. Today:

- Office: A* via `OfficePathfinder` / `NpcPathFollower`
- Discord: floor-graph BFS inside `discord-map/game.js`
- Full city: own nav + chunk cull

Adapters normalize *commands*; they do not yet unify the graphs.

## Phase boundaries

| Phase | In scope | Out of scope |
|-------|----------|--------------|
| **0** | Freeze this contract | Code moves |
| **1** (this PR) | Extract kernel; wire office boot; cull/atlas/command helpers; Discord adapter stub | Engine swap; full Discord rewrite; Tilemap-as-default; WebGL-as-default |
| **2+** | Atlas-first furniture, Tilemap default, WebGL when safe, unify spatial/path, generators live, multi-office sync | Phaser 4 / Pixi unless needed |

## Non-goals (for now)

- Swapping Phaser for another engine
- Merging Nexen Three.js into this runtime
- Multi-office net sync
- Rewriting `discord-map/game.js` (~9k lines) in place

## Script order

Load after `device-profile.js` / `map-engine.js`, **before**
`office-scene.js`:

```html
<script src="./src/scene-runtime.js" defer></script>
<script src="./office-scene.js" defer></script>
```

## Related docs

- [SCENE.md](SCENE.md) — office-scene ownership map
- [WORLD_ENGINE.md](WORLD_ENGINE.md) — seeded generators
- [FULL_WORLD.md](FULL_WORLD.md) — city scene + cull notes
- [DISCORD_BOT_AND_SPACES.md](DISCORD_BOT_AND_SPACES.md) — Discord Spaces
