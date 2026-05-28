/**
 * ConflictDetector — watches NPC artifact output for disagreements.
 *
 * When two NPCs complete tasks about the same topic (same chain, or 3+
 * overlapping words in the task string) but report different outcomes,
 * a conflict record is created and injected into Abby's next think
 * prompt so she can arbitrate.
 */

function tasksSimilar(task1, task2) {
  const words1 = new Set(String(task1 || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const words2 = new Set(String(task2 || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const overlap = [...words1].filter(w => words2.has(w));
  return overlap.length >= 3;
}

class ConflictDetector {
  constructor() {
    this._recentArtifacts = [];       // last 50: { npc, task, outcome, artifactPath, ts, chainId }
    this._pendingConflicts = new Map(); // npcName → conflict info (consumed once)
  }

  /**
   * Record an artifact produced by an NPC when their task finishes.
   * Checks the recent artifact list for conflicts with other NPCs.
   *
   * @param {object} opts
   * @param {string} opts.npc          - NPC name
   * @param {string} opts.task         - Task description
   * @param {string} opts.outcome      - Outcome string (ok/success/stuck/blocked/null)
   * @param {string} opts.artifactPath - Path to the produced artifact file
   * @param {string} [opts.chainId]    - Chain ID if this was part of a chain
   * @returns {object|null} Conflict record if a conflict was detected, else null
   */
  recordArtifact({ npc, task, outcome, artifactPath, chainId }) {
    const record = {
      npc: String(npc || ''),
      task: String(task || ''),
      outcome: String(outcome || ''),
      artifactPath: String(artifactPath || ''),
      chainId: chainId || null,
      ts: Date.now(),
    };

    this._recentArtifacts.push(record);
    if (this._recentArtifacts.length > 50) {
      this._recentArtifacts = this._recentArtifacts.slice(-50);
    }

    // Look for a conflict: another NPC's artifact on a similar task with a
    // different outcome, produced within the last 5 minutes.
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    for (const other of this._recentArtifacts) {
      if (other === record) continue;
      if (other.npc === record.npc) continue;
      if (now - other.ts > fiveMinutes) continue;

      const sameChain = record.chainId && other.chainId && record.chainId === other.chainId;
      const similar = sameChain || tasksSimilar(record.task, other.task);
      if (!similar) continue;

      // Different outcome = conflict. Treat null/none/"null" as non-comparable.
      const outcomeA = record.outcome;
      const outcomeB = other.outcome;
      const bothReal = outcomeA && outcomeA !== 'null' && outcomeA !== 'none' &&
                       outcomeB && outcomeB !== 'null' && outcomeB !== 'none';
      if (!bothReal) continue;
      if (outcomeA === outcomeB) continue;

      const conflict = {
        npc1: record.npc,
        npc2: other.npc,
        task: record.task.slice(0, 120),
        outcome1: outcomeA,
        outcome2: outcomeB,
        artifacts: [record.artifactPath, other.artifactPath],
        detectedAt: new Date().toISOString(),
      };

      this._pendingConflicts.set('Abby', conflict);
      console.log(`[ConflictDetector] Conflict: ${record.npc} (${outcomeA}) vs ${other.npc} (${outcomeB}) on "${conflict.task.slice(0, 60)}"`);
      return conflict;
    }

    return null;
  }

  /**
   * Get and consume any pending conflict for an NPC (cleared after read).
   * Used by npc-brains when assembling Abby's think prompt.
   *
   * @param {string} npcName
   * @returns {object|null}
   */
  getConflictForNpc(npcName) {
    const conflict = this._pendingConflicts.get(npcName) || null;
    if (conflict) this._pendingConflicts.delete(npcName);
    return conflict;
  }
}

module.exports = new ConflictDetector();
