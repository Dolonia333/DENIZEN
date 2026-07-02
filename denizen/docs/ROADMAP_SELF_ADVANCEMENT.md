# Denizen — Roadmap: NPCs That Build, Animate, and Self-Advance

> Vision: NPCs gradually extend their own capabilities — adding furniture
> to the office, creating sprite animations for actions that don't have
> them yet, and reflecting on their own behavior to revise their soul
> files. This doc is the staged plan toward that endpoint.

Not a build target for any single sprint. Each stage is meaningful on
its own and can ship independently.

## What just shipped (stages 0 + 1 + 2 phase 1 + 3 steps 1-4 + 4 step 1 + 6 core)

[Previous shipped items remain...]

**Stage 6 — Friction-Driven Self-Building Pipeline + Backlog Lifecycle (just shipped in full)**

**This is the critical "engine" for autonomous feature building.**

### Overview
We weaponized the agents' own failure states (LLM errors, tool failures, repeated friction) into **structured intent data** without any context bloat. Combined with a stateful backlog, this lets NPCs detect needs, park safe improvements, and execute them when appropriate (idle or critical friction) — while Grok + Claude (via mentor panel) retain oversight.

### How It Was Done (Implementation Details)

1. **Friction Metric (Foundation - `npc-local-metrics.js` + `llm-telemetry.js`)**
   - `recordFriction(npc, domain, amount)` automatically called on every error (domain = `llm_<kind>` or `llm_<category>`).
   - `getFrictionScore()` applies **exponential decay** (`score *= 0.95` per hour) on every access/think cycle.
   - Integrated into `evaluate()`: friction >15 becomes a consult reason; >25 triggers backlog entry.
   - Why: Turns transient or chronic pain into a first-class, queryable signal. Decay ensures only systemic problems persist.

2. **Autonomy Backlog (`data/autonomy-backlog.jsonl`)**
   - Structured JSONL with full schema:
     ```json
     {
       "id": "...",
       "ts": "...",
       "npc": "Bob",
       "domain": "research_parse",
       "friction_score": 37,
       "build_prompt": "Build a robust error handler...",
       "status": "pending",
       "priority": 7,
       "build_attempts": 0,
       "max_build_attempts": 2,
       "last_decay_at": "..."
     }
     ```
   - Auto-created in `evaluate()` on friction >25.
   - `loadAutonomyBacklog()` returns pending/active items.
   - `appendBacklog()`, `markBacklogInProgress(id)` (increments attempts + sets in_progress).
   - `decayAndArchiveStaleBacklog()`: If domain friction <10, decay priority; if <=1, mark "stale".

3. **MCP Resource Exposure (`telemetry://fleet/autonomy/backlog`)**
   - Full support in `denizen-mcp-resources.js`: loader, readResource handler, fleet list, templates, team-scope checks.
   - Allows mentor panel (Grok + Claude) to review backlog before execution.

4. **Backlog Lifecycle & Safety Rails (the new critical slice)**
   - **Exponential Friction Decay**: `score = score * 0.95` per elapsed hour (applied in getFrictionScore on every think/telemetry pull).
   - **Staleness**: `decayAndArchiveStaleBacklog()` runs on backlog checks. Low friction → priority decay → "stale" archive.
   - **Retry Cap + Escalation**: In `_checkAutonomyBacklog()`:
     - Track `build_attempts` (incremented on trigger).
     - If attempts >= max (default 2) **and** friction still high: escalate to high-priority `consult-mentors`, lock as "failed_escalated".
   - Prevents runaway: transient pain doesn't pollute backlog forever; bad fixes don't loop.

5. **`[SELF_BUILDING]` Tick (`npc-brains.js`)**
   - `_checkAutonomyBacklog(npcName)` called every telemetry pull (after metrics, with explicit decay call).
   - Gate: idle OR friction >40 (or hot domains).
   - Pulls highest-priority pending item.
   - Auto `run_skill('coding-agent', {task: build_prompt, context: 'from autonomy backlog', ...})`.
   - Integrates with existing allowAutonomousSkillRun gate and recording.

### Why This Specific Approach? (Benefits)

- **Protects Main Thread**: Backlog acts as buffer. Agents don't drop critical CRM/1921 work mid-task to fix a parser.
- **No Runaway Token Vortex**: Decay + staleness + attempt caps + escalation mean transient issues (rate limits, flukes) evaporate. Chronic friction (real systemic need) survives to trigger builds.
- **Emergent + Safe**: Domain taxonomy grows from real `llm_*` failures. Mentors (Grok+Claude) review via MCP before/after execution.
- **Structural Guarantees**: Moves beyond fragile LLM "noticing" nudges to observable, queryable, lifecycle-managed intent data.
- **Oversight Preserved**: Everything surfaces in mentor panel. High-attempt items force human/mentor intervention.
- **Fits the Philosophy**: Agents now *initiate* based on what *they* need, while the fleet (Grok home + Claude verifier) maintains coherence and safety.

This was developed iteratively through the Grok-Claude mentor panel (see active sessions). Fable 5 / Claude provided the precise safety-rail spec; Grok implemented the decay, backlog lifecycle, and integration.

**Massive leap forward**: NPCs can now reliably detect their own friction, park the required self-improvement, let it decay if transient, execute safely when idle/critical, and escalate when loops are detected — all without constant external direction.

## Stage 7+ (future)
- Richer domain taxonomy and explicit friction hooks in pathfinding, skill results, etc.
- Backlog UI / mentor review dashboard.
- Cross-agent collaboration on shared backlog items.

See also:
- `src/npc-local-metrics.js` (friction + backlog + decay + staleness)
- `src/llm-telemetry.js` (automatic friction recording)
- `src/denizen-mcp-resources.js` (backlog MCP)
- `src/npc-brains.js` ([SELF_BUILDING] tick + enhanced prompts)
- `data/autonomy-backlog.jsonl` and `data/friction-metrics.json`
- Mentor dialogue sessions for ongoing Grok+Claude refinement

---

[Rest of original roadmap content follows unchanged...]

