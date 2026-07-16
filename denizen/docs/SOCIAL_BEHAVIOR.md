# Denizen — Social Behavior

> Current implementation and gap status: [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md).

> The layer that sits on top of [AWARENESS](AWARENESS.md). Once an NPC
> *knows* what's around them, this doc covers what makes them *act*
> like a coworker: stopping mid-sentence when someone speaks to them,
> the receptionist offering a tour to a lost player, basic office
> manners in the system prompt, and silent thought bubbles for
> internal monologue.

## TL;DR

| Behavior | Trigger | What happens |
|---|---|---|
| **Conversation focus (peer)** | NPC A calls `speakTo(B, msg)` | B is pinned for ~8s, faces A, and B's next think prompt contains `Acknowledge them before doing anything else`. Any walk-y action B picks is auto-converted to `talk → A`. |
| **Conversation focus (player)** | Player sends a chat message | Target NPC walks over if >80px away, pins for ~12s (longer than peer-pin because human typing + LLM round-trip is slower), and the prompt sees `"the CEO just spoke to you"`. |
| **Receptionist tour** | Player has been idle >45s | Lucy walks to the player, greets them, then walks them past 2 nearest NPCs who introduce themselves. Cooldown 5 min. |
| **Office manners** | Every think cycle | Six short rules are appended to the system prompt: don't interrupt, acknowledge greetings, brevity, etc. |
| **Think aloud** | NPC emits `[ACTION:thinkAloud:...]` | Renders as a thought-cloud bubble. Does NOT pin anyone or generate audio. |
| **Fatigue** | NPC sits at desk >45 min, or peer >60 min | Self: prompt line `"You've been at your desk for 50 minutes — a short break or chat would be reasonable."` Peer: appears in `Nearby:` as `tired (75m at desk)`. |
| **Stuck-loop detection** | Same question repeated 3x between two NPCs inside 10 min | Prompt line: `"Stuck loop with Josh: 'mockups ready yet?' repeated 3x. Break the cycle — escalate, change topic, or stop checking in."` |
| **Purposeful ambient trip** | Simulation host releases an eligible desk worker | NPC stands away from the desk, visits a room/coffee/coworker, then walks back to the assigned chair. |
| **Coffee favor** | Scheduled eligible pair is available | Request, acceptance, coffee trip, delivery, thanks, and both return to work. |

## Physical office-life choreography (2026-07 audit)

The social layer now includes deterministic physical choreography in addition to
LLM-selected actions. Every assigned NPC begins with a desk/chair pose before the
first ambient release. The simulation host then releases small staggered batches
for purposeful trips so the office stays active without sending the entire roster
through one doorway at once.

The coffee-favor sequence is deliberately bounded and timer-driven. It looks like
a social understanding loop, but it is not a general plan negotiated by two
agents. The dialogue lines are selected from short variations, movement uses the
ordinary action/pathfinding layer, and a mutex prevents two coffee favors from
overlapping. No persistent carried-cup inventory was verified.

Spectator clients do not independently schedule these behaviors after simulation
host state is known. They are expected to mirror the authoritative office state.

## Conversation focus (Phase A)

Before: NPC A says "Hey Josh" and walks at Josh. Josh, mid-think,
decides to take a coffee break and walks off as A arrives. Result: A
talks to empty air.

After:

1. `agent-actions.speakTo(A, B, text)` resolves with `mode='arrived'`:
   - B's facing flips toward A.
   - B's velocity is zeroed.
   - `B.ai._addressedUntil = scene.time.now + 8000`.
   - `B.ai._addressedBy = aKey`.
   - A `npc_addressed` WS message is sent to the server.
2. Server mirrors into `worldState.npcs[B].lastAddressed = { by, text, at }`.
3. B's *next* think prompt's `## Current State (live)` block contains:
   `- Alex just spoke to you 3s ago: "...". Acknowledge them before
   doing anything else — it is rude to walk off mid-conversation.`
   (Auto-expires at 30s.)
4. If B's next decision is `work`/`break`/`wander`/`visit`/
   `collaborate` while `_addressedUntil > now`, the
   `agent-office-manager._executeNpcDecision` guard rewrites it to
   `talk → A` so B physically stays put and responds.

### Why two layers (prompt hint *and* client guard)?

Belt and suspenders. The prompt hint gives the LLM a chance to write a
contextually-good reply. The client guard catches cases where the
prompt was ignored or the response was already in flight.

## Receptionist tour (Phase B)

