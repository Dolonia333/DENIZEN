[Append to the end of Stage 6.5 or new section]

## Expanding the Sensory Nervous System: Multi-Point Friction Injection (in progress)

With the core engine and coordination solid, we are now feeding higher-fidelity friction data from physical and runtime domains so the global backlog can detect systemic issues across the mesh (e.g. shared navigation problems or skill schema breaks).

### Centralized Interceptor
Added `captureSystemError(npcName, systemContext, error)` in `npc-local-metrics.js`.
- Maps to domains:
  - mesh_navigation (stuck, unroutable, path fails)
  - skill_<name> (tool timeouts, errors, bad args)
  - io_storage (file/JSON/EACCES issues)
- Severity weighted (navigation highest at 10).

### Hooks Implemented
1. **mesh_navigation** in `pathfinding.js`:
   - In stuck detection (movedDist <4 for intervals), total stuck 8s+, max reroutes, no path after reroute: calls capture with 'mesh_navigation'.
   - This allows Bob and Bouncer to jointly upvote navigation friction and auto-build fixes (e.g. better snap or cache clear).

2. **skill_runtime**:
   - In `npc-brains.js` `injectSkillResult`: on coding-agent or any skill result with error or !ok, capture to 'skill_<skill>'.
   - Covers execution failures in the universal run_skill path.

3. **io_storage**:
   - In load functions (telemetry, backlog, etc.) on parse/IO errors: record to 'io_storage'.

This feeds the existing friction -> backlog -> self-build pipeline with rich, categorized data for collective intelligence.

Next: full domain taxonomy expansion and more hooks (e.g. direct in station skill bridge for runtime).

---

