# Denizen Current Implementation Status

> Evidence-based inventory of what exists, what is conditional, what is partial,
> and what is not yet implemented. Last audited: **2026-07-15**.

This document is the current-state companion to the architecture, product, and
roadmap documents. Architecture pages explain intended design; roadmap pages
explain planned direction. This page records what the repository and deployed
office demonstrably do today.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Implemented** | A working code path exists and was inspected in this audit. |
| **Conditional** | Implemented, but requires a runtime role, service, credential, flag, or data source. |
| **Partial** | Some behavior exists, but it does not yet satisfy the complete product intention. |
| **Scaffold** | Types, UI, route, or placeholder behavior exists without a complete production loop. |
| **Not implemented** | No verified working implementation was found. |
| **Not verified** | Code may exist, but it was outside this audit or requires an unavailable external system. |

Do not interpret the presence of a UI panel, route name, roadmap item, or markdown
page as proof that a feature is production-ready. Use the status and evidence
columns below.

## Audit scope and evidence

This pass inspected the active `denizen/` project, with emphasis on:

- the regular office and public demo entry paths;
- NPC roster, spawning, seating, standing, walking, social errands, and meetings;
- A* pathfinding, collision avoidance, reservations, yielding, and recovery;
- browser/demo filtering and simulation-host ownership;
- local and NAS deployment paths;
- package scripts, test layout, and existing documentation.

Repository snapshot observed during the audit:

- approximately **302 files** directly under `src/`;
- approximately **168 files** directly under `tests/`;
- multiple major surfaces: office, visitor UI, CRM, Discord map/bot, desktop,
  companion extension, MCP services, Jelly skills, Supabase, and infrastructure;
- a deliberately dirty working tree containing active user work. Documentation
  changes must not be treated as a clean release snapshot or as proof that every
  unrelated local change is deployed.

Primary evidence for the office behavior:

| Concern | Primary source |
|---|---|
| Scene creation, spawn/reveal, collision and yielding | `office-scene.js` |
| Physical NPC actions and desk/chair geometry | `src/agent-actions.js` |
| Ambient schedules, coffee favors, meetings, decision dispatch | `src/agent-office-manager.js` |
| A*, walkability, destination reservations, stuck recovery | `src/pathfinding.js` |
| Browser demo roster and read-only mode | `src/public-demo-mode.js` |
| Server-side optional demo brain trimming | `src/demo-roster.js` |
| Canonical browser roster | `src/npc-roster.js` |
| Script loading/cache revisions | `index.html` |
| Runtime and test commands | `package.json` |

## Product surface inventory

| Surface | Status | What is present | Important qualification |
|---|---|---|---|
| Phaser pixel office | **Implemented** | Main office scene, NPC sprites, furniture, rooms, player movement, interactions, overlays | Exact behavior depends on browser profile and server connectivity. |
| Regular authenticated office | **Implemented / Conditional** | Full roster path, visitor/account layers, chat and agent integrations | Authentication, Supabase, gateway, LM, and other integrations require configured services. |
| Public demo | **Implemented** | `?demo=1` or `?mode=demo`, read-only spectator label, curated eight-NPC roster filtering | The configured list uses Marcus's canonical `conference_man` folder ID and matches eight browser-roster entries. |
| NPC physical office life | **Implemented** | Starts seated, purposeful trips, coffee/breakroom/room visits, coworker visits, return-to-desk, meetings | Only the elected simulation host creates ambient motion. Spectators mirror host state. |
| LLM-backed decisions | **Conditional** | Decision/action parsing and dispatch, context and office state integration | Requires the relevant backend/model/gateway. Light-office mode can pause LLM thinking while ambient behavior continues. |
| Multiplayer/spectator synchronization | **Conditional** | Simulation-host ownership and spectator behavior exist | Correctness depends on server connection and host election; non-host clients intentionally do not invent movement. |
| Voice and audio | **Conditional** | TTS/STT and proximity/listen modes are represented in code/docs | Requires browser support and configured providers; not every deployment has every provider enabled. |
| CRM | **Implemented / Conditional** | Dedicated CRM project, routes, tests, UI, vendor build | External sync and provider-specific functions need credentials and services. |
| Discord map and bot | **Implemented / Conditional** | Separate map and bot surfaces exist | Live Discord behavior requires bot credentials and gateway connectivity. |
| Desktop/compute mesh | **Conditional** | Desktop and mesh scripts, onboarding and smoke commands exist | Requires enrolled nodes, NAS/network reachability, and runtime configuration. |
| MCP gateway and companion | **Conditional** | Gateway/companion modules, tests, and documentation exist | Tokens, scopes, provider connections, and external clients must be configured. |
| Supabase persistence | **Conditional** | Migrations, auth/data integrations, and tests exist | A running/configured Supabase deployment is required. |
| Fully autonomous human-equivalent understanding | **Not implemented** | NPCs combine scripted choreography, model decisions, memory/context, and world state | They do not possess general understanding; realism is produced by bounded systems and available model output. |

