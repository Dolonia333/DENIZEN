'use strict';

/**
 * Harness status + health aggregation.
 */

function createObservability(deps = {}) {
  async function status() {
    const config = deps.config || {};
    const jelly = deps.getJelly?.() || deps.jelly;
    const brains = deps.getNpcBrains?.() || deps.npcBrains;
    const router = deps.getLmStudioRouter?.() || null;

    let runtime = null;
    let tiers = null;
    try {
      runtime = await deps.inference?.probe?.({ timeoutMs: 3000 });
      tiers = deps.inference?.describeTiers?.(runtime) || null;
    } catch (err) {
      runtime = { reachable: false, error: err?.message || String(err) };
    }

    let pool = null;
    try {
      pool = router?.isEnabled?.()
        ? router.buildStatus(brains?.getQueueDepth?.() || 0)
        : null;
    } catch (_) {}

    let intelligenceLoop = null;
    try {
      intelligenceLoop = require('../intelligence-loop-health').buildHealth();
    } catch (err) {
      intelligenceLoop = { ok: false, error: err?.message };
    }

    const skills = (() => {
      try {
        return jelly?.listSkills?.()?.length ?? 0;
      } catch (_) {
        return 0;
      }
    })();

    const npcCount = brains?.brains ? Object.keys(brains.brains).length : 0;
    const recentLearning = deps.learning?.recent?.(10) || [];

    return {
      ok: true,
      harness: {
        name: config.meta?.name || 'Denizen Harness',
        version: config.meta?.version || '1.0.0',
        tagline: config.meta?.tagline || '',
      },
      bound: {
        jelly: !!jelly,
        npcBrains: !!brains,
        inference: !!deps.inference,
        cofounder: !!(deps.getCofounder?.() || deps.cofounderAgent),
        worldState: !!(deps.getWorldState?.() || deps.worldState),
        lmStudioRouter: !!router,
      },
      inference: {
        reachable: !!runtime?.reachable,
        backend: runtime?.backend || null,
        url: runtime?.url || null,
        models: runtime?.models || [],
        tiers,
      },
      // A+ plan P0 metrics — harness rate + tier truth, straight from the
      // shared ledger so /api/harness and /api/health always agree.
      metrics: (() => {
        const stats = (typeof globalThis !== 'undefined' && globalThis._npcStats) || {};
        const providerOk = stats.providerOk || 0;
        const harnessComplete = stats.harnessComplete || 0;
        const loaded = (runtime?.models || []).map((m) => String(m).toLowerCase());
        const mainPin = String(process.env.LM_STUDIO_MODEL || '').trim().toLowerCase();
        const mainModelUnloaded = !!(mainPin && loaded.length
          && !loaded.some((m) => m.includes(mainPin) || mainPin.includes(m)));
        return {
          providerOk,
          harnessComplete,
          harnessRate: providerOk > 0 ? Number((harnessComplete / providerOk).toFixed(4)) : null,
          mainModelUnloaded,
          thinkThrottled: stats.thinkThrottled || 0,
          providerFail: stats.providerFail || 0,
          npcTierRules: Object.keys(config.npc_tiers?.map || {}).length,
        };
      })(),
      pool,
      skills,
      npcCount,
      queueDepth: brains?.getQueueDepth?.() || 0,
      intelligenceLoop: {
        ok: intelligenceLoop?.ok,
        issues: intelligenceLoop?.issues || [],
      },
      learningRecent: recentLearning,
      openclaw: config.openclaw || { gateway_default: false },
      at: new Date().toISOString(),
    };
  }

  return { status };
}

module.exports = { createObservability };
