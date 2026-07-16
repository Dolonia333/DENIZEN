# Denizen — Pathfinding

> A* on a grid + per-NPC route follower + destination reservations + stuck
> recovery. See [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md)
> for the audited product-level status and limitations.

Source: [`src/pathfinding.js`](../src/pathfinding.js).

## The three classes

| Class | Responsibility | Lifetime |
|---|---|---|
| `OfficePathfinder` | Owns the walkability grid; runs A* searches | One per scene |
| `NpcPathFollower` | Per-NPC route advance; stuck detection; replanning | One per NPC |
| `MinHeap` | Priority queue used inside A* | Internal |

## OfficePathfinder

A flat `Uint8Array` representing the office floor at `cellSize`-pixel
resolution (default 8 px → 1280×720 world becomes 160×90 = 14,400 cells).
Cells are 0 (walkable) or 1 (blocked).

Plus a parallel `Float32Array` of "soft costs" added to A*'s g-score for
cells adjacent to obstacles. Without this, NPCs hug walls and snake
through corners; with it, they prefer open hallways.

### Building the grid

```js
const pf = new OfficePathfinder(scene.worldW, scene.worldH, 8);
pf.buildFromScene(scene);   // reads scene._obstacles + scene._npcs
```

What gets blocked:

1. World edges (2-cell border around the perimeter).
2. Every entry in `scene._obstacles` (walls and furniture collision boxes).
3. Selected large interactable furniture not already represented by an
   obstacle. Seat/decor/couch-like objects are skipped, while surface footprints
   use a deliberately shallow blocked height in crowded areas.
4. Soft-cost halo: cells near blocked cells get a
   penalty added so A* avoids hugging walls.

`buildFromScene()` is called once at scene start. If the layout changes
at runtime (you move a desk via the editor), call it again — it's fast
(~5 ms on a typical office).

### A* search

```js
const path = pathfinder.findPath(startX, startY, endX, endY);
// → [{x:120, y:50}, {x:120, y:60}, …] in world pixels
// or null if no route exists
```

- Heuristic: octile distance (because we allow diagonals).
- Tiebreaker: prefers paths with lower soft-cost (open hallways).
- Bails after 8000 explored nodes — on a 14,400-cell grid, anything
  larger than that is almost always a "blocked-off room" misconfiguration
  and exiting fast beats spinning.

The output is **world coordinates**, not grid coordinates. The caller
doesn't need to know the cell size.

## NpcPathFollower

The bridge between A* and the per-frame `update()` tick.

```js
const follower = new NpcPathFollower(npc, pathfinder, scene);
follower.navigateTo(targetX, targetY);
// later, every frame:
follower.tick(delta);
```

State the follower owns per NPC includes:

- `waypoints` and `waypointIndex` — current route and progress.
- `_stuckCount` — consecutive failed movement samples.
- `_rerouteCount` / `_maxReroutes` — bounded recovery attempts.
- `_totalStuckTime` — cumulative stall time for the route.
- `_reservationOwner` — identity used to reserve and release the destination.

### Stuck recovery

The signature failure mode of grid-based NPC movement is "agent gets
wedged against a corner and oscillates." The follower handles this in
three escalating steps:

1. Movement is sampled every 500 ms.
2. Two samples with less than 3 px progress trigger recovery after about 1s.
3. Recovery applies only a small 4–8 px nudge, then tries a waypoint skip.
4. If needed, the final goal is snapped to nearby walkable floor and A* runs
   again from the current position.
5. After five reroutes, no replacement path, or about eight cumulative seconds
   stuck, navigation is abandoned and friction is reported.

The normal follower no longer teleports an NPC to the next waypoint. An explicit
`forceUnstick()` API remains as an aggressive external fallback and can visibly
reposition a character.

`_stuckCount` is initialized to `0` in the constructor. (One of the
audit fixes in commit `fcdd397` — earlier code only set it inside
`tick()`, which left it `undefined` for the first stuck frame and
`undefined + 1 === NaN` broke the comparison.)

### Separation force

Inside `tick()`, the follower applies a small repulsive force away from
any other NPC within ~24 px. Without it, two NPCs targeting nearby
chairs end up squashed into the same cell. The force is intentionally
weak — strong enough to break ties, not strong enough to shove an NPC
off-route.

## MinHeap

Stock binary min-heap, keyed on the A* `f`-score. Used because
`Array.sort()` on every node insertion would be the dominant cost on
the 8000-node search budget.

## Tuning knobs

| Knob | Default | What it controls |
|---|---|---|
| `cellSize` (constructor) | 8 px | Grid resolution. Smaller = better paths, more memory. |
| `softCost` halo radius | 2 cells | How wide a "stay away from walls" zone surrounds each obstacle. |
| `pathfinder._maxExplored` | 8000 | Hard cap on A* nodes per search. |
| Stuck sample interval | 500 ms | How often progress is checked. |
| Failed samples before recovery | 2 | About 1 second before rerouting. |
| `follower._maxReroutes` | 5 | Recovery attempts before abandoning route. |
| Cumulative stuck limit | 8000 ms | Route is abandoned and reported. |
| Destination reservation radius | 48 px | Finds a distinct nearby walkable goal. |
| Separation radius | 24 px | NPCs closer than this push each other. |

All live in the file as plain constants — change in place, no config.

## Testing

[`tests/pathfinding.test.js`](../tests/pathfinding.test.js) covers:

- A* on an empty grid finds a straight line
- Blocked grid returns `null`
- Unreachable destinations return `null`
- World↔grid coordinate conversion round-trips
- `_stuckCount` initializes to 0 (regression guard for fcdd397)
- `navigateTo` populates waypoints when a path exists
- `navigateTo` returns false when no path exists

The test boots only `OfficePathfinder` + `NpcPathFollower` — no Phaser
scene. The grid is constructed manually with `pf.grid[idx] = 1` on
specific cells.

## Cross-references

- [SCENE.md](SCENE.md) — where the follower's `tick()` is called from
- [ACTIONS.md](ACTIONS.md) — `walkTo` and friends are thin wrappers
  around `follower.navigateTo()`
- [WORLD-STATE.md](WORLD-STATE.md) — NPC positions get mirrored from
  here into `worldState.npcs[name].position`
