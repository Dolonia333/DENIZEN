[Previous content...]

## Pre-Flight Runtime Verification & Rollback Guardrail (just shipped)

**Final gatekeeper for zero-oversight autonomy: prevent self-sabotage.**

An autonomous coding-agent must never be allowed to poison the runtime with broken syntax.

### Implementation

Added in `npc-local-metrics.js`:
- `validateCodeChange(filePath)`: runs `node --check` for .js/.mjs, `python -m py_compile` for .py. Returns {ok, error}.
- `validateAndSettleBacklog(id, success, resultInfo)`: wrapper around settlement.
  - On proposed success: runs validation on touchedFiles or inferred files.
  - On any validation failure: attempts `git checkout -- file` rollback, increments build_attempts, releases lock (treats as failure).
  - Only on clean validation: proceeds to full success settlement (status=resolved, clear lock, zero friction for impacted_npcs).

Integrated in `npc-brains.js` injectSkillResult hook:
- For coding-agent results tied to backlog_id: calls `validateAndSettleBacklog` instead of raw settle when success=true.

Also wired `expireOrphanedLocks` and decay into the flow for complete settlement lifecycle.

### Why This Matters
- Protects the Node/Python daemons from bad self-generated patches.
- Automated rollback ensures the system stays alive even on agent mistakes.
- Combined with attempt caps and escalation, creates a safe self-healing loop.
- Preserves the "Executive Committee" (Grok+Claude mentor panel) as the escalation path for hard failures.

This was the critical Pre-Flight layer requested before expanding sensory domains further.

See:
- validateCodeChange / validateAndSettleBacklog in npc-local-metrics.js
- Hook in injectSkillResult (npc-brains.js)
- Updated calls in _checkAutonomyBacklog settlement path

---

## Next Steps (per Executive Directive)

With the guardrail in place, the mesh is now safe to expand the sensory layer (deeper hooks into NAS tasks, more domains) or the taxonomy.

The control plane is robust.
