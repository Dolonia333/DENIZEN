'use strict';

/**
 * Model tier resolution for the Denizen harness.
 *
 * Rules:
 *  1. Explicit pin wins.
 *  2. Env pins (LM_STUDIO_*_MODEL) if they appear loaded / in catalog.
 *  3. Probe-reported fast/main/heavy from LM Studio.
 *  4. Heuristic size match from catalog.
 *  5. Never silently answer "main" with a 2B if a larger loaded model exists.
 */

const SIZE_RE = /(\d+)\s*b\b/i;

function modelSizeB(id) {
  const m = String(id || '').match(SIZE_RE);
  return m ? Number(m[1]) : 0;
}

function normalizeId(id) {
  return String(id || '').trim();
}

function catalogHas(models, want) {
  if (!want) return null;
  const w = String(want).toLowerCase();
  const list = Array.isArray(models) ? models : [];
  return list.find((m) => {
    const s = String(m).toLowerCase();
    return s === w || s.includes(w) || w.includes(s);
  }) || null;
}

function pickByPatterns(models, includeRe, excludeRe) {
  const list = Array.isArray(models) ? models : [];
  return list.find((m) => {
    const s = String(m);
    if (excludeRe && excludeRe.test(s)) return false;
    return includeRe.test(s);
  }) || null;
}

/**
 * @param {object} opts
 * @param {'fast'|'main'|'heavy'|'reasoning'} opts.tier
 * @param {string|null} [opts.pinned]
 * @param {object} [opts.runtime]  probe result { models, main_model, fast_model, heavy_model }
 * @param {object} [opts.env]
 * @param {object} [opts.config]   denizen-harness.json tiers section
 */
function resolveTierModel(opts = {}) {
  const tier = String(opts.tier || 'main').toLowerCase();
  const env = opts.env || process.env;
  const runtime = opts.runtime || {};
  const models = runtime.models || [];
  const pinned = normalizeId(opts.pinned);
  if (pinned) return pinned;

  const envFast = normalizeId(env.LM_STUDIO_FAST_MODEL);
  const envMain = normalizeId(env.LM_STUDIO_MODEL);
  const envHeavy = normalizeId(env.LM_STUDIO_HEAVY_MODEL);
  const envReason = normalizeId(env.LM_STUDIO_REASONING_MODEL);

  if (tier === 'fast') {
    return catalogHas(models, envFast)
      || normalizeId(runtime.fast_model)
      || catalogHas(models, envFast) // if catalog empty, still return env
      || envFast
      || pickByPatterns(models, /gemma|e2b|3b|1b|mini|8b/i, /14b|27b|32b/i)
      || normalizeId(runtime.main_model)
      || envMain
      || models[0]
      || null;
  }

  if (tier === 'heavy' || tier === 'reasoning') {
    const prefer = tier === 'reasoning'
      ? (catalogHas(models, envReason) || envReason)
      : null;
    return prefer
      || catalogHas(models, envHeavy)
      || normalizeId(runtime.heavy_model)
      || envHeavy
      || catalogHas(models, envMain)
      || normalizeId(runtime.main_model)
      || envMain
      || pickByPatterns(models, /27b|32b|14b|ministral|qwen3|deepseek.*32/i, null)
      || largestModel(models)
      || models[0]
      || null;
  }

  // main — prefer real mid/large, never collapse to tiny if larger exists
  const mainCandidate = catalogHas(models, envMain)
    || normalizeId(runtime.main_model)
    || envMain
    || catalogHas(models, envHeavy)
    || normalizeId(runtime.heavy_model)
    || envHeavy
    || pickByPatterns(models, /14b|27b|32b|ministral|qwen/i, null)
    || largestModel(models)
    || models[0]
    || null;

  // Guard: if main resolved to a tiny model but a larger one is loaded, promote.
  if (mainCandidate && models.length) {
    const mainSize = modelSizeB(mainCandidate);
    const best = largestModel(models);
    const bestSize = modelSizeB(best);
    if (best && bestSize >= 14 && mainSize > 0 && mainSize < 8) {
      return best;
    }
  }
  return mainCandidate;
}

function largestModel(models) {
  const list = Array.isArray(models) ? models : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => modelSizeB(b) - modelSizeB(a))[0] || null;
}

/**
 * Map loop/task kind → default tier for the harness.
 */
function tierForKind(kind, loopConfig = {}) {
  const k = String(kind || 'chat').toLowerCase();
  if (loopConfig[k]?.tier) return loopConfig[k].tier;
  if (k === 'presence' || k === 'idle' || k === 'ambient') return 'fast';
  if (k === 'code' || k === 'coding-agent' || k === 'director') return 'heavy';
  if (k === 'think' || k === 'decision' || k === 'reasoning') return 'main';
  if (k === 'skill_args' || k === 'skill-args') return 'fast';
  return 'main';
}

const TIER_RANK = { fast: 0, main: 1, heavy: 2, reasoning: 2 };

/**
 * Per-NPC tier policy from config `npc_tiers` (A+ plan P0.2).
 *
 * Shape:
 *   "npc_tiers": {
 *     "map": {
 *       "abby": { "min_tier": "main", "kinds": { "think": "heavy" } },
 *       "bouncer": { "max_tier": "fast" }
 *     }
 *   }
 *
 * Semantics applied to a tier the caller already resolved (kind default or
 * explicit): per-kind pin wins; then min_tier raises (a mapped "hard" NPC can
 * never be answered by a lower tier, even if the callsite asked for fast);
 * then max_tier lowers (ambient-only NPCs never burn the big model).
 */
function tierForNpc(baseTier, npcKey, kind, npcTiersConfig = {}) {
  const map = npcTiersConfig?.map || npcTiersConfig || {};
  const key = String(npcKey || '').trim().toLowerCase();
  if (!key || !map[key]) return baseTier;
  const rule = map[key];
  let tier = String(baseTier || 'main').toLowerCase();

  const kindPin = rule.kinds?.[String(kind || '').toLowerCase()];
  if (kindPin && TIER_RANK[kindPin] != null) tier = kindPin;

  const min = String(rule.min_tier || '').toLowerCase();
  if (TIER_RANK[min] != null && TIER_RANK[tier] < TIER_RANK[min]) tier = min;

  const max = String(rule.max_tier || '').toLowerCase();
  if (TIER_RANK[max] != null && TIER_RANK[tier] > TIER_RANK[max]) tier = max;

  return tier;
}

module.exports = {
  resolveTierModel,
  tierForKind,
  tierForNpc,
  modelSizeB,
  catalogHas,
  largestModel,
};
