// === SERVER.JS WIRING NEEDED (add after Phase 3.1 merge) ===
// const taskChain = require('./src/task-chain');
// const conflictDetector = require('./src/conflict-detector');
// npcBrains.setBroadcast((msg) => broadcastToAll(JSON.stringify(msg)));
//
// POST /api/task-chains — start a chain
// app.post('/api/task-chains', (req, res) => {
//   const chain = taskChain.startChain(req.body, npcBrains.assignDirective.bind(npcBrains), broadcastFn);
//   res.json({ ok: true, chainId: chain.id });
// });
//
// GET /api/task-chains — list active chains
// app.get('/api/task-chains', (req, res) => {
//   res.json({ chains: taskChain.getActiveChains() });
// });
// ============================================================

/**
 * TaskChainRunner — orchestrates multi-step NPC task chains via the
 * directive inbox. Each step in the chain is assigned as a directive
 * to the target NPC; when that NPC sets taskPhase:"finished", the chain
 * automatically advances to the next step with previous artifacts as context.
 */
class TaskChainRunner {
  constructor() {
    this._chains = new Map();         // chainId → chain state
    this._npcActiveChain = new Map(); // npcName → { chainId, stepIndex }
  }

  /**
   * Start a new task chain.
   *
   * @param {object} definition - Chain definition object (see format below)
   * @param {Function} assignDirectiveFn - npcBrains.assignDirective(to, from, task, urgent)
   * @param {Function} broadcastFn - function(msgObject) to broadcast WS messages
   * @returns {object} The chain object
   *
   * Definition format:
   * {
   *   id: 'chain-abc123',           // optional; auto-generated if omitted
   *   name: 'Fix speech bubble overflow',
   *   triggeredBy: 'Abby',
   *   steps: [
   *     { npc: 'Sarah', task: '...', artifactCategory: 'product' },
   *     ...
   *   ],
   * }
   */
  startChain(definition, assignDirectiveFn, broadcastFn) {
    const id = definition.id || `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const steps = Array.isArray(definition.steps) ? definition.steps : [];

    if (steps.length === 0) {
      throw new Error('[TaskChain] startChain: definition.steps must have at least one step');
    }

    const chain = {
      id,
      name: definition.name || 'Unnamed chain',
      triggeredBy: definition.triggeredBy || 'System',
      steps,
      currentStep: 0,
      status: 'running',
      artifacts: [],
      createdAt: Date.now(),
    };

    this._chains.set(id, chain);
    this._npcActiveChain.set(steps[0].npc, { chainId: id, stepIndex: 0 });

    const taskWithContext = `${steps[0].task}\n\nYou are step 1 of ${steps.length} in task chain '${chain.name}'. This is the first step.`;
    assignDirectiveFn(steps[0].npc, chain.triggeredBy, taskWithContext, false);

    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: 'npc_chain_started',
        chainId: id,
        name: chain.name,
        steps: steps.map(s => s.npc),
        totalSteps: steps.length,
      });
    }

    console.log(`[TaskChain] Started "${chain.name}" (${id}) — ${steps.length} steps: ${steps.map(s => s.npc).join(' → ')}`);
    return chain;
  }

  /**
   * Called when an NPC finishes their task (taskPhase === 'finished').
   * Advances the chain to the next step, or marks it complete.
   *
   * @param {string} npcName - The NPC that just finished
   * @param {string} artifactPath - Path to the artifact they produced
   * @param {Function} assignDirectiveFn - npcBrains.assignDirective
   * @param {Function} broadcastFn - WS broadcast function
   */
  onStepComplete(npcName, artifactPath, assignDirectiveFn, broadcastFn) {
    const entry = this._npcActiveChain.get(npcName);
    if (!entry) return; // NPC was not in a chain

    const { chainId, stepIndex } = entry;
    const chain = this._chains.get(chainId);
    if (!chain) return;

    const currentStep = stepIndex;
    const totalSteps = chain.steps.length;

    // Record artifact
    chain.artifacts.push({
      step: currentStep,
      npc: npcName,
      artifactPath: artifactPath || `reports/unknown/${npcName}_${Date.now()}.md`,
      ts: Date.now(),
    });

    if (typeof broadcastFn === 'function') {
      broadcastFn({
        type: 'npc_chain_step_done',
        chainId,
        step: currentStep,
        npc: npcName,
        artifactPath,
        remaining: totalSteps - currentStep - 1,
      });
    }

    // Advance
    chain.currentStep++;
    this._npcActiveChain.delete(npcName);

    // Chain complete?
    if (chain.currentStep >= totalSteps) {
      chain.status = 'complete';
      if (typeof broadcastFn === 'function') {
        broadcastFn({
          type: 'npc_chain_complete',
          chainId,
          name: chain.name,
          artifacts: chain.artifacts,
        });
      }
      console.log(`[TaskChain] Complete: "${chain.name}" (${chainId}) — ${chain.artifacts.length} artifacts`);
      return;
    }

    // Assign next step
    const nextStepIndex = chain.currentStep;
    const nextStep = chain.steps[nextStepIndex];

    const prevArtifactLines = chain.artifacts
      .map(a => `- Step ${a.step + 1} (${a.npc}): ${a.artifactPath}`)
      .join('\n');

    const taskWithContext = `${nextStep.task}

Context from previous steps:
${prevArtifactLines}

You are step ${nextStepIndex + 1} of ${totalSteps} in task chain '${chain.name}'.`;

    this._npcActiveChain.set(nextStep.npc, { chainId, stepIndex: nextStepIndex });
    assignDirectiveFn(nextStep.npc, chain.triggeredBy, taskWithContext, false);

    console.log(`[TaskChain] Advancing "${chain.name}" → step ${nextStepIndex + 1}/${totalSteps}: ${nextStep.npc}`);
  }

  /**
   * Get the full chain object by ID, or null.
   */
  getChainStatus(chainId) {
    return this._chains.get(chainId) || null;
  }

  /**
   * Get the active chain info for an NPC, or null.
   * @returns {{ chain: object, stepIndex: number } | null}
   */
  getChainForNpc(npcName) {
    const entry = this._npcActiveChain.get(npcName);
    if (!entry) return null;
    const chain = this._chains.get(entry.chainId);
    if (!chain) return null;
    return { chain, stepIndex: entry.stepIndex };
  }

  /**
   * Returns all chains with status 'running'.
   */
  getActiveChains() {
    const result = [];
    for (const chain of this._chains.values()) {
      if (chain.status === 'running') result.push(chain);
    }
    return result;
  }
}

module.exports = new TaskChainRunner();
