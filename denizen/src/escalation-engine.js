'use strict';

// How many consecutive blocked cycles before we escalate up the chain.
const ESCALATION_THRESHOLD = 2;

// How long after escalating before the same blocker can re-escalate (ms).
// Prevents spam if the manager is also slow to respond.
const RE_ESCALATE_COOLDOWN = 5 * 60 * 1000;

class EscalationEngine {
  constructor() {
    // npcName → { task, normTask, waitingFor, cycles, firstAt, escalatedTo, escalatedAt }
    this._blockers = new Map();
  }

  /**
   * Record that an NPC is blocked on a task.
   * Same task+waitingFor → increments cycles. Different task → resets.
   */
  recordBlock(npcName, task, waitingFor) {
    const normTask = String(task).toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    const normWait = waitingFor ? String(waitingFor).toLowerCase().trim() : null;

    const existing = this._blockers.get(npcName);
    if (existing && existing.normTask === normTask && existing.normWait === normWait) {
      existing.cycles++;
    } else {
      this._blockers.set(npcName, {
        task,
        normTask,
        waitingFor: waitingFor || null,
        normWait,
        cycles: 1,
        firstAt: Date.now(),
        escalatedTo: null,
        escalatedAt: null,
      });
    }
  }

  /** Returns true when this NPC should fire an escalation. */
  shouldEscalate(npcName) {
    const b = this._blockers.get(npcName);
    if (!b) return false;
    if (b.cycles < ESCALATION_THRESHOLD) return false;
    // Don't re-escalate within the cooldown window.
    if (b.escalatedAt && (Date.now() - b.escalatedAt) < RE_ESCALATE_COOLDOWN) return false;
    return true;
  }

  /** Mark that escalation has been fired to `to`. */
  markEscalated(npcName, to) {
    const b = this._blockers.get(npcName);
    if (b) {
      b.escalatedTo = to;
      b.escalatedAt = Date.now();
    }
  }

  /** Clear the blocker when the block is resolved. */
  resolveBlock(npcName) {
    this._blockers.delete(npcName);
  }

  getBlocker(npcName) {
    return this._blockers.get(npcName) || null;
  }

  /**
   * Build the escalation message text that gets sent up the chain.
   * Kept factual and brief so the manager can act without context.
   */
  buildEscalationMessage(npcName, blocker) {
    const mins = Math.max(1, Math.round((Date.now() - blocker.firstAt) / 60000));
    const cycles = blocker.cycles;
    const who = blocker.waitingFor ? `waiting on ${blocker.waitingFor}` : 'unresolved';
    return (
      `ESCALATION from ${npcName}: blocked for ${mins} min (${cycles} cycles) — ${who} — ` +
      `task: "${blocker.task}". Cannot proceed without a decision. ` +
      `Please either unblock me directly, or take this to Zion with action:"request_approval".`
    );
  }
}

module.exports = EscalationEngine;