## Regular office versus public demo

### Regular office

The regular office uses the canonical roster and the authenticated/visitor feature
layers. It may run the complete simulation when the client is elected simulation
host. It can expose chat, claims, account features, projects, MCP connectivity,
phone UI, CRM links, and other integrations based on session and deployment.

### Public demo

The public demo activates through either query form:

```text
/office?demo=1
/office?mode=demo
```

Current configured folder allowlist:

```text
abby, alex, lucy, bouncer, marcus, josh, jenny, roki
```

The browser filter intersects this list with `DenizenNpcRoster.entries`; it never
fabricates a missing NPC. During the 2026-07-15 live verification, the result was:

```text
xp_abby, xp_alex, xp_jenny, xp_lucy, xp_bouncer, xp_josh, xp_roki
```

The default filter now matches **eight rendered NPC definitions**, up from the
previous four-NPC demo. Marcus is identified by display name `Marcus`, texture
`xp_conference_man`, and canonical folder ID `conference_man`.

The public demo is read-only at the browser policy layer. It is a spectator view,
not a separate simplified physics engine. If it is not simulation host, it should
display authoritative poses and positions rather than independently scheduling
ambient walkers.

Server-side brain trimming is separate and opt-in. `src/demo-roster.js` returns a
trim list only when both are true:

```text
DENIZEN_PUBLIC_DEMO=true
DENIZEN_PUBLIC_DEMO_TRIM_BRAINS=true
```

`DENIZEN_PUBLIC_DEMO_NPCS` can override the default folder list. Browser query
parameters `demo_npcs` or `npcs` can override the browser-rendered allowlist.

## NPC office-life lifecycle

### 1. Loading and first reveal

**Implemented.** NPC sprites are created hidden, stationary, and marked with
`taskState: "loading"`. This prevents them from wandering from a spawn point and
then visibly snapping back to a desk while furniture and assignments initialize.

The office manager assigns desks after furniture becomes available and applies the
seated pose. The sprite is revealed after the pose is ready. A failsafe reveal
prevents an NPC from remaining permanently invisible if assignment fails.

### 2. Desk and chair assignment

**Implemented.** Desk use is chair-anchored, not desk-center-anchored. The action
layer locates a chair near the assigned desk, derives a sit position, and applies:

- a reduced physics body while seated;
- a seated crop/scale treatment for the character sprite;
- direction-sensitive depth ordering against chair and desk;
- a typing indicator for working state;
- stored original scale/depth so standing restores the sprite correctly.

This is the mechanism that makes a character appear behind/in a chair instead of
standing on top of the desktop. Accuracy still depends on furniture metadata,
sprite origins, and the chair actually being paired with the intended desk.

### 3. Standing up

**Implemented.** Standing restores crop, scale, depth, and indicators. The NPC then
steps approximately 26 pixels away from the desk, using the chair-to-desk vector,
and snaps that proposed position to nearby walkable floor when possible.

This deliberately avoids a facing-only offset, which could put south-side chairs
inside the desktop and make the first walking frames cross the desk.

### 4. Purposeful activity

**Implemented.** Ambient office life begins after an opening seated tableau. The
default non-light schedule currently uses:

- two initial walkers after roughly 9 seconds;
- normally one newly released walker every roughly 24 seconds;
- phone/light profiles limited to small batches and no faster than 16 seconds;
- purposeful protection windows so desk enforcement does not pull a walker home
  in the middle of a trip.

Potential ambient destinations/actions include:

- break room;
- coffee-like furniture;
- reception, conference, storage, or open office;
- a coworker's location;
- role-specific routines and ambient chatter;
- structured meetings triggered by decisions or office events.

The exact action is randomized and also constrained by current status. NPCs marked
as engaged, meeting, reporting, talking to the CEO, touring, securing, or otherwise
busy are excluded from ordinary ambient releases.

### 5. Returning to work

**Implemented.** A purposeful trip schedules a later return. `useComputer(...,
{ instant: false })` walks to a walkable point near the chair, monitors arrival,
and applies the chair pose only when close.

