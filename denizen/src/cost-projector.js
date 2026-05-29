'use strict';
/**
 * Cost Projector — "what would this cost on the cloud?"
 *
 * Idea: run the whole office on local LM Studio (free), let the telemetry
 * record real token usage per NPC, then multiply that measured volume by each
 * cloud model's published price. You get a concrete $/day and $/month estimate
 * for every provider WITHOUT spending a cent during measurement.
 *
 * Pricing source: read from ~/.openclaw/openclaw.json (the user's own model
 * config carries a `cost` block per model: { input, output, cacheRead,
 * cacheWrite } in USD per 1,000,000 tokens). For cloud models the config
 * leaves at 0 (e.g. Moonshot/Kimi placeholders), we apply a small override
 * table of public list prices so the projection isn't silently free.
 *
 * Token usage source: llm-telemetry.getStats({ windowMs }) →
 *   { tokensInTotal, tokensOutTotal, calls, windowMs, byNpc: { <npc>: {...} } }
 *
 * Accuracy notes:
 *  - Local tokenizers differ slightly from each cloud provider's, so treat
 *    these as ±15% estimates, good for relative comparison.
 *  - Naive projection assumes NO prompt caching. Anthropic/Google caching can
 *    cut input cost ~5-10x for the big repeated SOUL prompts — we surface a
 *    separate "with caching" estimate for models that price cacheRead.
 */

const fs   = require('node:fs');
const path = require('node:path');

// Public list prices (USD per 1M tokens) for cloud models the openclaw.json
// config leaves at 0. Edit freely — these are just fallbacks. ~May 2026.
const PRICE_OVERRIDES = {
  'kimi-k2.5':              { input: 0.60, output: 2.50, estimate: true },
  'kimi-k2-0905-preview':   { input: 0.60, output: 2.50, estimate: true },
  'kimi-k2-turbo-preview':  { input: 1.15, output: 8.00, estimate: true },
  'kimi-k2-thinking':       { input: 0.60, output: 2.50, estimate: true },
  'kimi-k2-thinking-turbo': { input: 1.15, output: 8.00, estimate: true },
};

// Friendly labels by provider key
const PROVIDER_LABELS = {
  anthropic: 'Claude',
  google:    'Gemini',
  xai:       'Grok',
  moonshot:  'Kimi',
  openai:    'LM Studio (local)',
};

/**
 * Build a pricing table from openclaw.json.
 * @returns {object[]} [{ provider, modelId, label, input, output, cacheRead, local, estimate }]
 */
function loadPricing() {
  const configPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.openclaw', 'openclaw.json'
  );
  let providers = {};
  try {
    providers = JSON.parse(fs.readFileSync(configPath, 'utf-8'))?.models?.providers || {};
  } catch (_) {
    return [];
  }

  const rows = [];
  for (const [provKey, prov] of Object.entries(providers)) {
    const isLocal = provKey === 'openai'; // openai key == local LM Studio in this setup
    for (const m of (prov.models || [])) {
      const override = PRICE_OVERRIDES[m.id];
      const cost = m.cost || {};
      let input  = cost.input  ?? 0;
      let output = cost.output ?? 0;
      let estimate = false;
      // If a cloud model is priced at 0 in config but we have an override, use it.
      if (!isLocal && input === 0 && output === 0 && override) {
        input = override.input;
        output = override.output;
        estimate = true;
      }
      rows.push({
        provider:  provKey,
        providerLabel: PROVIDER_LABELS[provKey] || provKey,
        modelId:   m.id,
        label:     m.name || m.id,
        input,
        output,
        cacheRead: cost.cacheRead ?? null,
        local:     isLocal,
        estimate:  estimate || !!override?.estimate,
      });
    }
  }
  return rows;
}

/**
 * Project cost for a measured token volume across all priced models.
 *
 * @param {object} usage — from llm-telemetry.getStats()
 *   { tokensInTotal, tokensOutTotal, calls, windowMs, byNpc? }
 * @param {object} opts — { cacheHitRate?: 0..1 } fraction of INPUT tokens
 *   assumed served from cache in the "with caching" estimate (default 0.75,
 *   reflecting the big repeated SOUL system prompt).
 * @returns {object} {
 *   windowMs, tokensIn, tokensOut, calls,
 *   models: [{ provider, modelId, label, local, estimate,
 *              windowCost, perHour, perDay, perMonth,
 *              perDayCached, perMonthCached }],
 *   measuredOn: 'lmstudio'|...,
 *   note
 * }
 */
