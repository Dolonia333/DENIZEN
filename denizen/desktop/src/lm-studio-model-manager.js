'use strict';

/**
 * Keep main + fast resident in LM Studio; heavy loads JIT with a short TTL.
 *
 * Strategy for ~16GB GPUs (e.g. 4070 Ti SUPER):
 *  - Manually load LM_STUDIO_MODEL + LM_STUDIO_FAST_MODEL (no idle TTL) so they
 *    survive Auto-Evict (non-JIT loads are not auto-evicted).
 *  - Heavy (LM_STUDIO_HEAVY_MODEL) is NOT preloaded — first request JIT-loads it
 *    with ttl so it unloads after idle and frees VRAM for main/fast.
 *
 * LM Studio settings (GPU host):
 *  - Developer → Server: JIT loading ON, Auto-Evict ON
 *  - Do not "load all" on startup — Denizen calls ensureResidentModels()
 */

function heavyTtlSec() {
  return Math.max(60, Number(process.env.LM_STUDIO_HEAVY_TTL_SEC || 600) || 600);
}

function residentCtx() {
  return Math.max(2048, Number(process.env.LM_STUDIO_RESIDENT_CTX || 8192) || 8192);
}

function preloadEnabled() {
  return !/^(0|false|no|off)$/i.test(String(process.env.LM_STUDIO_PRELOAD_RESIDENT ?? '1'));
}

const DEFAULT_HEAVY_TTL_SEC = heavyTtlSec();
const DEFAULT_CONTEXT = residentCtx();

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function resolveBaseUrl(explicit) {
  if (explicit) return normalizeBaseUrl(explicit);
  try {
    const router = require('./lm-studio-router');
    const active = router.activeInferenceUrl?.({ tier: 'main' });
    if (active) return normalizeBaseUrl(active);
  } catch (_) { /* optional */ }
  const remotes = String(process.env.LM_STUDIO_REMOTE_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (remotes[0]) return normalizeBaseUrl(remotes[0]);
  return normalizeBaseUrl(process.env.LM_STUDIO_URL || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234');
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = process.env.LM_STUDIO_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function envPins() {
  return {
    main: String(process.env.LM_STUDIO_MODEL || '').trim() || null,
    fast: String(process.env.LM_STUDIO_FAST_MODEL || '').trim() || null,
    heavy: String(process.env.LM_STUDIO_HEAVY_MODEL || '').trim() || null,
  };
}

async function listModels(baseUrl) {
  const base = resolveBaseUrl(baseUrl);
  const res = await fetch(`${base}/api/v0/models`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`list models failed (${res.status}): ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  return rows.map((m) => ({
    id: String(m.id || m.key || ''),
    state: String(m.state || (m.loaded ? 'loaded' : 'not-loaded')).toLowerCase(),
  })).filter((m) => m.id);
}

function isLoaded(models, pin) {
  if (!pin) return false;
  const needle = pin.toLowerCase();
  return models.some((m) => {
    const id = m.id.toLowerCase();
    const state = String(m.state || '').toLowerCase();
    // "not-loaded" must not match /loaded/
    const loaded = state === 'loaded' || state === 'idle' || state === 'busy';
    return loaded && (id === needle || id.includes(needle) || needle.includes(id));
  });
}

/**
 * Load a model via LM Studio REST (manual load = not JIT, survives Auto-Evict).
 */
async function loadModel(model, opts = {}) {
  const base = resolveBaseUrl(opts.baseUrl);
  const body = {
    model,
    context_length: Number(opts.contextLength) || residentCtx(),
  };
  // Prefer v1; fall back to legacy paths if needed.
  const paths = ['/api/v1/models/load', '/api/v0/models/load'];
  let lastErr = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${base}${p}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(opts.timeoutMs) || 180_000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, model, path: p, data };
      }
      const detail = await res.text().catch(() => '');
      lastErr = new Error(`load failed (${res.status}): ${detail.slice(0, 160)}`);
      // 404 → try next path
      if (res.status !== 404) break;
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, model, error: lastErr?.message || 'load_failed' };
}

/**
 * Ensure main + fast are resident. Never preloads heavy.
 */
async function ensureResidentModels(opts = {}) {
  if (!preloadEnabled() && !opts.force) {
    return { ok: true, skipped: true, reason: 'LM_STUDIO_PRELOAD_RESIDENT off' };
  }
  const pins = envPins();
  const resident = [pins.main, pins.fast].filter(Boolean);
  // Dedupe if fast === main
  const unique = [...new Set(resident)];
  if (!unique.length) {
    return { ok: false, error: 'no LM_STUDIO_MODEL / LM_STUDIO_FAST_MODEL pins' };
  }

  const base = resolveBaseUrl(opts.baseUrl);
  let models = [];
  try {
    models = await listModels(base);
  } catch (err) {
    return { ok: false, error: err.message, base };
  }

  const results = [];
  for (const model of unique) {
    if (isLoaded(models, model) && !opts.forceReload) {
      results.push({ model, ok: true, already: true });
      continue;
    }
    const r = await loadModel(model, { baseUrl: base, contextLength: opts.contextLength });
    results.push(r);
    // Refresh loaded list after each load
    try { models = await listModels(base); } catch (_) { /* ignore */ }
  }

  const heavy = pins.heavy;
  const heavyLoaded = heavy ? isLoaded(models, heavy) : false;

  return {
    ok: results.every((r) => r.ok),
    base,
    pins,
    resident: results,
    heavy: heavy
      ? {
          model: heavy,
          loaded: heavyLoaded,
          strategy: 'jit',
          ttl_sec: heavyTtlSec(),
          note: heavyLoaded
            ? 'Heavy is currently loaded (will idle-unload with TTL on next JIT request)'
            : 'Heavy not preloaded — first heavy request will JIT-load with TTL',
        }
      : null,
  };
}

/**
 * TTL (seconds) to attach on chat/completions for a tier.
 * Heavy gets a short TTL so Auto-Evict / idle unload frees VRAM.
 * Main/fast omit TTL when we treat them as resident (manual loads).
 */
function ttlForTier(tier) {
  const t = String(tier || 'main').toLowerCase();
  if (t === 'heavy' || t === 'reasoning') {
    return heavyTtlSec();
  }
  // Optional: allow short TTL on fast if env set (default: none = stay resident)
  if (t === 'fast' && process.env.LM_STUDIO_FAST_TTL_SEC) {
    return Math.max(60, Number(process.env.LM_STUDIO_FAST_TTL_SEC));
  }
  return null;
}

function buildStatus(probeResult = null) {
  const pins = envPins();
  return {
    strategy: 'resident_main_fast_jit_heavy',
    preload: preloadEnabled(),
    pins,
    heavy_ttl_sec: heavyTtlSec(),
    resident_ctx: residentCtx(),
    last_ensure: probeResult,
  };
}

module.exports = {
  DEFAULT_HEAVY_TTL_SEC,
  resolveBaseUrl,
  envPins,
  listModels,
  loadModel,
  ensureResidentModels,
  ttlForTier,
  buildStatus,
  isLoaded,
};
