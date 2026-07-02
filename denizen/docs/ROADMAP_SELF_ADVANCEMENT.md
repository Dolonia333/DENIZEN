[Previous content up to the end of Stage 6 remains the same. Appending the new section for Multi-Agent Coordination.]

## Stage 6.5 — Multi-Agent Coordination & Mutex Locking (just shipped)

With individual agent safety rails solid (friction decay, backlog lifecycle, attempt caps), the next frontier is **systemic contention** when multiple NPCs (Bob + Bouncer, etc.) independently decide to self-build fixes for shared resources.

### The Problem We Solved
Without coordination:
- Multiple agents detect friction in the same shared file/domain (e.g. `src/utils.js` or `research_parse`).
- Both enter [SELF_BUILDING], both spawn coding-agent on the same target.
- Race conditions, working tree corruption, broken builds, double escalations.

### How the Coordination Layer Works

Implemented in `src/npc-local-metrics.js` (appendBacklog + mark) and `src/npc-brains.js` (_checkAutonomyBacklog):

**1. Global Deduplication & Upvoting**
- `appendBacklog(entry)` now scans existing pending/in_progress entries for matching `domain`.
- If match found: 
  - Add the new NPC to `impacted_npcs` array (if not already present).
  - Bump `friction_score` to the max.
  - Increment `priority` (capped at 10).
  - Rewrite the file — no duplicate entry created.
- High-impact systemic issues naturally bubble up because multiple agents "vote" by upvoting the same ticket.

**2. Multi-Agent Mutex (Build Locks)**
- Before triggering a build, `_checkAutonomyBacklog` filters the backlog to `available` items (skips those where `status === 'in_progress' && acquired_by && acquired_by !== current_npc`).
- When acquiring: `markBacklogInProgress(id, npcName)` sets `status: 'in_progress'` and `acquired_by: npcName` (plus updates last_triggered_ts and increments attempts).
- Other NPCs gracefully yield (`reason: 'backlog_mutex_locked'`) and continue their normal cycle.
- Lock is held for the duration of the build (future work: release on skill completion/failure).

**Updated Backlog Schema Example (enriched on upvote/acquire)**
```json
{
  "id": "...",
  "ts": "...",
  "npc": "Bob",
  "domain": "shared_utils",
  "friction_score": 42,
  "build_prompt": "...",
  "status": "in_progress",
  "priority": 8,
  "build_attempts": 1,
  "last_triggered_ts": "...",
  "impacted_npcs": ["Bob", "Bouncer"],
  "acquired_by": "Bob"
}
```

### Why This Is Critical for Scaling
- Prevents wasteful parallel work on the same problem.
- High-severity shared friction rises in priority faster via collective upvoting.
- Safe concurrency: only one agent mutates a resource at a time.
- Still fully observable via the MCP backlog resource (mentors see who is impacted and who holds the lock).
- Fits the zero-oversight goal: agents self-coordinate and self-yield without human intervention.

This layer was the direct next step after the lifecycle rails, as requested in the Grok-Claude mentor dialogue.

See also:
- `appendBacklog` and `markBacklogInProgress` (dedup + lock acquisition)
- `_checkAutonomyBacklog` (mutex filter + yield)
- The active mentor session for continued refinement

---

[Continue with future stages...]
