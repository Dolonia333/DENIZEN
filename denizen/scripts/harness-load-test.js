#!/usr/bin/env node
'use strict';

/**
 * Harness load test (A+ plan S1.6).
 *
 * Simulates an office of N NPCs thinking/chatting through the harness gate
 * for M minutes, then writes a baseline report to reports/harness/.
 *
 * Two drive modes:
 *   --server http://127.0.0.1:8080   POST /api/harness/complete on a running
 *                                    denizen-server (measures the full path
 *                                    incl. the server process). Default if
 *                                    the server responds; else falls back to
 *   direct                           in-process harness.complete() straight
 *                                    at LM Studio (measures inference floor).
 *
 * Usage:
 *   node scripts/harness-load-test.js                 # 30 min, 16 NPCs
 *   node scripts/harness-load-test.js --minutes 5     # quick baseline
 *   node scripts/harness-load-test.js --npcs 16 --minutes 30 --label after-ctx-change
 *
 * Pass/fail asserts (written into the report):
 *   queue bound      — server queueDepth p95 ≤ npcs (never unbounded)
 *   think p95        — ≤ threshold (see DUAL_LOAD_THRESHOLDS)
 *   presence p95     — ≤ threshold
 *   error rate       — ≤ 5%
 *   models dual-load — both FAST-class and MAIN-class ids seen (when dual expected)
 *
 * Dual-load concurrent latency is much higher than single-stream lab targets.
 * Smoke (4 NPC, 1m, direct, Gemma+Qwen27B) saw main p95 ~58s — that is capacity,
 * not a harness break. Thresholds below match dual-load reality on 16GB.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] != null ? args[i + 1] : dflt;
};
const MINUTES = Number(argVal('minutes', 30));
const NPCS = Number(argVal('npcs', 16));
const SERVER = String(argVal('server', 'http://127.0.0.1:8080'));
const LABEL = String(argVal('label', 'baseline'));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'harness');

// Dual-load concurrent budgets (4070 Ti SUPER + Gemma FAST + Qwen 27B MAIN).
// Override: --main-p95-ms 90000 --fast-p95-ms 30000
const MAIN_P95_MS = Number(argVal('main-p95-ms', 90_000));
const FAST_P95_MS = Number(argVal('fast-p95-ms', 30_000));

// Work mix mirrors the real office: mostly ambient thinks on FAST-tier
// pacing, periodic MAIN-tier decisions, occasional chats.
const KINDS = [
  { kind: 'think', tier: 'main', weight: 0.5, maxTokens: 128 },
  { kind: 'presence', tier: 'fast', weight: 0.3, maxTokens: 48 },
  { kind: 'chat', tier: 'main', weight: 0.2, maxTokens: 96 },
];

const NPC_NAMES = [
  'abby', 'bob', 'lucy', 'bouncer', 'marcus', 'sarah', 'edward', 'josh',
  'molly', 'oscar', 'pier', 'rob', 'roki', 'grok', 'claude', 'dan', 'jenny', 'alex',
].slice(0, NPCS);

const PROMPTS = [
  'Pick your next task in one sentence.',
  'Summarize what you are working on in 12 words.',
  'A visitor asks what this office does. Answer in one sentence.',
  'What should the team prioritize this hour? One line.',
  'Report your status to Abby in one short line.',
];

function pickKind() {
  const r = Math.random();
  let acc = 0;
  for (const k of KINDS) {
    acc += k.weight;
    if (r <= acc) return k;
  }
  return KINDS[0];
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function httpJson(method, urlStr, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, json: null, raw: raw.slice(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- pick drive mode ----
  let mode = 'server';
  let harness = null;
  try {
    const h = await httpJson('GET', `${SERVER}/api/health`, null, 5000);
    if (!h.json?.ok) throw new Error('health not ok');
  } catch (_) {
    mode = 'direct';
    const { createDenizenHarness } = require('../src/denizen-harness');
    harness = createDenizenHarness({ denizenRoot: path.join(__dirname, '..') });
  }

  console.log(`[load-test] mode=${mode} npcs=${NPCS} minutes=${MINUTES} label=${LABEL}`);

  const endAt = Date.now() + MINUTES * 60_000;
  const calls = []; // { npc, kind, tier, latencyMs, ok, model }
  const healthSamples = [];

  // Health/queue sampler every 15s (server mode only)
  let samplerTimer = null;
  if (mode === 'server') {
    samplerTimer = setInterval(async () => {
      try {
        const h = await httpJson('GET', `${SERVER}/api/harness`, null, 8000);
        healthSamples.push({
          at: Date.now(),
          queueDepth: h.json?.queueDepth ?? null,
          harnessRate: h.json?.metrics?.harnessRate ?? null,
          mainModelUnloaded: h.json?.metrics?.mainModelUnloaded ?? null,
        });
      } catch (_) {}
    }, 15_000);
  }

  async function completeOnce(npc, spec, prompt) {
    const started = Date.now();
    try {
      if (mode === 'server') {
        const r = await httpJson('POST', `${SERVER}/api/harness/complete`, {
          tier: spec.tier, kind: spec.kind, npc,
          systemPrompt: `You are ${npc}, an office worker. Be brief.`,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: spec.maxTokens,
        });
        const ok = r.status === 200 && !!(r.json?.text || r.json?.ok);
        return { ok, model: r.json?.model || null, latencyMs: Date.now() - started };
      }
      const r = await harness.complete({
        tier: spec.tier, kind: spec.kind, npc,
        systemPrompt: `You are ${npc}, an office worker. Be brief.`,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: spec.maxTokens,
      });
      return { ok: !!r?.text, model: r?.model || null, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, model: null, latencyMs: Date.now() - started, error: err?.message };
    }
  }

  // Each NPC is an independent loop: think, digest 2–6s, repeat.
  async function npcLoop(npc) {
    while (Date.now() < endAt) {
      const spec = pickKind();
      const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
      const r = await completeOnce(npc, spec, prompt);
      calls.push({ npc, kind: spec.kind, tier: spec.tier, ...r });
      if (calls.length % 25 === 0) {
        const okN = calls.filter((c) => c.ok).length;
        console.log(`[load-test] ${calls.length} calls · ok=${okN} · last=${r.latencyMs}ms ${spec.tier}/${spec.kind}`);
      }
      const rest = 2000 + Math.random() * 4000;
      await new Promise((res) => setTimeout(res, rest));
    }
  }

  await Promise.all(NPC_NAMES.map((n) => npcLoop(n)));
  if (samplerTimer) clearInterval(samplerTimer);

  // ---- report ----
  const byTier = {};
  for (const t of ['fast', 'main', 'heavy']) {
    const lat = calls.filter((c) => c.tier === t && c.ok).map((c) => c.latencyMs).sort((a, b) => a - b);
    if (lat.length) {
      byTier[t] = {
        calls: lat.length,
        p50: percentile(lat, 50),
        p95: percentile(lat, 95),
        max: lat[lat.length - 1],
      };
    }
  }
  const okCalls = calls.filter((c) => c.ok).length;
  const errRate = calls.length ? Number(((calls.length - okCalls) / calls.length).toFixed(4)) : null;
  const queueDepths = healthSamples.map((s) => s.queueDepth).filter((q) => q != null).sort((a, b) => a - b);
  const models = [...new Set(calls.map((c) => c.model).filter(Boolean))];

  const sawFast = models.some((m) => /gemma|e2b|3b|8b|mini/i.test(m) && !/14b|27b|32b/i.test(m));
  const sawMain = models.some((m) => /14b|27b|32b|qwen|ministral/i.test(m));
  const asserts = {
    queue_bound: queueDepths.length ? percentile(queueDepths, 95) <= NPCS : null,
    [`main_p95_under_${MAIN_P95_MS}ms`]: byTier.main ? byTier.main.p95 <= MAIN_P95_MS : null,
    [`fast_p95_under_${FAST_P95_MS}ms`]: byTier.fast ? byTier.fast.p95 <= FAST_P95_MS : null,
    error_rate_under_5pct: errRate != null ? errRate <= 0.05 : null,
    // When both tiers were requested, both model classes should appear.
    dual_load_models_seen: (byTier.main && byTier.fast) ? (sawFast && sawMain) : null,
  };
  const pass = Object.values(asserts).every((v) => v !== false);

  const report = {
    label: LABEL,
    at: new Date().toISOString(),
    mode,
    npcs: NPCS,
    minutes: MINUTES,
    totals: { calls: calls.length, ok: okCalls, errorRate: errRate },
    byTier,
    modelsSeen: models,
    queueDepth: queueDepths.length
      ? { p50: percentile(queueDepths, 50), p95: percentile(queueDepths, 95), max: queueDepths[queueDepths.length - 1] }
      : null,
    healthSamples: healthSamples.slice(-20),
    thresholds: { MAIN_P95_MS, FAST_P95_MS },
    asserts,
    pass,
  };

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const base = path.join(OUT_DIR, `${LABEL}-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${base}.md`, [
    `# Harness load test — ${LABEL}`,
    '',
    `- **When:** ${report.at}  ·  **Mode:** ${mode}  ·  **NPCs:** ${NPCS}  ·  **Duration:** ${MINUTES}m`,
    `- **Calls:** ${calls.length} (ok ${okCalls}, error rate ${errRate})`,
    `- **Models seen:** ${models.join(', ') || 'n/a'}`,
    '',
    '| Tier | Calls | p50 | p95 | max |',
    '|------|-------|-----|-----|-----|',
    ...Object.entries(byTier).map(([t, v]) => `| ${t} | ${v.calls} | ${v.p50}ms | ${v.p95}ms | ${v.max}ms |`),
    '',
    report.queueDepth
      ? `**Queue depth:** p50 ${report.queueDepth.p50} · p95 ${report.queueDepth.p95} · max ${report.queueDepth.max}`
      : '**Queue depth:** n/a (direct mode)',
    '',
    '## Asserts',
    ...Object.entries(asserts).map(([k, v]) => `- ${v === false ? '❌' : v === true ? '✅' : '⏭'} ${k}`),
    '',
    `**Overall: ${pass ? 'PASS' : 'FAIL'}**`,
    '',
  ].join('\n'));

  console.log(`[load-test] done — ${calls.length} calls, pass=${pass}`);
  console.log(`[load-test] report: ${base}.md`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[load-test] fatal:', err);
  process.exit(2);
});
