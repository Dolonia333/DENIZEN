'use strict';

/**
 * Single inference gate for the Denizen harness.
 * All brain-quality calls should flow through complete().
 */

const {
  chatCompletion,
  probeInferenceRuntime,
  resolveRuntimeModel,
} = require('../denizen-inference-runtime');
const { samplingFor, applySampling } = require('../inference-sampling');
const { resolveTierModel, tierForKind, tierForNpc } = require('./tiers');

let _telemetry = null;
try { _telemetry = require('../llm-telemetry'); } catch (_) {}

const REASONING_KINDS = new Set([
  'think', 'decision', 'reasoning',
  'linux-investigation-report', 'incident-report',
]);

/**
 * @param {object} deps
 * @param {object} [deps.config]
 * @param {function} [deps.getLmStudioRouter]
 * @param {object} [deps.log]
 */
function createInferenceGate(deps = {}) {
  const config = deps.config || {};
  const defaults = config.defaults || {};
  const loops = config.loops || {};

  /**
   * Canonical completion API.
   *
   * @param {object} opts
   * @param {'fast'|'main'|'heavy'|'reasoning'} [opts.tier]
   * @param {string} [opts.kind]     chat|decision|presence|code|think|…
   * @param {string} [opts.npc]
   * @param {string} [opts.systemPrompt]
   * @param {Array<{role:string,content:string}>} [opts.messages]
   * @param {string} [opts.model]    hard pin
   * @param {number} [opts.max_tokens]
   * @param {number} [opts.temperature]
   * @param {boolean} [opts.reasoning]  force enable_thinking on LM Studio
   * @param {object} [opts.response_format]
   * @param {function} [opts.onToken]
   * @param {object} [opts.runtime]  pre-probed runtime
   * @returns {Promise<object>}
   */
  async function complete(opts = {}) {
    const started = Date.now();
    const kind = String(opts.kind || defaults.kind || 'chat');
    const npc = opts.npc || null;
    // Kind default (or explicit tier), then per-NPC policy: kind pins,
    // min_tier raises (hard NPCs never answered by a lower tier), max_tier
    // lowers (ambient-only NPCs never burn the big model).
    let tier = String(opts.tier || tierForKind(kind, loops) || defaults.tier || 'main').toLowerCase();
    tier = tierForNpc(tier, npc, kind, config.npc_tiers);

    let runtime = opts.runtime || null;
    if (!runtime) {
      // Prefer mesh/router host if available
      const router = typeof deps.getLmStudioRouter === 'function' ? deps.getLmStudioRouter() : null;
      let baseUrl = null;
      try {
        const status = router?.buildStatus?.(0);
        baseUrl = status?.selected?.url || status?.host_url || null;
      } catch (_) {}

      runtime = await probeInferenceRuntime({
        backend: opts.backend,
        lmStudioUrl: opts.baseUrl || baseUrl || undefined,
        apiKey: opts.apiKey,
        timeoutMs: opts.probeTimeoutMs,
      });
    }

    const model = resolveTierModel({
      tier,
      pinned: opts.model || null,
      runtime,
      env: process.env,
      config: config.tiers,
    }) || await resolveRuntimeModel(runtime, tier === 'fast' ? 'fast' : 'main', opts.model);

    const sampling = samplingFor({
      kind,
      reasoning: opts.reasoning || tier === 'reasoning' || REASONING_KINDS.has(kind),
      temperature: opts.temperature,
    });

    const enableThinking = opts.enableThinking === true
      || opts.reasoning === true
      || tier === 'reasoning'
      || (opts.enableThinking !== false && REASONING_KINDS.has(kind) && /r1|reason/i.test(String(model || '')));

    let result;
    let error = null;
    try {
      result = await chatCompletion({
        runtime,
        model,
        tier: tier === 'fast' ? 'fast' : (tier === 'heavy' || tier === 'reasoning' ? 'heavy' : 'main'),
        kind,
        systemPrompt: opts.systemPrompt || '',
        messages: Array.isArray(opts.messages) ? opts.messages : [],
        max_tokens: opts.max_tokens ?? opts.maxTokens ?? defaults.max_tokens ?? 512,
        temperature: sampling.temperature,
        timeoutMs: opts.timeoutMs ?? defaults.timeout_ms,
        onToken: opts.onToken,
        apiKey: opts.apiKey,
        // harness extensions consumed by patched chatCompletion
        sampling,
        enableThinking,
        response_format: opts.response_format || opts.responseFormat || null,
        harness: true,
      });
    } catch (err) {
      error = err;
    }

    const latencyMs = Date.now() - started;
    const usage = result?.usage || null;

    if (_telemetry?.record) {
      try {
        _telemetry.record({
          npc,
          kind: `harness:${kind}`,
          provider: result?.backend || 'lmstudio',
          model: result?.model || model,
          latencyMs,
          tokensIn: usage?.prompt_tokens ?? null,
          tokensOut: usage?.completion_tokens ?? null,
          conversationMsgs: Array.isArray(opts.messages) ? opts.messages.length : null,
          promptPreview: opts.systemPrompt ? String(opts.systemPrompt).slice(0, 200) : null,
          responsePreview: result?.text ? String(result.text).slice(0, 200) : null,
          error: error || null,
          correlationId: opts.correlationId || null,
        });
      } catch (_) {}
    }

    if (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      e.harness = { tier, kind, model, latencyMs };
      throw e;
    }

    return {
      ok: true,
      text: result.text,
      model: result.model || model,
      backend: result.backend,
      url: result.url,
      usage,
      raw: result.raw,
      tier,
      kind,
      sampling,
      latencyMs,
      enableThinking: !!enableThinking,
    };
  }

  async function probe(opts = {}) {
    return probeInferenceRuntime(opts);
  }

  function describeTiers(runtime) {
    return {
      fast: resolveTierModel({ tier: 'fast', runtime }),
      main: resolveTierModel({ tier: 'main', runtime }),
      heavy: resolveTierModel({ tier: 'heavy', runtime }),
      reasoning: resolveTierModel({ tier: 'reasoning', runtime }),
    };
  }

  return {
    complete,
    probe,
    describeTiers,
    resolveTierModel: (o) => resolveTierModel(o),
    samplingFor,
    applySampling,
  };
}

module.exports = {
  createInferenceGate,
  REASONING_KINDS,
};
