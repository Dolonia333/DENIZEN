[Previous content...]

## Chronos & Cognitive Context Friction Hooks (final sensory taxonomy)

Added `cognitive_context` and `chronos_stagnation` domains via captureSystemError.

- cognitive_context: in _build... and token estimation in npc-brains.js, if estimated tokens >3200 or high context, captureSystemError(npcName, 'cognitive_context', {code: 'CONTEXT_OVERFLOW'}).
- chronos_stagnation: added _checkChronosStagnation using recent decision hashes from _lastDecisions / rt.lastDecisions. Detects 3x identical sig without 'finished' progress, triggers capture.

These feed the friction -> backlog -> self-build pipeline. High scores will now appear on dashboard and trigger autonomous fixes for memory bloat or decision loops (e.g. better pruning, strategy reset).

See updates in npc-brains.js (token check, _checkChronosStagnation, decision recording) and captureSystemError in npc-local-metrics.js.

This finalizes the full taxonomy: navigation, skills, io, host, cognitive, chronos.

---