function project(usage = {}, opts = {}) {
  const tokensIn  = usage.tokensInTotal  || 0;
  const tokensOut = usage.tokensOutTotal || 0;
  const calls     = usage.calls || 0;
  const windowMs  = usage.windowMs || (5 * 60 * 1000);
  const cacheHitRate = opts.cacheHitRate != null ? opts.cacheHitRate : 0.75;

  const dayFactor   = 86_400_000 / windowMs;
  const hourFactor  = 3_600_000  / windowMs;
  const monthFactor = dayFactor * 30;

  const pricing = loadPricing();
  const models = pricing.map(p => {
    // Naive: full input price on every input token.
    const windowCost = (tokensIn / 1e6) * p.input + (tokensOut / 1e6) * p.output;

    // With-caching estimate: a fraction of input tokens billed at cacheRead.
    let windowCostCached = null;
    if (p.cacheRead != null && p.cacheRead < p.input) {
      const cachedIn  = tokensIn * cacheHitRate;
      const freshIn   = tokensIn * (1 - cacheHitRate);
      windowCostCached =
        (freshIn / 1e6) * p.input +
        (cachedIn / 1e6) * p.cacheRead +
        (tokensOut / 1e6) * p.output;
    }

    return {
      provider:   p.provider,
      providerLabel: p.providerLabel,
      modelId:    p.modelId,
      label:      p.label,
      local:      p.local,
      estimate:   p.estimate,
      inputPrice: p.input,
      outputPrice:p.output,
      windowCost: round4(windowCost),
      perHour:    round4(windowCost * hourFactor),
      perDay:     round2(windowCost * dayFactor),
      perMonth:   round2(windowCost * monthFactor),
      perDayCached:   windowCostCached != null ? round2(windowCostCached * dayFactor) : null,
      perMonthCached: windowCostCached != null ? round2(windowCostCached * monthFactor) : null,
    };
  });

  // Sort cheapest-first by monthly cost, but keep local ($0) models grouped first.
  models.sort((a, b) => a.perMonth - b.perMonth);

  return {
    windowMs,
    tokensIn,
    tokensOut,
    calls,
    callsPerDay: Math.round(calls * dayFactor),
    tokensInPerDay:  Math.round(tokensIn * dayFactor),
    tokensOutPerDay: Math.round(tokensOut * dayFactor),
    models,
    cacheHitRate,
    note: 'Projection from locally-measured token volume. ±15% (tokenizer differences). "Cached" columns assume ' +
          Math.round(cacheHitRate * 100) + '% of input tokens hit prompt cache (the repeated SOUL prompt).',
  };
}

/**
 * Per-NPC cost on a single chosen model — shows who's expensive to run.
 * @param {object} byNpc — usage.byNpc from getStats()
 * @param {object} model — one row from project().models (needs inputPrice/outputPrice)
 * @param {number} windowMs
 * @returns {object[]} [{ npc, tokensIn, tokensOut, calls, perDay, perMonth }]
 */
function projectPerNpc(byNpc = {}, model, windowMs = 5 * 60 * 1000) {
  if (!model) return [];
  const dayFactor = 86_400_000 / windowMs;
  return Object.entries(byNpc).map(([npc, u]) => {
    const tIn = u.tokensIn || 0, tOut = u.tokensOut || 0;
    const windowCost = (tIn / 1e6) * model.inputPrice + (tOut / 1e6) * model.outputPrice;
    return {
      npc,
      tokensIn: tIn,
      tokensOut: tOut,
      calls: u.calls || 0,
      perDay:   round2(windowCost * dayFactor),
      perMonth: round2(windowCost * dayFactor * 30),
    };
  }).sort((a, b) => b.perMonth - a.perMonth);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = { loadPricing, project, projectPerNpc };
