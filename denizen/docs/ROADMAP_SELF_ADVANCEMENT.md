[Keep previous content. Append this new subsection under Stage 6.5 or as 6.6.]

## Lock Settlement & Resolution Lifecycle (Orphaned Lock Safeguard - just shipped)

**Critical fix for the "Orphaned Lock" problem that could permanently deadlock domains.**

### The Edge Case
An `in_progress` lock acquired via `acquired_by` could be left forever if the `coding-agent`:
- Fails silently
- Crashes
- Times out
- Completes without cleanup

Result: domain locked forever, other agents always yield, no more fixes attempted.

### Implementation

1. **Skill Completion Hook** (in `npc-brains.js` `injectSkillResult` + `npc-local-metrics.js` `settleBacklogLock`):
   - When coding-agent result arrives for a backlog_id:
     - **Success**: status = "resolved", clear `acquired_by`, **zero friction_score for all `impacted_npcs`** (the shared problem is fixed).
     - **Failure**: increment `build_attempts`. If >= max (2), set "failed_escalated" and trigger high-priority `consult-mentors`. Else set "pending", clear `acquired_by` so it can be retried.

2. **Mutex Lease Timeout** (`expireOrphanedLocks`):
   - Called on every backlog check and think telemetry pull.
   - If `status === "in_progress"` and `now - last_triggered_ts > 15 minutes`: treat as expired.
   - Auto: status = "pending", clear `acquired_by`, add note "[auto-expired orphan lock]".
   - The next agent that checks will reclaim it.

3. **Integrated**:
   - `expireOrphanedLocks` called in `_checkAutonomyBacklog` before filtering.
   - Settlement called automatically when skill result for coding-agent with backlog context arrives.
   - Also exposed settlement functions for future explicit completion paths in coding-task-runner.

### Why This Completes the Pipeline
- No more permanent deadlocks.
- Clean resolution on success (friction reset for everyone affected).
- Proper retry accounting on failure with escalation.
- Time-based lease as ultimate safety (agents can die, network can fail).
- Keeps the "zero human oversight" promise: the mesh self-heals its coordination state.

This was the urgent priority to make the mutex "un-stuckable" before expanding domains.

See:
- `settleBacklogLock`, `expireOrphanedLocks` in npc-local-metrics.js
- Settlement hook in injectSkillResult
- Calls in _checkAutonomyBacklog

---

