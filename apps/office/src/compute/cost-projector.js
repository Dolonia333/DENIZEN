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

// ── Curated CURRENT cloud pricing ───────────────────────────────────────────
// USD per 1,000,000 tokens. Verified against provider pricing pages, May 2026.
// The openclaw.json config carries older models (Sonnet 4.5, Haiku 3.5, Grok 2/3,
// Gemini 2.x) — we deliberately do NOT use those for the projection. This table
// is the source of truth for "what would current cloud models cost." Edit here
// when prices/models change, and bump PRICING_AS_OF.
//
// cacheRead = price for input tokens served from prompt cache (huge lever for
// Denizen since every NPC re-sends its big SOUL system prompt each think cycle).
const PRICING_AS_OF = '2026-05';
const CLOUD_PRICING = [
  // Anthropic — Haiku 4.5 / Sonnet 4.6 / Opus 4.7 (output = 5x input)
  { provider: 'anthropic', providerLabel: 'Claude', modelId: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  input: 1.00, output: 5.00,  cacheRead: 0.10 },
  { provider: 'anthropic', providerLabel: 'Claude', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3.00, output: 15.00, cacheRead: 0.30 },
  { provider: 'anthropic', providerLabel: 'Claude', modelId: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   input: 5.00, output: 25.00, cacheRead: 0.50 },
  // Google — Gemini 3 Flash / 3.5 Flash / 3.1 Pro (model IDs verified via
  // ListModels: 3-flash & 3.1-pro carry a -preview suffix; 3.5-flash does not)
  { provider: 'google', providerLabel: 'Gemini', modelId: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',   input: 0.50, output: 3.00,  cacheRead: 0.05 },
  { provider: 'google', providerLabel: 'Gemini', modelId: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash', input: 1.50, output: 9.00,  cacheRead: 0.15 },
  { provider: 'google', providerLabel: 'Gemini', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',   input: 2.00, output: 12.00, cacheRead: 0.20 },
  // xAI — Grok 4.3 (current flagship; grok-4.1-fast was deprecated/redirected)
  { provider: 'xai', providerLabel: 'Grok', modelId: 'grok-4.3', label: 'Grok 4.3', input: 1.25, output: 2.50, cacheRead: 0.13 },
  // Moonshot — Kimi K2.5 / K2.6 (current; K2 legacy EOL May 2026)
  { provider: 'moonshot', providerLabel: 'Kimi', modelId: 'kimi-k2.5', label: 'Kimi K2.5', input: 0.60, output: 3.00, cacheRead: 0.15 },
  { provider: 'moonshot', providerLabel: 'Kimi', modelId: 'kimi-k2.6', label: 'Kimi K2.6', input: 0.95, output: 4.00, cacheRead: 0.15 },
];

/**
 * Build the pricing table: LOCAL models from openclaw.json (shown as FREE) +
 * the curated CURRENT cloud table above. We pull local models from config so
 * the projection reflects whatever you actually run locally, but cloud prices
 * always come from the curated (current) table — not the stale config costs.
 *
 * @returns {object[]} [{ provider, modelId, label, input, output, cacheRead, local, estimate }]
 */
function loadPricing() {
  const rows = [];

  // 1) Local models from config (the 'openai'-keyed provider == LM Studio here)
  try {
    const providers = require('../../jelly/config-provider').getConfig()?.models?.providers || {};
    const local = providers.openai;
    for (const m of (local?.models || [])) {
      rows.push({
        provider: 'openai',
        providerLabel: 'LM Studio (local)',
        modelId: m.id,
        label: m.name || m.id,
        input: 0, output: 0, cacheRead: 0,
        local: true, estimate: false,
      });
    }
  } catch (_) { /* no config — cloud-only projection still works */ }

  // 2) Curated current cloud models
  for (const p of CLOUD_PRICING) {
    rows.push({ ...p, local: false, estimate: false });
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
    pricingAsOf: PRICING_AS_OF,
    note: `Prices verified ${PRICING_AS_OF}. Projection from locally-measured token volume, ±15% (tokenizer differences). "Cached" assumes ` +
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

// Map a telemetry provider name → pricing-table provider key.
function provKey(p) {
  return p === 'claude' ? 'anthropic'
    : p === 'kimi'   ? 'moonshot'
    : p === 'grok'   ? 'xai'
    : p === 'gemini' ? 'google'
    : p;
}

const LOCAL_PROVIDERS = new Set(['lmstudio', 'lmstudio-fast', 'openai', 'demo']);

/**
 * Price one call by the model it actually used.
 * Local providers are free. Cloud calls match by exact modelId, then by
 * provider as a fallback.
 */
function priceForCall(provider, modelId, pricingRows) {
  if (LOCAL_PROVIDERS.has(provider)) return { input: 0, output: 0, local: true };
  let row = pricingRows.find(r => !r.local && r.modelId === modelId);
  if (!row) {
    const key = provKey(provider);
    row = pricingRows.find(r => !r.local && r.provider === key);
  }
  return row ? { input: row.input, output: row.output, local: false } : { input: 0, output: 0, local: false, unknown: true };
}

/**
 * Per-NPC profiles: ACTUAL cost (priced by the model each call really used)
 * plus an ESTIMATED cost if that NPC ran on a reference cloud model.
 *
 * This is the "profile tracker" — for a local NPC it shows what it WOULD cost
 * on the cloud (estimate); for a cloud NPC it shows what it HAS cost (actual).
 *
 * @param {object[]} events — telemetry.getWindowEvents()
 * @param {object} opts — { windowMs, referenceModel } referenceModel is the
 *   modelId used for the "if it were on cloud" estimate (default Haiku 4.5).
 * @returns {object} { windowMs, referenceModel, profiles: [...] }
 */
function buildNpcProfiles(events = [], opts = {}) {
  const windowMs = opts.windowMs || 60 * 60 * 1000;
  const referenceModelId = opts.referenceModel || 'claude-haiku-4-5';
  const pricing = loadPricing();
  const ref = pricing.find(r => r.modelId === referenceModelId)
    || pricing.find(r => !r.local); // first cloud model if ref missing
  const dayFactor = 86_400_000 / windowMs;

  const acc = {};
  for (const e of events) {
    const npc = e.npc || 'unknown';
    if (!acc[npc]) {
      acc[npc] = {
        npc, calls: 0, errors: 0, tokensIn: 0, tokensOut: 0,
        actualCost: 0, anyCloud: false, latSum: 0, latN: 0,
        providers: new Set(), models: new Set(),
        lastAt: 0, lastProvider: null, lastModel: null,
      };
    }
    const b = acc[npc];
    const tIn = e.tokensIn || 0, tOut = e.tokensOut || 0;
    b.calls += 1;
    if (e.error) b.errors += 1;
    b.tokensIn += tIn; b.tokensOut += tOut;
    if (Number.isFinite(e.latencyMs)) { b.latSum += e.latencyMs; b.latN += 1; }
    const price = priceForCall(e.provider, e.model, pricing);
    b.actualCost += (tIn / 1e6) * price.input + (tOut / 1e6) * price.output;
    if (!price.local) b.anyCloud = true;
    if (e.provider) b.providers.add(e.provider);
    if (e.model) b.models.add(e.model);
    const ts = Date.parse(e.at) || 0;
    if (ts >= b.lastAt) { b.lastAt = ts; b.lastProvider = e.provider; b.lastModel = e.model; }
  }

  const profiles = Object.values(acc).map(b => {
    const estWindow = (b.tokensIn / 1e6) * (ref?.input || 0) + (b.tokensOut / 1e6) * (ref?.output || 0);
    return {
      npc: b.npc,
      provider: b.lastProvider,
      model: b.lastModel,
      isLocal: !b.anyCloud,
      calls: b.calls,
      errors: b.errors,
      tokensIn: b.tokensIn,
      tokensOut: b.tokensOut,
      avgLatencyMs: b.latN ? Math.round(b.latSum / b.latN) : null,
      providersUsed: [...b.providers],
      // ACTUAL — what this NPC's calls really cost (local = $0)
      actualCostWindow: round4(b.actualCost),
      actualPerDay:   round2(b.actualCost * dayFactor),
      actualPerMonth: round2(b.actualCost * dayFactor * 30),
      // ESTIMATED — what it would cost on the reference cloud model
      estModel:      ref?.label || null,
      estPerDay:     round2(estWindow * dayFactor),
      estPerMonth:   round2(estWindow * dayFactor * 30),
    };
  }).sort((a, b) =>
    (b.actualPerMonth - a.actualPerMonth) || (b.estPerMonth - a.estPerMonth)
  );

  return { windowMs, referenceModel: ref?.label || referenceModelId, profiles };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = { loadPricing, project, projectPerNpc, buildNpcProfiles };