The previous far-distance timeout snap is no longer used. If the NPC is still far
from the chair after the long timeout, the sit attempt is abandoned and the NPC is
released back to the floor rather than teleported across the office.

An explicit `teleportToDesk()` method still exists for callers that intentionally
request an instant placement. It is not the normal ambient return path.

### 6. Coffee favor choreography

**Implemented scripted social sequence.** On its schedule, the manager may select
two eligible desk workers:

1. requester asks the runner for coffee;
2. runner accepts and stands;
3. runner walks to coffee/breakroom furniture;
4. runner visits the requester;
5. runner announces delivery;
6. requester thanks the runner;
7. both walk back to assigned desks.

A mutex prevents overlapping favor sequences, and a safety timeout releases the
mutex if another event interrupts navigation. The coffee cup is currently a
semantic/choreographic object; this audit did not find a verified persistent cup
inventory or hand-held cup sprite transfer.

### 7. Meetings and conversation

**Implemented with mixed scripted/model behavior.** NPCs can visit coworkers,
speak, be pinned briefly when addressed, gather in the conference area, exchange
meeting lines, and return afterward. Conversation focus guards reduce the chance
that a target walks away mid-sentence.

Limitations:

- timing is timer- and status-driven rather than a general negotiation protocol;
- model-generated quality depends on backend availability;
- simultaneous events can still interrupt choreography;
- meeting occupancy and personal-space behavior are heuristic.

## Navigation and collision avoidance

### Implemented layers

1. **Grid construction** — `OfficePathfinder` builds a `Uint8Array` walkability
   grid from world bounds, scene obstacles, and selected furniture footprints.
2. **Doorway carving** — known openings are re-carved after obstacle blocking so
   thick wall collision rectangles do not seal rooms.
3. **Soft costs** — cells near obstacles cost more, encouraging aisle-centered
   paths instead of wall hugging.
4. **Smart path search** — callers can use room-aware/smart routing where present,
   with ordinary A* as fallback.
5. **Destination reservations** — each follower reserves nearby walkable space so
   several NPCs do not choose the same coffee, conversation, or doorway pixel.
6. **Separation/yielding** — runtime movement applies separation, and deterministic
   head-on yielding helps one of two aisle walkers give way consistently.
7. **Fast stuck checks** — movement is sampled every 500 ms; two failed checks
   trigger recovery after about one second.
8. **Recovery** — small 4–8 pixel nudge, waypoint skip, goal snap to nearby
   walkable floor, and route recomputation.
9. **Failure exit** — after repeated reroutes or roughly eight cumulative seconds
   stuck, the route is abandoned and friction is reported.

### What navigation does not guarantee

- It is not a navmesh or reciprocal-velocity-obstacle crowd simulator.
- Dynamic furniture edits require grid rebuilding to become authoritative.
- Destination reservations are short-lived coordination, not room-capacity
  planning.
- `forceUnstick()` can still reposition an NPC more visibly than ordinary recovery;
  it is an explicit aggressive fallback, not the normal follower loop.
- Dense crowds, malformed collision boxes, sealed doorways, and inaccurate sprite
  footprints can still cause stalls or visual overlap.
- No proof exists that every generated/editor-authored layout is reachable.

## Simulation ownership and synchronization

**Implemented / Conditional.** Ambient movement is guarded by simulation-host
state. Once host state is known, non-host clients do not start their own ambient
office-life scheduler. This prevents each spectator from creating a different
reality.

What remains conditional:

- host election and updates require the live server connection;
- a disconnected local office can run without the external OpenClaw gateway, but
  gateway-backed intelligence and cross-client synchronization are unavailable;
- reconnects and interrupted choreography remain distributed-systems edge cases.

## Configuration and tuning points

| Behavior | Current location | Current observed value/behavior |
|---|---|---|
| Grid cell size | pathfinder construction | Normally 8 px in the office |
| Destination search radius | `NpcPathFollower.navigateTo` | 48 px reservation search |
| Waypoint arrival radius | follower update | 14 px |
| Stuck sample interval | follower update | 500 ms |
| Reroute trigger | follower update | 2 failed samples, about 1 second |
| Maximum reroutes | follower constructor | 5 |
| Cumulative stuck abandonment | follower update | 8 seconds |
| Ambient initial walkers | office manager | 2 on normal profile |
| Ambient release period | office manager | 24 seconds normal, 18 seconds light |
| Coffee favor first attempt | office manager | 50 seconds |
| Coffee favor repeat | office manager | 95 seconds |
| Normal return window | office manager | random 26–48 seconds |
| Desk-walk timeout | actions | 22 seconds; far NPC is released, not snapped |

