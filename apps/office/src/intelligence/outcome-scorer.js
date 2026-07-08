'use strict';

/**
 * Score NPC work outcomes 0–5 from existing decision signals (Phase 5.1).
 * @see docs/ROADMAP.md §5.1
 */

function normalizeOutcome(outcome) {
  return String(outcome || '').toLowerCase().trim();
}

/**
 * @param {object} decision — think() JSON decision
 * @param {object} [ctx]
 * @param {boolean} [ctx.hadConflict]
 * @param {boolean} [ctx.chainAdvanced]
 * @param {boolean} [ctx.skillError]
 * @returns {{ score: number, label: string, reasons: string[] }}
 */
function scoreDecision(decision = {}, ctx = {}) {
  const reasons = [];
  const outcome = normalizeOutcome(decision.outcome);
  const taskPhase = String(decision.taskPhase || '').toLowerCase();

  if (ctx.skillError) {
    return { score: 0, label: 'failed', reasons: ['skill_exec_error'] };
  }

  if (ctx.hadConflict) {
    return { score: 1, label: 'conflict', reasons: ['contradictory_artifact'] };
  }

  if (outcome === 'stuck' || outcome === 'blocked') {
    return { score: 2, label: 'abandoned', reasons: [`outcome_${outcome}`] };
  }

  if (taskPhase !== 'finished' && outcome !== 'success') {
    return { score: 3, label: 'partial', reasons: ['incomplete_or_unclear'] };
  }

  if (ctx.chainAdvanced && (outcome === 'success' || taskPhase === 'finished')) {
    reasons.push('chain_advanced');
    return { score: 5, label: 'excellent', reasons };
  }

  if (outcome === 'success' || taskPhase === 'finished') {
    reasons.push(decision.save ? 'artifact_saved' : 'finished_clean');
    return { score: 4, label: 'good', reasons };
  }

  return { score: 3, label: 'partial', reasons: ['default'] };
}

module.exports = {
  scoreDecision,
  normalizeOutcome,
};