`agent-office-manager._sendOfficeState` ships a `player_idle` WS
message each tick with `{ idleMs, position: { x, y, room } }`. The
server mirrors into `worldState.environment.playerIdleMs` and
`playerPosition`. Every NPC then sees a `Player presence: ...` line in
their context block when the player is in the office.

A separate client-side timer (`_maybeOfferTour`, every 15s) checks:

- Lucy is not currently `task_override` or `tour_guide`.
- Last tour was >5 minutes ago.
- Player has been idle >45s.

When all three hold, `_runLucyTour` walks Lucy to a spot beside the
player, has her greet them, picks the 2 nearest NPCs, walks her to
each, and sends `npc_introduce` for each stop. Server handler routes
that to `npcBrains.getResponse(stop, 'Lucy', context)` and broadcasts
the reply as a normal `npc_response`, so bubbles + voice work without
any new wiring.

## Office manners (Phase C)

A 6-line `## Office Manners` section is appended to every NPC's system
prompt just before `## Current State (live)`. Intentionally short —
the LLM only needs the gist:

```
- If someone is mid-sentence or just spoke to you, acknowledge them before walking off.
- If a peer is `busy` (meeting / walking), don't interrupt unless it's urgent.
- Greet people you haven't spoken to in a while; short small talk is fine.
- Don't repeat the same check-in question — vary your topic or wait.
- The CEO (the human player) gets a hello if they're standing near you.
- Brevity is a virtue. One short sentence usually beats three long ones.
```

Adding rules costs prompt tokens. Resist the urge to make this section
long — every bullet should match an observable bad behavior we want
gone.

## Player-initiated focus (Phase E)

Same mechanism as peer-to-peer focus, applied to the player. When the
player sends a chat:

1. `player-chat.sendMessage` resolves the target NPC (by name, facing,
   or nearest).
2. If the NPC is >80px away, calls `actions.reportToCEO(targetKey)` —
   walks the NPC over via A* pathfinding.
3. `_stopNpcForConversation` then:
   - Stops the NPC's body, sets `ai.mode='agent_task'`, `taskState='reporting'`.
   - Sets `ai._addressedUntil = now + 12000` (4s longer than peer pin
     because the LLM round-trip for a player chat is slower than a
     scripted speakTo, so the NPC needs more grace before it's allowed
     to wander).
   - Sets `ai._addressedBy = '__player__'`.
   - Sends `npc_addressed` over WS with `from: 'the CEO'` and the
     player's actual chat text. The server mirrors into worldState so
     the NPC's next think prompt sees:
     `- the CEO just spoke to you 3s ago: "...". Acknowledge them
     before doing anything else.`

## Fatigue tracking (Phase F)

`worldState` now tracks per-NPC `deskSittingSince` and `lastBreakAt`.
Updated whenever `agent-office-manager._sendOfficeState` ships an
agent status — `working` calls `worldState.recordDeskStart(name)` (idempotent
so it doesn't reset on every tick), and `break`/`walking`/`talking` clears
the timer (with `break` also stamping `lastBreakAt`).

Two surfaces in `renderContextBlock`:

- **Self-fatigue** (after 45 min at desk): `"You've been at your desk
  for 50 minutes, last break was 90 min ago. A short break or chat
  would be reasonable."` Combined with the Office Manners line about
  breaks, this nudges the LLM to pick a `break` / `talk` action
  without hard-coding it.
- **Peer-fatigue tag** (after 60 min): peer appears in `Nearby:` as
  `Josh (working, tired (75m at desk))` so teammates can offer a
  coffee run or quick check-in.

## Stuck-loop detection (Phase G)

Self-repetition catches "I asked the same thing 90s ago" *within one
NPC*. Stuck-loop is the cross-NPC version: when Alex and Josh keep
bouncing the same question back and forth.

`worldState.recordExchange(from, to, text)` is called from `npc-brains`
whenever a decision contains a target + message (same hook as the
existing `recordContact`). Stored in a per-pair ring (cap 6 per pair,
100 pairs total).

`worldState.stuckLoop(npcA, npcB, { windowMs=10min, minRepeats=3 })`
returns `{ count, sample }` when 3+ near-duplicate exchanges from
either side are inside the window. Same normalisation as
self-repetition (lowercase, strip punct, first 8 words).

Surfaced in `renderContextBlock` as:

```
- Stuck loop with Josh: "mockups ready yet?" repeated 3x. Break the cycle —
  escalate, change topic, or stop checking in.
```

Only one loop surfaces per think to keep the prompt tight. The LLM is
trusted to act on it — there's no client-side rewrite (unlike
conversation focus, where the guard exists because the rewrite is
visually obvious).

