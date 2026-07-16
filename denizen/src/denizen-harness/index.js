'use strict';

/**
 * Denizen Harness — one control plane for every brain, skill, mentor, and mesh call.
 *
 * Architecture:
 *   io (WS/MCP/Discord/Desktop)
 *     → loops (think | chat | director)
 *         → identity + context
 *         → inference (single complete() gate)
 *         → tools (Jelly only)
 *         → learning (skill inject + mentor MEMORY)
 *         → observability
 *
 * Jelly remains the skill runtime. OpenClaw is legacy optional I/O only.
 * npc-brains still owns deep prompt assembly; the harness is the façade.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createInferenceGate } = require('./inference');
const { createToolsFacade } = require('./tools');
const { createLearningFacade } = require('./learning');
const { createIdentityFacade } = require('./identity');
const { createContextFacade } = require('./context');
const { createLoopsFacade } = require('./loops');
const { createObservability } = require('./observability');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'denizen-harness.json');

/** Process-wide active harness (set by createDenizenHarness). */
let _activeHarness = null;

function getActiveHarness() {
  return _activeHarness;
}

function loadHarnessConfig(denizenRoot) {
  const candidates = [
    path.join(denizenRoot || '', 'config', 'denizen-harness.json'),
    DEFAULT_CONFIG_PATH,
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (_) {}
  }
  return {
    meta: { name: 'Denizen Harness', version: '1.0.0' },
    defaults: { tier: 'main', kind: 'chat', max_tokens: 512 },
    loops: {},
    learning: { inject_skill_results: true, inject_mentor_lessons: true },
    openclaw: { gateway_default: false },
  };
}

/**
 * Create the Denizen harness.
 * Call bind() after jelly / runNpcSkill exist if constructing early.
 *
 * @param {object} opts
 * @param {string} [opts.denizenRoot]
 * @param {object} [opts.npcBrains]
 * @param {object} [opts.jelly]
 * @param {function} [opts.runNpcSkill]
 * @param {object} [opts.cofounderAgent]
 * @param {object} [opts.worldState]
 * @param {object} [opts.lmStudioRouter]
 * @param {object} [opts.log]
 * @param {object} [opts.config]
 */
function createDenizenHarness(opts = {}) {
  const denizenRoot = opts.denizenRoot || path.join(__dirname, '..', '..');
  const config = opts.config || loadHarnessConfig(denizenRoot);

  const state = {
    denizenRoot,
    config,
    npcBrains: opts.npcBrains || null,
    jelly: opts.jelly || null,
    runNpcSkill: opts.runNpcSkill || null,
    cofounderAgent: opts.cofounderAgent || null,
    worldState: opts.worldState || null,
    lmStudioRouter: opts.lmStudioRouter || null,
    log: opts.log || console,
  };

  const deps = {
    get config() { return state.config; },
    get denizenRoot() { return state.denizenRoot; },
    getNpcBrains: () => state.npcBrains,
    getJelly: () => state.jelly,
    getRunNpcSkill: () => state.runNpcSkill,
    getCofounder: () => state.cofounderAgent,
    getWorldState: () => state.worldState,
    getLmStudioRouter: () => state.lmStudioRouter,
    get log() { return state.log; },
  };

  const learning = createLearningFacade(deps);
  deps.learning = learning;

  const inference = createInferenceGate(deps);
  deps.inference = inference;

  const tools = createToolsFacade(deps);
  const identity = createIdentityFacade(deps);
  deps.identity = identity;

  const context = createContextFacade(deps);
  deps.context = context;

  const loops = createLoopsFacade(deps);
  const observability = createObservability({
    ...deps,
    inference,
    learning,
  });

  function bind(more = {}) {
    if (more.npcBrains !== undefined) state.npcBrains = more.npcBrains;
    if (more.jelly !== undefined) state.jelly = more.jelly;
    if (more.runNpcSkill !== undefined) state.runNpcSkill = more.runNpcSkill;
    if (more.cofounderAgent !== undefined) state.cofounderAgent = more.cofounderAgent;
    if (more.worldState !== undefined) state.worldState = more.worldState;
    if (more.lmStudioRouter !== undefined) state.lmStudioRouter = more.lmStudioRouter;
    if (more.log !== undefined) state.log = more.log;
    if (more.config !== undefined) state.config = more.config;
    return api;
  }

  const api = {
    version: config.meta?.version || '1.0.0',
    config,
    bind,

    // Inference
    complete: (o) => inference.complete(o),
    probeInference: (o) => inference.probe(o),
    resolveTier: (tier, runtime) => inference.resolveTierModel({ tier, runtime }),
    describeTiers: (runtime) => inference.describeTiers(runtime),

    // Loops
    think: (npc, ctx) => loops.think(npc, ctx),
    chat: (npc, messages, o) => loops.chat(npc, messages, o),
    director: (o) => loops.director(o),

    // Tools (Jelly)
    runSkill: (npc, skill, params, ctx) => tools.runSkill(npc, skill, params, ctx),
    listSkills: () => tools.listSkills(),
    hasSkill: (s) => tools.hasSkill(s),

    // Learning
    injectLearning: (npc, payload) => learning.injectLearning(npc, payload),
    injectSkillResult: (npc, skill, result) => learning.injectSkillResult(npc, skill, result),
    injectLesson: (npc, answer, o) => learning.injectLesson(npc, answer, o),
    learningRecent: (n) => learning.recent(n),

    // Identity / context
    listNpcs: () => identity.listNpcs(),
    getSoul: (npc) => identity.getSoul(npc),
    getMemory: (npc, n) => identity.getMemory(npc, n),
    getProvider: (npc) => identity.getProvider(npc),
    renderNpcBlock: (npc) => context.renderNpcBlock(npc),
    officeSnapshot: () => context.officeSnapshot(),
    businessBrief: (npc) => context.businessBrief(npc),

    // Observability
    status: () => observability.status(),

    // Submodule handles (advanced)
    modules: {
      inference,
      tools,
      learning,
      identity,
      context,
      loops,
      observability,
    },
  };

  _activeHarness = api;
  return api;
}

module.exports = {
  createDenizenHarness,
  loadHarnessConfig,
  getActiveHarness,
};
