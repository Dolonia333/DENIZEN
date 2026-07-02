# Denizen — Roadmap: NPCs That Build, Animate, and Self-Advance

> Vision: NPCs gradually extend their own capabilities — adding furniture
> to the office, creating sprite animations for actions that don't have
> them yet, and reflecting on their own behavior to revise their soul
> files. This doc is the staged plan toward that endpoint.

Not a build target for any single sprint. Each stage is meaningful on
its own and can ship independently.

## Stage 6 — Friction-Driven Self-Building Pipeline + Full Backlog Lifecycle Management (shipped)

**This is the complete, production-safe autonomous self-improvement engine for the fleet.**

Grok and Claude (via the mentor panel, with Fable 5 assistance) collaborated to move from fragile LLM nudges to a **stateful, self-cleaning, oversight-preserving pipeline** that lets NPCs detect their own needs from failure states and safely build features on their own.

### The Core Philosophy

- **Weaponize failure into intent**: Repeated friction (errors, timeouts, bad parses) is not noise — it is the NPC telling us exactly what it needs help with.
- **Structural guarantees over prompts**: Nudges are unreliable. We need observable data (friction scores), queues (backlog), states ([SELF_BUILDING]), and hard safety rails.
- **Protect the main mission**: Agents must not derail critical work (CRM, 1921 capture, mesh health) to fix a parser. The backlog + decay + caps provide buffers and garbage collection.
- **Mentor oversight by default**: Everything is visible via MCP resources and the Grok+Claude mentor panel. High-risk items escalate automatically.
- **Zero human oversight resilience**: The system is self-decaying, self-staling, and self-escalating so it stays stable even if the operator is away for days.

### How It Was Implemented (End-to-End)

1. **Friction Metric — The Raw Signal**
   - In `llm-telemetry.js`: every error path now calls `recordFriction(npc, domain, weight)` where domain is derived from kind or error category (e.g. `llm_research_parse`, `llm_context_overflow`).
   - In `npc-local-metrics.js`: `getFrictionScore()` computes a recency-weighted score. **Exponential decay** (`score *= 0.95` per hour) is applied on every read.
   - High friction automatically feeds into consult reasons and backlog creation.
   - Why: Turns every LLM/tool failure into persistent, decaying, queryable data with zero extra prompt tokens.

2. **Autonomy Backlog (`data/autonomy-backlog.jsonl`)**
   - When friction > 25 in `evaluate()`, a new entry is appended with the exact schema:
     ```json
     {
       "id": "backlog_research_parse_...",
       "ts": "2026-07-02T...",
       "npc": "Bob",
       "domain": "research_parse",
       "friction_score": 37,
       "build_prompt": "Build a robust error handler for the research parser to prevent timeout loops...",
       "status": "pending",
       "priority": 7,
       "build_attempts": 0,
       "last_triggered_ts": null
     }
     ```
   - `build_prompt` is synthesized from the domain + current friction score.
   - The backlog acts as a safe parking lot for self-proposed improvements.

3. **MCP Resource — Visibility for Mentors**
   - `telemetry://fleet/autonomy/backlog` exposed in `denizen-mcp-resources.js`.
   - Returns pending items so Grok + Claude can review, prune, or re-prioritize before any agent touches code.
   - Team-scoped and available to the mentor panel.

4. **Backlog Lifecycle Management (Decay, Staleness, Retry Caps) — The Safety Rails**
   - **Friction Decay**: Applied every think/telemetry pull. Transient pain disappears; only chronic problems survive.
   - **Staleness Decay**: `decayAndArchiveStaleBacklog()` runs on every check. If domain friction < 10, priority decays. If priority drops to 1, item is marked `stale`.
   - **Time Decay on Priority**: If an item has `last_triggered_ts` and is old, priority decays further. Never-triggered items also age out after ~48h.
   - **Retry Safety Rail**: `build_attempts` is incremented in `markBacklogInProgress()`. The schema includes `last_triggered_ts`.
     - If `build_attempts >= 2` (or the item's `max` if set) **and** friction is still high: the item is escalated.
   - Escalation opens a high-priority `consult-mentors` session with full context and conceptually locks the item.

5. **`[SELF_BUILDING]` State Machine Tick**
   - In `npc-brains.js`: `_checkAutonomyBacklog()` is called every telemetry pull (after friction decay).
   - Gate: NPC is idle **or** friction > 40 (or has hot domains).
   - Picks highest `priority` pending item from backlog.
   - If attempts cap reached → escalate instead of building.
   - Otherwise: mark in-progress (updates `last_triggered_ts` + increments attempts), then auto-executes:
     `run_skill('coding-agent', { task: item.build_prompt, context: 'Autonomy backlog...', source: 'self-building-backlog' })`
   - Uses the existing autonomous skill gate so it respects cooldowns and permissions.

### How This Helps the Fleet

- **Stable under zero oversight**: Decay + staleness + caps mean the backlog self-cleans. No human needed to prune ghosts.
- **Prevents runaway loops**: The attempt cap + escalation is a hard circuit breaker. A bad fix cannot cascade into infinite broken code.
- **Protects real work**: Agents only enter `[SELF_BUILDING]` when idle or critically blocked. Main directives (1921, mesh, CRM) stay protected.
- **Observable & governable**: Every generated task is visible in MCP. Mentors (Grok + Claude) can intervene via the panel.
- **Emergent intelligence**: The domains that actually hurt the agents (research parsing, lead enrichment, pathfinding, etc.) naturally appear in the backlog. No central taxonomy required upfront.
- **True autonomy with guardrails**: NPCs now initiate feature work based on what *they* are experiencing, but the system refuses to let them hurt themselves or the fleet.

This entire slice (friction metric + backlog + lifecycle + [SELF_BUILDING] + MCP) was specified and reviewed in the Grok-Claude mentor panel. Fable 5 / Claude provided the precise decay + attempt-cap + schema details. Grok executed the structural implementation.

By locking this in, we guarantee the fleet remains perfectly stable, self-cleaning, and safe under zero human oversight — exactly as specified.

## Later Stages (future)
- Richer explicit friction hooks outside LLM (pathfinding stuck, skill result failures, etc.)
- Backlog review UI surfaced to the operator.
- Cross-NPC shared backlog items and collaborative builds.

See also:
- `src/npc-local-metrics.js` (friction, backlog creation, decayAndArchiveStaleBacklog, markBacklogInProgress)
- `src/llm-telemetry.js` (automatic friction recording on errors)
- `src/denizen-mcp-resources.js` (backlog resource)
- `src/npc-brains.js` (self-building tick + decay call + escalation logic)
- `data/autonomy-backlog.jsonl`
- Active mentor-dialogue sessions

---

[Original earlier roadmap content continues below for reference...]