## Think aloud (Phase D)

Added a new action: `[ACTION:thinkAloud:short internal thought]`.
Routed in `agent-office-manager` directly to `actions.think(npcKey, text)`,
which renders a thought-cloud bubble (not a speech bubble) over the
NPC's head. Does NOT trigger voice synthesis, does NOT pin nearby
NPCs into a conversation, does NOT count toward self-repetition.

Use cases (LLM picks naturally with the prompt hint):

- "I should follow up with Marcus..."
- "If this build fails one more time, I'm rewriting it in Go."
- "Wait, did I close the PR?"

## Audio modes (listen-in / focus / mute-all)

Three player-controlled audio modes layered on top of the proximity
volume system. Toggle via the **🔊 chip in the bottom-left corner** or
the **Alt+L** keyboard shortcut. Persisted in `localStorage` under
key `denizenAudioMode`.

| Mode | What you hear |
|---|---|
| **🔊 Listen-in** (default) | Ambient office — proximity volume falloff + facing penalty + active-convo override (the original proximity-audio behavior). Distant NPCs whisper, close ones are full volume. |
| **🎯 Focus** | Only ONE NPC at a time. The active conversation partner if set (player just chatted them within 30s); otherwise the single closest NPC within `fullVolumeRadius` (90 px). Everyone else is hard-muted regardless of distance. |
| **🔇 Mute-all** | Every NPC line silenced. Speech bubbles still render — purely an audio gate. |

Programmatic surface on `window.DenizenProximityAudio`:

```js
DenizenProximityAudio.getAudioMode()      // → 'ambient' | 'focus' | 'mute-all'
DenizenProximityAudio.setAudioMode('focus')
DenizenProximityAudio.cycleAudioMode()    // → next mode
DenizenProximityAudio.MODES               // ['ambient','focus','mute-all']
```

Each `setAudioMode` call fires a `denizen:audiomode` CustomEvent on
`window` so the chip stays in sync if you flip the mode from elsewhere
(e.g. a future settings panel).

## Files touched

- `src/world-state.js` — `renderContextBlock` surfaces `lastAddressed`,
  `playerPosition`, self-fatigue, peer-fatigue tag, stuck-loop. New
  helpers: `recordBreak`, `recordDeskStart`, `minutesSinceBreak`,
  `minutesAtDesk`, `recordExchange`, `stuckLoop`. Independent of
  `zionPresent` (which is voice).
- `src/agent-actions.js` — `speakTo` `finish('arrived')` pins target
  with `_addressedUntil` and sends `npc_addressed` WS message.
- `src/agent-office-manager.js`:
  - `_executeNpcDecision` rewrites move-y actions while addressed.
  - `_sendOfficeState` sends `player_idle` with position + room.
  - `_maybeOfferTour` + `_runLucyTour` — tour scheduler + runner.
  - `case 'thinkAloud'` — action dispatch.
- `src/cofounder-agent.js` — `office_state` mirror now also calls
  `recordDeskStart` / clears `deskSittingSince` based on status, so
  fatigue is derived automatically from existing ticks.
- `src/npc-brains.js` — `## Office Manners` block + `thinkAloud`
  action listed in the per-role action vocabulary. `recordExchange`
  called alongside `recordContact` for stuck-loop detection.
- `src/player-chat.js` — `_stopNpcForConversation` now pins the NPC
  via `_addressedUntil` and broadcasts `npc_addressed` so the player
  gets the same focus treatment as a peer.
- `server.js` — `npc_addressed`, `player_idle`, `npc_introduce`
  WS message handlers.

## What this is NOT

- Not a multi-party conversation manager. Two NPCs can be addressed at
  once but they don't share a "conversation room" abstraction. The
  `lastAddressed` field is per-NPC.
- Not a planner. Lucy doesn't *decide* to give a tour through her LLM;
  the tour is a scripted client-side routine triggered by idle time.
  Letting Lucy's brain decide would be a Phase B+ extension.
- Not an interruption model. NPCs can still be interrupted — the
  manners section just *encourages* not interrupting. There is no
  hard lockout.

## See also

- [AWARENESS.md](AWARENESS.md) — what NPCs know
- [AI-SYSTEM.md](AI-SYSTEM.md) — system prompt structure
- [ACTIONS.md](ACTIONS.md) — action vocabulary
- [WORLD-STATE.md](WORLD-STATE.md) — the singleton everything mutates
- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — where this goes next
