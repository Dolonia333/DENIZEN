'use strict';

/**
 * Harness status + health aggregation (A+ ops surface).
 */

const fs = require('node:fs');
const path = require('node:path');

function createObservability(deps = {}) {
  async function status() {
    const config = deps.config || {};
    const jelly = deps.getJelly?.() || deps.jelly;
    const brains = deps.getNpcBrains?.() || deps.npcBrains;
    const router = deps.getLmStudioRouter?.() || null;
    const version = config.meta?.version || '1.0.0';

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

    const registeredSkills = (() => {
      try {
        return jelly?.listSkills?.() || [];
      } catch (_) {
        return [];
      }
    })();

    // Optional skill contracts module
    let skillContractsCount = null;
    let skillContractIds = [];
    let skillMetrics = null;
    try {
      const sc = require('../denizen-skill-contracts');
      const list = sc.listContracts?.() || [];
      skillContractsCount = list.length;
      skillContractIds = list.map((c) => c.id || c.name).filter(Boolean);
      skillMetrics = sc.metricsSummary?.() || null;
    } catch (_) {
      skillContractsCount = null;
    }

    // Daily plan file
    const denizenRoot = deps.denizenRoot || path.join(__dirname, '..', '..');
    const planPath = path.join(denizenRoot, 'data', 'daily-plan.json');
    let dailyPlan = { present: false, path: planPath, mtime: null, priorities: null };
    try {
      if (fs.existsSync(planPath)) {
        const st = fs.statSync(planPath);
        let priorities = null;
        try {
          const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
          priorities = raw?.priorities || raw?.plan?.priorities || null;
        } catch (_) {}
        dailyPlan = {
          present: true,
          path: planPath,
          mtime: st.mtime.toISOString(),
          priorities: Array.isArray(priorities) ? priorities.slice(0, 5) : null,
        };
      }
    } catch (_) {}

    // Director health when cofounder is bound
    let director = null;
    try {
      const cf = deps.getCofounder?.() || deps.cofounderAgent;
      if (cf?.buildDirectorHealth) director = cf.buildDirectorHealth();
    } catch (_) {
      director = null;
    }

    const npcCount = brains?.brains ? Object.keys(brains.brains).length : 0;
    const recentLearning = deps.learning?.recent?.(10) || [];

    // P2.1 learning closed-loop scorecard (optional — never fail status)
    let learning = null;
    try {
      const lm = require('../denizen-learning-metrics');
      learning = lm.buildLearningScorecard({ denizenRoot });
    } catch (err) {
      learning = { ok: false, error: err?.message || String(err) };
    }

    // Optional MCP / BYO-AI surface (never secrets)
    let mcp = null;
    try {
      const mcpHealth = require('../denizen-mcp-health');
      mcp = mcpHealth.summarizeMcpSurface({ denizenRoot });
    } catch (_) {
      mcp = null;
    }

    const metrics = (() => {
      const stats = (typeof globalThis !== 'undefined' && globalThis._npcStats) || {};
      const providerOk = stats.providerOk || 0;
      const harnessComplete = stats.harnessComplete || 0;
      const streamParity = stats.streamParity || 0;
      const loaded = (runtime?.models || []).map((m) => String(m).toLowerCase());
      const mainPin = String(process.env.LM_STUDIO_MODEL || '').trim().toLowerCase();
      const mainModelUnloaded = !!(mainPin && loaded.length
        && !loaded.some((m) => m.includes(mainPin) || mainPin.includes(m)));
      return {
        providerOk,
        harnessComplete,
        streamParity,
        harnessRate: providerOk > 0 ? Number((harnessComplete / providerOk).toFixed(4)) : null,
        mainModelUnloaded,
        thinkThrottled: stats.thinkThrottled || 0,
        providerFail: stats.providerFail || 0,
        npcTierRules: Object.keys(config.npc_tiers?.map || {}).length,
        lastHarnessModel: stats.lastHarnessModel || null,
        lastHarnessTier: stats.lastHarnessTier || null,
      };
    })();

    return {
      ok: true,
      version,
      harness: {
        name: config.meta?.name || 'Denizen Harness',
        version,
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
      metrics,
      skillContracts: skillContractsCount,
      dailyPlan,
      director,
      // Detailed skills block (contracts + runtime registry)
      skills: {
        contracts: skillContractsCount || 0,
        registered: registeredSkills.length,
        count: registeredSkills.length,
        ids: skillContractIds.length ? skillContractIds : registeredSkills.map((s) => s.id || s.name || s).filter(Boolean),
        metrics: skillMetrics,
      },
      pool,
      npcCount,
      queueDepth: brains?.getQueueDepth?.() || 0,
      intelligenceLoop: {
        ok: intelligenceLoop?.ok,
        issues: intelligenceLoop?.issues || [],
      },
      learningRecent: recentLearning,
      learning,
      openclaw: config.openclaw || { gateway_default: false },
      // Optional MCP / BYO-AI health (null only if module fails to load)
      mcp,
      at: new Date().toISOString(),
    };
  }

  return { status };
}

module.exports = { createObservability };
