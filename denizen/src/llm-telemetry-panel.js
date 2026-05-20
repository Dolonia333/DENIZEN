/**
 * LLM Telemetry Panel — bottom-left status chip + click-to-expand view.
 *
 * Chip shows live: "⚙ LM p95 8.4s • 42c/5m • 0e"
 *   p95 — 95th-percentile latency in the rolling 5-minute window
 *   c   — total calls in window
 *   e   — error count in window
 *
 * Click the chip → full panel with three tabs:
 *   Calls    — recent LLM calls, filterable by NPC/kind/errors-only
 *   Stats    — aggregate by NPC + provider + kind, top error categories
 *   Errors   — raw error feed with classifier hints
 *
 * Polls /api/telemetry/llm/stats every 5s. Loads /api/telemetry/llm on
 * tab open + on filter change. Read-only — no mutations.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  const STATS_URL  = '/api/telemetry/llm/stats?windowMs=300000';
  const CALLS_URL  = '/api/telemetry/llm';
  const ERRORS_URL = '/api/telemetry/llm/errors';
  const OPENCLAW_URL       = '/api/telemetry/openclaw';
  const OPENCLAW_STATS_URL = '/api/telemetry/openclaw/stats?windowMs=300000';
  const POLL_MS    = 5000;

  const state = {
    open: false,
    tab: 'calls',       // 'calls' | 'stats' | 'errors'
    stats: null,
    calls: [],
    errors: [],
    filterKind: '',
    filterNpc: '',
    filterErrorsOnly: false,
  };

  // ---- styles ----
  function injectStyle() {
    if (document.getElementById('denizen-llm-tel-style')) return;
    const s = document.createElement('style');
    s.id = 'denizen-llm-tel-style';
    s.textContent = `
      #denizen-llm-tel-chip {
        position: fixed; bottom: 14px; left: 160px; z-index: 9999;
        background: rgba(17,24,39,0.92); color: #93c5fd;
        border: 1px solid #1e40af; border-radius: 999px;
        padding: 6px 12px; font: 12px/1.2 monospace; cursor: pointer;
        user-select: none; min-width: 170px; text-align: center;
      }
      #denizen-llm-tel-chip[data-state="busy"] { color: #fde68a; border-color: #b45309; }
      #denizen-llm-tel-chip[data-state="err"]  { color: #fda4af; border-color: #be123c; }
      #denizen-llm-tel-panel {
        position: fixed; bottom: 60px; left: 14px; z-index: 9999;
        width: 540px; max-height: 70vh; overflow: hidden;
        background: rgba(15,23,42,0.97); color: #e2e8f0;
        border: 1px solid #334155; border-radius: 12px;
        font: 12px/1.4 monospace; display: flex; flex-direction: column;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      }
      #denizen-llm-tel-panel header {
        display: flex; gap: 6px; padding: 8px;
        border-bottom: 1px solid #334155;
        background: rgba(30,41,59,0.6);
      }
      #denizen-llm-tel-panel .tab {
        padding: 4px 10px; background: rgba(51,65,85,0.5); color: #cbd5e1;
        border: 1px solid #475569; border-radius: 4px; cursor: pointer;
      }
      #denizen-llm-tel-panel .tab[data-active="true"] { background: #1e40af; color: #fff; border-color: #1e40af; }
      #denizen-llm-tel-panel .body {
        flex: 1 1 auto; overflow-y: auto; padding: 8px; max-height: 60vh;
      }
      #denizen-llm-tel-panel .row {
        border: 1px solid #334155; padding: 6px 8px; margin-bottom: 6px;
        border-radius: 6px; background: rgba(30,41,59,0.4);
      }
      #denizen-llm-tel-panel .row.err   { border-color: #be123c; background: rgba(225,29,72,0.12); }
      #denizen-llm-tel-panel .meta {
        display: flex; gap: 10px; font-size: 11px; color: #94a3b8; margin-bottom: 4px;
      }
      #denizen-llm-tel-panel .meta b { color: #c7d2fe; font-weight: normal; }
      #denizen-llm-tel-panel pre {
        white-space: pre-wrap; margin: 0; color: #cbd5e1;
        font: 11px/1.4 monospace; max-height: 80px; overflow-y: auto;
      }
      #denizen-llm-tel-panel .hint {
        margin-top: 4px; padding: 4px 6px; border-left: 3px solid #fbbf24;
        background: rgba(250,191,36,0.08); color: #fbbf24; font-size: 11px;
      }
      #denizen-llm-tel-panel .filters {
        display: flex; gap: 6px; padding: 6px 8px;
        border-bottom: 1px solid #1e293b;
      }
      #denizen-llm-tel-panel .filters input,
      #denizen-llm-tel-panel .filters select {
        background: #1e293b; color: #e2e8f0; border: 1px solid #475569;
        border-radius: 4px; padding: 3px 6px; font: 11px monospace;
      }
      #denizen-llm-tel-panel .filters label { display: flex; align-items: center; gap: 4px; }
      #denizen-llm-tel-panel .filters button {
        background: #334155; color: #e2e8f0; border: 1px solid #475569;
        border-radius: 4px; padding: 3px 8px; cursor: pointer; font: 11px monospace;
      }
      #denizen-llm-tel-panel .summary {
        padding: 8px; display: grid; grid-template-columns: 1fr 1fr;
        gap: 6px; font-size: 11px;
      }
      #denizen-llm-tel-panel .summary .card {
        background: rgba(30,41,59,0.6); padding: 8px; border-radius: 6px;
        border: 1px solid #334155;
      }
      #denizen-llm-tel-panel .summary .card h4 {
        margin: 0 0 4px 0; font-size: 11px; color: #93c5fd;
      }
    `;
    document.head.appendChild(s);
  }

  // ---- chip ----
  function ensureChip() {
    let chip = document.getElementById('denizen-llm-tel-chip');
    if (chip) return chip;
    chip = document.createElement('button');
    chip.id = 'denizen-llm-tel-chip';
    chip.type = 'button';
    chip.title = 'LM Studio + provider telemetry (click for details)';
    chip.textContent = '⚙ LM …';
    chip.addEventListener('click', togglePanel);
    document.body.appendChild(chip);
    return chip;
  }
  function paintChip() {
    const chip = ensureChip();
    const s = state.stats;
    if (!s) { chip.textContent = '⚙ LM …'; return; }
    const p95 = s.p95LatencyMs != null ? (s.p95LatencyMs / 1000).toFixed(1) + 's' : '—';
    const e = s.errors || 0;
    chip.textContent = `⚙ LM p95 ${p95} • ${s.calls}c/5m • ${e}e`;
    chip.dataset.state = e > 0 ? 'err' : (s.calls > 0 ? 'busy' : '');
  }

  // ---- panel ----
  function ensurePanel() {
    let panel = document.getElementById('denizen-llm-tel-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'denizen-llm-tel-panel';
    panel.innerHTML = `
      <header>
        <button class="tab" data-tab="calls">Calls</button>
        <button class="tab" data-tab="stats">Stats</button>
        <button class="tab" data-tab="errors">Errors</button>
        <button class="tab" data-tab="openclaw">OpenClaw</button>
        <span style="flex:1"></span>
        <button class="tab" data-action="close">✕</button>
      </header>
      <div class="filters" data-section="calls">
        <input data-filter="npc" placeholder="npc (e.g. Lucy)" style="width:120px"/>
        <select data-filter="kind">
          <option value="">all kinds</option>
          <option>think</option>
          <option>chat</option>
          <option>response</option>
          <option>response-fallback</option>
          <option>email</option>
          <option>goal</option>
          <option>other</option>
        </select>
        <label><input type="checkbox" data-filter="errorsOnly"/> errors only</label>
        <button data-action="refresh">↻</button>
      </div>
      <div class="body" data-section="body">loading…</div>
    `;
    document.body.appendChild(panel);
    // Wire interactions
    panel.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => {
        const action = b.dataset.action;
        if (action === 'close') { state.open = false; renderPanel(); return; }
        state.tab = b.dataset.tab || state.tab;
        loadTab();
      });
    });
    panel.querySelector('[data-filter="npc"]').addEventListener('input', (e) => {
      state.filterNpc = e.target.value.trim();
    });
    panel.querySelector('[data-filter="kind"]').addEventListener('change', (e) => {
      state.filterKind = e.target.value;
      loadTab();
    });
    panel.querySelector('[data-filter="errorsOnly"]').addEventListener('change', (e) => {
      state.filterErrorsOnly = !!e.target.checked;
      loadTab();
    });
    panel.querySelector('[data-action="refresh"]').addEventListener('click', loadTab);
    return panel;
  }
  function renderPanel() {
    const panel = ensurePanel();
    panel.style.display = state.open ? 'flex' : 'none';
    panel.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.dataset.active = (t.dataset.tab === state.tab).toString();
    });
    const filtersDiv = panel.querySelector('.filters');
    filtersDiv.style.display = state.tab === 'calls' ? 'flex' : 'none';
  }
  function togglePanel() {
    state.open = !state.open;
    renderPanel();
    if (state.open) loadTab();
  }

  // ---- tab content ----
  async function loadTab() {
    renderPanel();
    if (!state.open) return;
    const body = document.querySelector('#denizen-llm-tel-panel .body');
    body.textContent = 'loading…';

    try {
      if (state.tab === 'calls') {
        const qs = new URLSearchParams();
        qs.set('limit', '50');
        if (state.filterKind) qs.set('kind', state.filterKind);
        if (state.filterNpc) qs.set('npc', state.filterNpc);
        if (state.filterErrorsOnly) qs.set('errorsOnly', 'true');
        const r = await fetch(`${CALLS_URL}?${qs.toString()}`);
        const j = await r.json();
        state.calls = j.calls || [];
        body.innerHTML = state.calls.length === 0
          ? '<div style="padding:12px; color:#94a3b8">No calls yet.</div>'
          : state.calls.map(renderCallRow).join('');
      } else if (state.tab === 'stats') {
        const r = await fetch(STATS_URL);
        state.stats = await r.json();
        body.innerHTML = renderStats(state.stats);
      } else if (state.tab === 'errors') {
        const r = await fetch(ERRORS_URL);
        const j = await r.json();
        state.errors = j.errors || [];
        body.innerHTML = state.errors.length === 0
          ? '<div style="padding:12px; color:#94a3b8">No errors. 🎉</div>'
          : state.errors.map(renderErrorRow).join('');
      } else if (state.tab === 'openclaw') {
        const [eventsRes, statsRes] = await Promise.all([
          fetch(OPENCLAW_URL).then(r => r.json()),
          fetch(OPENCLAW_STATS_URL).then(r => r.json()),
        ]);
        const events = eventsRes.events || [];
        body.innerHTML = renderOpenClaw(events, statsRes);
      }
    } catch (err) {
      body.textContent = 'failed to load: ' + (err?.message || err);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtTokens(tIn, tOut) {
    if (tIn == null && tOut == null) return '—';
    return `${tIn || 0}→${tOut || 0}`;
  }
  function fmtRel(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  function renderCallRow(c) {
    const lat = c.latencyMs != null ? Math.round(c.latencyMs) + 'ms' : '—';
    const isErr = !!c.error;
    const ratio = (c.tokensIn != null && c.tokensOut > 0) ? (c.tokensIn / c.tokensOut).toFixed(0) + ':1' : '';
    const convo = c.conversationMsgs != null ? `${c.conversationMsgs} msgs` : '';
    return `<div class="row ${isErr ? 'err' : ''}">
      <div class="meta">
        <span><b>${esc(c.npc || '?')}</b></span>
        <span>${esc(c.kind)}</span>
        <span>${esc(c.provider || '?')} ${esc(c.model || '')}</span>
        <span>${lat}</span>
        <span>${fmtTokens(c.tokensIn, c.tokensOut)} tok${ratio ? ' · ' + ratio : ''}</span>
        ${convo ? `<span>${convo}</span>` : ''}
        <span style="margin-left:auto">${fmtRel(c.at)}</span>
      </div>
      ${c.promptPreview ? `<pre>→ ${esc(c.promptPreview)}</pre>` : ''}
      ${c.responsePreview ? `<pre style="color:#86efac">← ${esc(c.responsePreview)}</pre>` : ''}
      ${isErr ? `<pre style="color:#fda4af">⚠ [${esc(c.error.category)}] ${esc(c.error.message)}</pre>
                  <div class="hint">${esc(c.error.hint)}</div>` : ''}
    </div>`;
  }

  function renderErrorRow(c) {
    return `<div class="row err">
      <div class="meta">
        <span><b>${esc(c.npc || '?')}</b></span>
        <span>${esc(c.kind)} / ${esc(c.provider || '?')}</span>
        <span style="margin-left:auto">${fmtRel(c.at)}</span>
      </div>
      <pre style="color:#fda4af">⚠ [${esc(c.error.category)}] ${esc(c.error.message)}</pre>
      <div class="hint">${esc(c.error.hint)}</div>
    </div>`;
  }

  function renderOpenClaw(events, stats) {
    const head = stats && stats.runs > 0 ? `
      <div class="summary" style="grid-template-columns:1fr">
        <div class="card"><h4>Window: 5 min</h4>
          <div>runs: <b>${stats.runs}</b> · started ${stats.started} · ✓ ${stats.succeeded} · ✗ ${stats.failed}</div>
          <div>latency (completed): p50 ${stats.p50LatencyMs ? (stats.p50LatencyMs/1000).toFixed(2)+'s' : '—'} · p95 ${stats.p95LatencyMs ? (stats.p95LatencyMs/1000).toFixed(2)+'s' : '—'}</div>
          <div>by tool: ${Object.entries(stats.byTool || {}).map(([t, b]) => `${esc(t)} (✓${b.succeeded||0}/✗${b.failed||0})`).join(' · ') || '(none)'}</div>
        </div>
      </div>` : `<div style="padding:12px; color:#94a3b8">No OpenClaw runs in the last 5 min.</div>`;
    const list = events.length === 0
      ? ''
      : events.map(e => {
          const status = e._ocStatus || '?';
          const dot = status === 'succeeded' ? '#86efac' : status === 'failed' ? '#fda4af' : '#fde68a';
          return `<div class="row ${status === 'failed' || e.error ? 'err' : ''}">
            <div class="meta">
              <span style="color:${dot}">●</span>
              <span><b>${esc(e.model || 'tool')}</b></span>
              <span>${esc(e.provider || 'openclaw')}</span>
              <span>${status}</span>
              ${e.latencyMs != null ? `<span>${Math.round(e.latencyMs)}ms</span>` : ''}
              <span style="margin-left:auto">${fmtRel(e.at)}</span>
            </div>
            ${e.promptPreview ? `<pre>→ ${esc(e.promptPreview)}</pre>` : ''}
            ${e.responsePreview ? `<pre style="color:#86efac">← ${esc(e.responsePreview)}</pre>` : ''}
            ${e.error ? `<pre style="color:#fda4af">⚠ ${esc(e.error.message)}</pre>` : ''}
          </div>`;
        }).join('');
    return head + list;
  }

  function renderStats(s) {
    if (!s || s.calls === 0) {
      return '<div style="padding:12px; color:#94a3b8">No telemetry in the last 5 minutes.</div>';
    }
    const ms = (n) => n == null ? '—' : (n / 1000).toFixed(2) + 's';
    const byTable = (obj, title) => {
      const rows = Object.entries(obj).sort((a, b) => b[1].calls - a[1].calls);
      if (!rows.length) return `<div class="card"><h4>${title}</h4>(none)</div>`;
      return `<div class="card"><h4>${title}</h4>
        ${rows.map(([k, v]) =>
          `<div>${esc(k)}: ${v.calls}c · ${v.avgLatencyMs != null ? Math.round(v.avgLatencyMs) + 'ms' : '—'} · ${v.tokensIn + v.tokensOut} tok${v.errors ? ` · <span style="color:#fda4af">${v.errors}e</span>` : ''}</div>`
        ).join('')}
      </div>`;
    };
    const topErr = s.topErrors?.length
      ? s.topErrors.map(e =>
          `<div><b>${esc(e.category)}</b> ×${e.count}<br/><span style="color:#fbbf24">${esc(e.hint)}</span></div>`
        ).join('<hr style="border:0; border-top:1px solid #334155; margin:4px 0"/>')
      : '(none — clean)';

    const ratioColor = s.promptToCompletionRatio != null && s.promptToCompletionRatio > 20 ? '#fda4af'
                     : s.promptToCompletionRatio != null && s.promptToCompletionRatio > 10 ? '#fbbf24'
                     : '#86efac';
    const convoColor = s.maxConversationMsgs != null && s.maxConversationMsgs > 40 ? '#fda4af'
                     : s.maxConversationMsgs != null && s.maxConversationMsgs > 20 ? '#fbbf24'
                     : '#cbd5e1';
    return `<div class="summary">
      <div class="card"><h4>Window: 5 min</h4>
        <div>calls: <b>${s.calls}</b> (${s.callsPerMin}/min) · errors: ${s.errors} (${(s.errorRate * 100).toFixed(1)}%)</div>
        <div>latency: p50 ${ms(s.p50LatencyMs)} · p95 ${ms(s.p95LatencyMs)} · p99 ${ms(s.p99LatencyMs)}</div>
        <div>tokens: ${s.tokensInTotal}↑ ${s.tokensOutTotal}↓ · ${s.tokensPerMin}/min</div>
        ${s.promptToCompletionRatio != null
          ? `<div>prompt:completion ratio: <b style="color:${ratioColor}">${s.promptToCompletionRatio}:1</b>${s.promptToCompletionRatio > 20 ? ' — most cost is rebuilding context' : ''}</div>`
          : ''}
        ${s.avgConversationMsgs != null
          ? `<div>convo depth: avg ${s.avgConversationMsgs} · <b style="color:${convoColor}">max ${s.maxConversationMsgs}</b>${s.maxConversationMsgs > 40 ? ' — trim history?' : ''}</div>`
          : ''}
      </div>
      <div class="card"><h4>Top errors</h4>${topErr}</div>
      ${byTable(s.byNpc, 'By NPC')}
      ${byTable(s.byProvider, 'By provider')}
      ${byTable(s.byKind, 'By kind')}
    </div>`;
  }

  // ---- poll ----
  async function pollStats() {
    try {
      const r = await fetch(STATS_URL, { cache: 'no-store' });
      if (r.ok) state.stats = await r.json();
      paintChip();
      // If panel open on stats tab, refresh contents too.
      if (state.open && state.tab === 'stats') {
        document.querySelector('#denizen-llm-tel-panel .body').innerHTML = renderStats(state.stats);
      }
    } catch (_) { /* server may be restarting */ }
  }

  function boot() {
    injectStyle();
    ensureChip();
    ensurePanel();
    renderPanel();
    paintChip();
    pollStats();
    setInterval(pollStats, POLL_MS);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