These are implementation constants, not stable public API guarantees.

## Deployment state and runbook

### Local

The Node server is launched from `denizen/` with the package start command and its
environment file. The office is normally reached at the configured local port,
for example:

```text
http://localhost:8081/office
http://localhost:8081/office?demo=1
```

### NAS production

The current live office is hosted from the NAS in the `denizen-server` container
and exposed through the public Denizen domain. Infrastructure scripts load private
connection values from `infra/.env`; secrets must never be copied into docs.

Two deployment modes exist in practice:

- **full deploy/rebuild** — appropriate for a reproducible release;
- **scoped runtime hotfix** — copies selected verified files into the running
  container and restarts it.

The 2026-07-15 NPC navigation and demo-roster work used scoped hotfixes because the
working tree contained many unrelated active changes. This means the live runtime
can be ahead of the last full image build. A future image rebuild must include the
same source changes or it may overwrite the hotfix.

Minimum post-deploy verification for this area:

1. syntax-check changed JavaScript with `node --check`;
2. restart the target container;
3. confirm `/office?demo=1` returns HTTP 200;
4. confirm the served `index.html` contains the intended cache revision;
5. open the public URL in a fresh browser context;
6. verify the console spawn line and inspect browser errors;
7. visually verify seating, standing, first walk, collision behavior, and return.

## Tests and verification coverage

### Present

- the package exposes a general `npm test` runner;
- focused visitor, CRM, and end-to-end commands exist;
- many smoke commands exist for NAS, mesh, desktop, credits, onboarding, MCP,
  phone, CRM, and the intelligence spine;
- pathfinding tests exist and cover core search/follower behavior;
- browser-level manual verification has been performed for the recent office
  changes on localhost and the public deployment.

### Gaps

- No verified deterministic automated test covers the complete sequence
  `hidden spawn → chair pose → stand → route → social action → return → sit`.
- No verified visual-regression test asserts that a seated sprite is behind the
  desk/chair at every workstation orientation.
- No verified crowd stress test proves collision behavior for the maximum roster.
- Timer/random-driven ambient scenarios are harder to reproduce than unit-tested
  state machines.
- A scoped NAS hotfix is operationally verified but not equivalent to a clean
  image build from a clean commit.

Recommended next tests:

1. seeded ambient scheduler tests;
2. chair geometry fixtures for north/south/east/west desk arrangements;
3. screenshot assertions for seated and first-standing frames;
4. a navigation soak with all NPCs repeatedly targeting coffee, conference, and
   nearby desks;
5. a two-browser host/spectator synchronization test;
6. a deployment smoke that compares running-container file hashes to the release.

## Known gaps and non-goals

### Current known gaps

- The eight-NPC demo roster is covered by a regression test that verifies Marcus's
  canonical `conference_man` folder ID and keeps browser/server defaults aligned.
- Coffee delivery has dialogue and movement but no verified carried-cup asset or
  inventory transfer.
- Navigation remains heuristic under dense dynamic crowds.
- Chair alignment depends on asset and furniture metadata quality.
- External intelligence, voice, auth, market, Discord, CRM, and mesh features vary
  with service availability and credentials.
- Some existing docs predate current implementations and may still contain stale
  constants or aspirational language. This page takes precedence for status; the
  source code takes precedence over all docs.

### Not claimed

- perfect collision-free movement in every layout;
- human-level understanding or agency;
- guaranteed completion of every timed social sequence;
- full offline equivalence to the connected production system;
- that all local working-tree changes are deployed;
- that every route, integration, or UI panel has been exhaustively audited in this
  pass.

## Documentation maintenance rule

When changing a feature:

1. update its dedicated technical page;
2. update this status inventory if implementation maturity changes;
3. update `DOCS_INDEX.md` if a document is added, renamed, or superseded;
4. include the concrete source files and configuration flags;
5. label external-service behavior **Conditional**;
6. list known limitations and missing tests;
7. avoid checkmarks or “production-ready” claims without evidence;
8. record deployment mode when production was hotfixed outside a full image build.

## Related documents

- [DOCS_INDEX.md](DOCS_INDEX.md) — documentation map
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime topology
- [SCENE.md](SCENE.md) — office scene ownership
- [ACTIONS.md](ACTIONS.md) — physical action vocabulary
- [PATHFINDING.md](PATHFINDING.md) — navigation internals
- [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md) — conversation and social rules
- [NPCS.md](NPCS.md) — roster and roles
- [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md) — production runbook
- [TESTING.md](TESTING.md) — test strategy and commands
