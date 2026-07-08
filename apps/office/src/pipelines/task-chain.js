'use strict';

const { evaluateGate } = require('./content-gate');

/**
 * TaskChainRunner — multi-step NPC chains with optional content gates.
 */
class TaskChainRunner {
  constructor() {
    this._chains = new Map();
    this._npcActiveChain = new Map();
  }

  startChain(definition, assignDirectiveFn, broadcastFn) {
    const id = definition.id || `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    if (steps.length === 0) {
      throw new Error('[TaskChain] startChain: definition.steps must have at least one step');
    }

    const chain = {
      id,
      kind: definition.kind || 'generic',
      name: definition.name || 'Unnamed chain',
      triggeredBy: definition.triggeredBy || 'System',
      topic: definition.topic || null,
      audience: definition.audience || null,
      maxRevisions: Number(definition.maxRevisions) || 3,
      steps,
      currentStep: 0,
      status: 'running',
      artifacts: [],
      revisionCount: 0,
      createdAt: Date.now(),
    };

    this._chains.set(id, chain);
    this._assignStep(chain, 0, assignDirectiveFn, broadcastFn, { isFirst: true });

    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: 'npc_chain_started',
        chainId: id,
        kind: chain.kind,
        name: chain.name,
        steps: steps.map((s) => s.npc),
        totalSteps: steps.length,
      });
    }

    console.log(`[TaskChain] Started "${chain.name}" (${id}) — ${steps.length} steps: ${steps.map((s) => s.npc).join(' → ')}`);
    return chain;
  }

  _stepIndexById(chain, stepId) {
    return chain.steps.findIndex((s) => s.id === stepId);
  }

  _assignStep(chain, stepIndex, assignDirectiveFn, broadcastFn, opts = {}) {
    const step = chain.steps[stepIndex];
    if (!step) return;

    chain.currentStep = stepIndex;
    this._npcActiveChain.set(step.npc, { chainId: chain.id, stepIndex });

    const prevArtifactLines = chain.artifacts
      .map((a) => `- Step ${a.step + 1} (${a.npc}${a.stepId ? `/${a.stepId}` : ''}): ${a.artifactPath}${a.verdict ? ` [${a.verdict}]` : ''}`)
      .join('\n');

    const lines = [
      step.task,
      '',
      prevArtifactLines ? `Context from previous steps:\n${prevArtifactLines}` : '',
      `You are step ${stepIndex + 1} of ${chain.steps.length} in task chain '${chain.name}'.`,
    ];
    if (opts.isFirst) lines.push('This is the first step.');
    if (step.gate === 'pitch') {
      lines.push('Gatekeeper: end your artifact with VERDICT: APPROVED or VERDICT: REJECTED.');
    }
    if (step.gate === 'copy') {
      lines.push('Copy gate: end with VERDICT: PASSED or VERDICT: REVISE (list required edits).');
    }
    if (step.gate === 'brand') {
      lines.push('Brand safety: end with VERDICT: CLEAR or VERDICT: BLOCKED.');
    }
    if (step.skill) {
      lines.push(`Preferred skill for this step: ${step.skill}`);
    }

    assignDirectiveFn(step.npc, chain.triggeredBy, lines.filter(Boolean).join('\n'), false);

    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: 'npc_chain_step_assigned',
        chainId: chain.id,
        step: stepIndex,
        stepId: step.id || null,
        npc: step.npc,
      });
    }
  }

  _finishChain(chain, status, broadcastFn, extra = {}) {
    chain.status = status;
    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: status === 'complete' ? 'npc_chain_complete' : 'npc_chain_halted',
        chainId: chain.id,
        name: chain.name,
        status,
        artifacts: chain.artifacts,
        ...extra,
      });
    }
    for (const [npc, entry] of this._npcActiveChain.entries()) {
      if (entry.chainId === chain.id) this._npcActiveChain.delete(npc);
    }
    console.log(`[TaskChain] ${status}: "${chain.name}" (${chain.id})`);
  }

  onStepComplete(npcName, artifactPath, ctx, assignDirectiveFn, broadcastFn) {
    const entry = this._npcActiveChain.get(npcName);
    if (!entry) return;

    const { chainId, stepIndex } = entry;
    const chain = this._chains.get(chainId);
    if (!chain || chain.status !== 'running') return;

    const step = chain.steps[stepIndex];
    const gateCtx = {
      artifactPath: artifactPath || ctx?.artifactPath,
      outcome: ctx?.outcome,
      save: ctx?.save,
    };

    let verdict = null;
    let gateAction = 'advance';

    if (step?.gate) {
      const result = evaluateGate(step.gate, gateCtx);
      verdict = result.verdict;
      gateAction = result.action;
    }

    chain.artifacts.push({
      step: stepIndex,
      stepId: step?.id || null,
      npc: npcName,
      artifactPath: artifactPath || `reports/unknown/${npcName}_${Date.now()}.md`,
      verdict,
      ts: Date.now(),
    });

    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: 'npc_chain_step_done',
        chainId,
        step: stepIndex,
        stepId: step?.id || null,
        npc: npcName,
        artifactPath,
        verdict,
        gateAction,
        remaining: chain.steps.length - stepIndex - 1,
      });
    }

    this._npcActiveChain.delete(npcName);

    if (gateAction === 'reject') {
      this._finishChain(chain, 'rejected', broadcastFn, { verdict, npc: npcName, step: stepIndex });
      return;
    }

    if (gateAction === 'block') {
      try {
        const ws = require('../world-state');
        ws.pushThreat({
          category: 'brand_safety',
          severity: 'high',
          detail: `Content pipeline blocked at ${step?.id || npcName}: ${verdict}`,
          source: 'content-pipeline',
          target: chain.topic || chain.name,
        });
      } catch (_) {}
      this._finishChain(chain, 'blocked', broadcastFn, { verdict, npc: npcName, step: stepIndex });
      return;
    }

    if (gateAction === 'revise') {
      chain.revisionCount = (chain.revisionCount || 0) + 1;
      if (chain.revisionCount > chain.maxRevisions) {
        this._finishChain(chain, 'stuck', broadcastFn, {
          reason: 'max_revisions_exceeded',
          revisionCount: chain.revisionCount,
        });
        return;
      }
      const gotoId = step.reviseGoto || 'draft-article';
      const gotoIndex = this._stepIndexById(chain, gotoId);
      const targetIndex = gotoIndex >= 0 ? gotoIndex : Math.max(0, stepIndex - 1);
      if (typeof broadcastFn === 'function') {
        broadcastFn({
          type: 'npc_chain_revision',
          chainId,
          fromStep: stepIndex,
          toStep: targetIndex,
          revision: chain.revisionCount,
        });
      }
      this._assignStep(chain, targetIndex, assignDirectiveFn, broadcastFn, {
        revision: chain.revisionCount,
      });
      return;
    }

    const nextIndex = stepIndex + 1;
    if (nextIndex >= chain.steps.length) {
      this._finishChain(chain, 'complete', broadcastFn);
      return;
    }

    this._assignStep(chain, nextIndex, assignDirectiveFn, broadcastFn);
    console.log(`[TaskChain] Advancing "${chain.name}" → step ${nextIndex + 1}/${chain.steps.length}: ${chain.steps[nextIndex].npc}`);
  }

  getChainStatus(chainId) {
    return this._chains.get(chainId) || null;
  }

  getChainForNpc(npcName) {
    const entry = this._npcActiveChain.get(npcName);
    if (!entry) return null;
    const chain = this._chains.get(entry.chainId);
    if (!chain) return null;
    const step = chain.steps[entry.stepIndex];
    return { chain, stepIndex: entry.stepIndex, step };
  }

  getActiveChains() {
    const result = [];
    for (const chain of this._chains.values()) {
      if (chain.status === 'running') result.push(chain);
    }
    return result;
  }

  getAllChains() {
    return [...this._chains.values()];
  }

  cancelChain(chainId, broadcastFn, reason = 'user_cancelled') {
    const chain = this._chains.get(chainId);
    if (!chain) return null;
    if (chain.status !== 'running') return chain;
    this._finishChain(chain, 'cancelled', broadcastFn, { reason });
    return chain;
  }

  cancelAllRunning(broadcastFn, filterFn = null) {
    const cancelled = [];
    for (const chain of this._chains.values()) {
      if (chain.status !== 'running') continue;
      if (filterFn && !filterFn(chain)) continue;
      this.cancelChain(chain.id, broadcastFn, 'user_cancelled');
      cancelled.push(chain.id);
    }
    return cancelled;
  }
}

const runner = new TaskChainRunner();
module.exports = runner;
module.exports.TaskChainRunner = TaskChainRunner;
