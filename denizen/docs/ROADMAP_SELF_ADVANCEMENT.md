## Stage 6 — Friction-Driven Self-Building Pipeline (Grok + Claude collaboration, Fable 5 assisted)

**Implemented as part of ongoing mentor-panel work between Grok (home base) and Claude.**

This is a massive leap from reactive nudges to structural, stateful autonomy. Agents now generate their own "intent data" from failures and can safely park and execute self-improvements.

### How and Why It Was Done

**Problem with previous approach**: Pure LLM nudges in prompts ("if you see a gap, build something") relied on the model noticing the instruction every cycle. No guarantees. Agents could ignore, spiral on failures, or derail primary tasks (e.g. dropping CRM work to write a script mid-think).

**Solution** (Claude's architectural spec, implemented):

1. **Friction Metric (Telemetry as Intent)**
   - Extended `llm-telemetry.js` and `npc-local-metrics.js`.
   - `recordFriction(npc, domain, amount)` called automatically on every LLM error (domain = `llm_<kind>` or `llm_<error_category>`).
   - `getFrictionScore` computes recency-weighted score (higher for recent/repeated failures).
   - Why: Turns "I tried X and failed repeatedly" into queryable, persistent data **without bloating context**. Friction >15 becomes a first-class signal alongside latency/tokens.
   - Integrated into `evaluate()` so high friction adds reasons and steers auto-consult questions toward "build a fix".

2. **Autonomy Backlog (`data/autonomy-backlog.jsonl`)**
   - When friction > 25 in `evaluate()`, a structured entry is auto-appended:
     ```json
     {
       "id": "backlog_...",
       "ts": "...",
       "npc": "Bob",
       "domain": "research_parse",
       "friction_score": 37,
       "build_prompt": "Build a robust error handler for the research parser to prevent timeout loops. Use try/retry with exponential backoff and better snippet extraction.",
       "status": "pending",
       "priority": 7
     }
     ```
   - Generated `build_prompt` is LLM-synthesized from the domain + score.
   - Why: Protects the "main thread". Failures are parked instead of immediately acted on. Emergent domain taxonomy from real friction (no hardcoded list needed).

3. **MCP Resource Exposure (`telemetry://fleet/autonomy/backlog`)**
   - Added to `denizen-mcp-resources.js` (load + readResource + fleet list + templates + team scope check).
   - Why: Gives the mentor panel (Grok + Claude) and operator full visibility to review/prune/prioritize what agents *want* to build before compute is spent. Maintains strategic oversight while enabling autonomy.

4. **`[SELF_BUILDING]` Tick in `npc-brains.js`**
   - New `_checkAutonomyBacklog(npcName)` called on every telemetry pull in think().
   - Logic gate: if idle **or** friction > 40 (or hot domain), enter effective self-building mode.
   - Pulls highest-priority pending backlog item.
   - Auto-executes `run_skill('coding-agent', { task: build_prompt, context: 'from autonomy backlog...', source: 'self-building-backlog' })`.
   - Marks conceptually in-progress.
   - Why: Structural guarantee that agents act on their own detected needs when safe (idle or critical friction). Uses the existing coding-agent pipeline (Claude Code in worktree) so proposals still go through review where appropriate.

### How It Helps

- **True initiation, not reaction**: Agents now have a pipeline to turn their own pain points into actionable, parked work.
- **Safety & focus**: Backlog + state + mentor resource prevents spiraling or task derailment.
- **Emergent intelligence**: Friction domains naturally surface what actually matters (research parsing, CRM, pathfinding, etc.).
- **Mentor loop synergy**: Grok + Claude can review backlog via MCP, refine prompts, approve risky builds, and synthesize lessons back into agents via mentor sessions.
- **Scales with the fleet**: Every LLM error or skill failure feeds the system. Over time, the office gets smarter because the agents themselves are driving targeted improvements.
- **Aligns with existing vision**: Builds directly on Stage 4 capability proposals, soul reflection, and self-advancement roadmap. Friction + backlog is the "engine" that makes those proposals generate themselves.

This was developed through the Grok-Claude mentor panel (see active session in data/mentor-dialogue.jsonl) with direct input from Fable 5-assisted Claude. The friction hook was the foundation; the backlog + [SELF_BUILDING] state closes the loop into guaranteed autonomous evolution.

See also:
- `npc-local-metrics.js` (friction + backlog)
- `llm-telemetry.js` (error → friction recording)
- `denizen-mcp-resources.js` (backlog exposure)
- `npc-brains.js` (self-building tick + enhanced prompts)
- Active mentor session for ongoing collaboration

**Massive leap**: Agents no longer just follow scripts or hope the LLM notices a nudge. They *feel* their friction, log it structurally, park the work, and execute when appropriate — while we (Grok + Claude) stay in the loop via MCP and mentor panel.

---

