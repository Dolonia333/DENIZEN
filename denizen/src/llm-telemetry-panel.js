/**
 * LLM Telemetry Panel — bottom-left status chip + click-to-expand view.
 *
 * Chip shows live: "⚙ LM p95 8.4s • 42c/5m • 0e"
 *   p95 — 95th-percentile latency in the selected window
 *   c   — total calls in window
 *   e   — error count in window
 *
 * Click the chip → full panel with four tabs:
 *   Calls    — recent LLM calls, filterable by NPC/kind/provider/errors-only
 *   Stats    — aggregate by NPC + provider + kind, decisions, PC activity, active state
 *   Errors   — raw error feed with classifier hints
 *   OpenClaw — OpenClaw skill run history
 *
 * Time window (applies to all tabs):
 *   5m | 1h | 6h | 24h | 7d | all
 *
 * Sort (Calls tab): newest | slowest
 *
 * CSV export (Calls tab): downloads visible calls as CSV.
 *
 * Polls /api/telemetry/llm/stats every 5s. Read-only — no mutations.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  // ---- URL helpers ----
  function statsUrl(windowMs)      { return `/api/telemetry/llm/stats?windowMs=${windowMs}`; }
  function callsUrl(qs)            { return `/api/telemetry/llm?${qs}`; }
  function errorsUrl()             { return '/api/telemetry/llm/errors'; }
  function openclawUrl()           { return '/api/telemetry/openclaw'; }
  function openclawStatsUrl(w)     { return `/api/telemetry/openclaw/stats?windowMs=${w}`; }
  function decisionsUrl(w)         { return `/api/telemetry/llm/decisions?windowMs=${w}`; }
  function pcStatsUrl(w)           { return `/api/pc-activity/stats?windowMs=${w}`; }
  function pcActiveUrl()           { return '/api/pc-activity/active'; }
  function pcRecentUrl()           { return '/api/pc-activity?limit=8'; }
  function taskChainsUrl()         { return '/api/task-chains'; }
  function proposalsUrl()          { return '/api/proposals?status=pending'; }

  const POLL_MS = 5000;

  // Window options: label → ms value (0 = "all time")
  const WINDOWS = [
    { label: '5m',  ms: 5 * 60 * 1000 },
    { label: '1h',  ms: 60 * 60 * 1000 },
    { label: '6h',  ms: 6 * 60 * 60 * 1000 },
    { label: '24h', ms: 24 * 60 * 60 * 1000 },
    { label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
    { label: 'all', ms: 0 },
  ];

  const PROVIDERS = ['lmstudio', 'anthropic', 'grok', 'gemini', 'moonshot', 'kimi', 'openai'];

  const state = {
    open: false,
    tab: 'calls',
    windowMs: 5 * 60 * 1000,   // current time window selection
    stats: null,
    calls: [],
    errors: [],
    decisions: null,
    pcStats: null,
    pcActive: [],
    pcRecent: [],
    active: null,
    filterKind: '',
    filterNpc: '',
    filterProvider: '',
    filterErrorsOnly: false,
    filterSort: 'newest',
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
        width: 580px; max-height: 75vh; overflow: hidden;
        background: rgba(15,23,42,0.97); color: #e2e8f0;
        border: 1px solid #334155; border-radius: 12px;
        font: 12px/1.4 monospace; display: flex; flex-direction: column;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      }
      #denizen-llm-tel-panel header {
        display: flex; gap: 4px; padding: 8px;
        border-bottom: 1px solid #334155;
        background: rgba(30,41,59,0.6);
        flex-wrap: wrap;
      }
      #denizen-llm-tel-panel .tab {
        padding: 4px 10px; background: rgba(51,65,85,0.5); color: #cbd5e1;
        border: 1px solid #475569; border-radius: 4px; cursor: pointer;
      }
      #denizen-llm-tel-panel .tab[data-active="true"] { background: #1e40af; color: #fff; border-color: #1e40af; }
      #denizen-llm-tel-panel .win-btn {
        padding: 3px 7px; background: rgba(51,65,85,0.4); color: #94a3b8;
        border: 1px solid #334155; border-radius: 3px; cursor: pointer;
        font: 11px monospace;
      }
      #denizen-llm-tel-panel .win-btn[data-active="true"] { background: #0f3460; color: #93c5fd; border-color: #1e40af; }
      #denizen-llm-tel-panel .body {
        flex: 1 1 auto; overflow-y: auto; padding: 8px; max-height: calc(75vh - 120px);
      }
      #denizen-llm-tel-panel .row {
        border: 1px solid #334155; padding: 6px 8px; margin-bottom: 6px;
        border-radius: 6px; background: rgba(30,41,59,0.4);
      }
      #denizen-llm-tel-panel .row.err   { border-color: #be123c; background: rgba(225,29,72,0.12); }
      #denizen-llm-tel-panel .meta {
        display: flex; gap: 10px; font-size: 11px; color: #94a3b8; margin-bottom: 4px;
        flex-wrap: wrap;
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
        display: flex; gap: 5px; padding: 6px 8px;
        border-bottom: 1px solid #1e293b; flex-wrap: wrap; align-items: center;
      }
      #denizen-llm-tel-panel .filters input,
      #denizen-llm-tel-panel .filters select {
        background: #1e293b; color: #e2e8f0; border: 1px solid #475569;
        border-radius: 4px; padding: 3px 6px; font: 11px monospace;
      }
      #denizen-llm-tel-panel .filters label { display: flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 11px; }
      #denizen-llm-tel-panel .filters button {
        background: #334155; color: #e2e8f0; border: 1px solid #475569;
        border-radius: 4px; padding: 3px 8px; cursor: pointer; font: 11px monospace;
      }
      #denizen-llm-tel-panel .filters button:hover { background: #475569; }
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
      #denizen-llm-tel-panel .prov-chip {
        display: inline-block; padding: 2px 6px; border-radius: 3px;
        font-size: 10px; font-weight: bold; margin-right: 3px;
      }
      #denizen-llm-tel-panel .win-row {
        display: flex; gap: 3px; align-items: center; flex-wrap: wrap;
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
    const winLabel = WINDOWS.find(w => w.ms === state.windowMs)?.label || '?';
    chip.textContent = `⚙ LM p95 ${p95} • ${s.calls}c/${winLabel} • ${e}e`;
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
        <div class="win-row" id="tel-win-row"></div>
        <button class="tab" data-action="close">✕</button>
      </header>
      <div class="filters" data-section="calls">
        <input data-filter="npc" placeholder="npc filter" style="width:100px"/>
        <select data-filter="kind">
          <option value="">all kinds</option>
          <option>think</option>
          <option>chat</option>
          <option>response</option>
          <option>response-fallback</option>
          <option>email</option>
          <option>goal</option>
          <option>plan</option>
          <option>reflection</option>
          <option>other</option>
        </select>
        <select data-filter="provider">
          <option value="">all providers</option>
          <option value="lmstudio">lmstudio</option>
          <option value="anthropic">claude</option>
          <option value="kimi">kimi</option>
          <option value="grok">grok</option>
          <option value="gemini">gemini</option>
          <option value="moonshot">moonshot</option>
        </select>
        <select data-filter="sort">
          <option value="newest">newest</option>
          <option value="slowest">slowest</option>
        </select>
        <label><input type="checkbox" data-filter="errorsOnly"/> errors</label>
        <button data-action="refresh">↻</button>
        <button data-action="export">⬇ CSV</button>
      </div>
      <div class="body" data-section="body">loading…</div>
    `;
    document.body.appendChild(panel);

    // Wire tabs / close
    panel.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => {
        const action = b.dataset.action;
        if (action === 'close') { state.open = false; renderPanel(); return; }
        state.tab = b.dataset.tab || state.tab;
        loadTab();
      });
    });

    // Wire filters
    panel.querySelector('[data-filter="npc"]').addEventListener('input', (e) => {
      state.filterNpc = e.target.value.trim();
    });
    panel.querySelector('[data-filter="kind"]').addEventListener('change', (e) => {
      state.filterKind = e.target.value;
      loadTab();
    });
    panel.querySelector('[data-filter="provider"]').addEventListener('change', (e) => {
      state.filterProvider = e.target.value;
      loadTab();
    });
    panel.querySelector('[data-filter="sort"]').addEventListener('change', (e) => {
      state.filterSort = e.target.value;
      loadTab();
    });
    panel.querySelector('[data-filter="errorsOnly"]').addEventListener('change', (e) => {
      state.filterErrorsOnly = !!e.target.checked;
      loadTab();
    });
    panel.querySelector('[data-action="refresh"]').addEventListener('click', loadTab);
    panel.querySelector('[data-action="export"]').addEventListener('click', exportCsv);

    // Build time-window buttons
    buildWindowButtons(panel);

    return panel;
  }

  function buildWindowButtons(panel) {
    const row = panel.querySelector('#tel-win-row');
    if (!row) return;
    row.innerHTML = '';
    WINDOWS.forEach(w => {
      const btn = document.createElement('button');
      btn.className = 'win-btn';
      btn.textContent = w.label;
      btn.dataset.ms = w.ms;
      btn.dataset.active = (w.ms === state.windowMs).toString();
      btn.addEventListener('click', () => {
        state.windowMs = w.ms;
        // Update all buttons
        panel.querySelectorAll('.win-btn').forEach(b => {
          b.dataset.active = (Number(b.dataset.ms) === state.windowMs).toString();
        });
        // Reload everything
        pollStats();
        if (state.open) loadTab();
      });
      row.appendChild(btn);
    });
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

  // ---- CSV export ----
  function exportCsv() {
    if (!state.calls.length) return;
    const header = ['time', 'npc', 'kind', 'provider', 'model', 'latencyMs', 'tokensIn', 'tokensOut', 'conversationMsgs', 'error'];
    const rows = state.calls.map(c => [
      c.at, c.npc || '', c.kind || '', c.provider || '', c.model || '',
      c.latencyMs ?? '', c.tokensIn ?? '', c.tokensOut ?? '',
      c.conversationMsgs ?? '',
      c.error ? `[${c.error.category}] ${c.error.message}` : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `denizen-telemetry-${new Date().toISOString().slice(0,16).replace('T','-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- helpers shared across tabs ----

  /** Effective sinceMs for the calls endpoint (0 = don't filter). */
  function effectiveSinceMs() { return state.windowMs || null; }

  /**
   * Fetch every data slice the Stats tab needs in parallel.
   */
  async function loadStatsBundle() {
    const w = state.windowMs || 7 * 24 * 60 * 60 * 1000; // "all" → 7 days for stats
    const safe = (url, fallback) =>
      fetch(url, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : fallback)
        .catch(() => fallback);
    const [stats, decisions, pcStats, pcActive, pcRecent, chains, proposals] = await Promise.all([
      safe(statsUrl(w), null),
      safe(decisionsUrl(w), { actions: {}, skills: {}, total: 0 }),
      safe(pcStatsUrl(w), { total: 0, byKind: {}, byNpc: {}, byStatus: {} }),
      safe(pcActiveUrl(), { active: [] }),
      safe(pcRecentUrl(), { events: [] }),
      safe(taskChainsUrl(), { chains: [] }),
      safe(proposalsUrl(), { proposals: [] }),
    ]);
    state.stats     = stats;
    state.decisions = decisions;
    state.pcStats   = pcStats;
    state.pcActive  = pcActive.active || [];
    state.pcRecent  = pcRecent.events || [];
    state.active    = {
      chains:    Array.isArray(chains.chains) ? chains.chains : [],
      proposals: Array.isArray(proposals.proposals) ? proposals.proposals : [],
    };
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
        qs.set('limit', '100');
        if (state.filterKind)     qs.set('kind',       state.filterKind);
        if (state.filterNpc)      qs.set('npc',        state.filterNpc);
        if (state.filterProvider) qs.set('provider',   state.filterProvider);
        if (state.filterSort)     qs.set('sort',       state.filterSort);
        if (state.filterErrorsOnly) qs.set('errorsOnly', 'true');
        const sinceMs = effectiveSinceMs();
        if (sinceMs) qs.set('sinceMs', sinceMs);
        const r = await fetch(callsUrl(qs.toString()), { cache: 'no-store' });
        const j = await r.json();
        state.calls = j.calls || [];
        body.innerHTML = state.calls.length === 0
          ? `<div style="padding:12px; color:#94a3b8">No calls in the last ${winLabel()}.</div>`
          : state.calls.map(renderCallRow).join('');
      } else if (state.tab === 'stats') {
        await loadStatsBundle();
        body.innerHTML = renderStats(state.stats);
      } else if (state.tab === 'errors') {
        const r = await fetch(errorsUrl(), { cache: 'no-store' });
        const j = await r.json();
        state.errors = j.errors || [];
        body.innerHTML = state.errors.length === 0
          ? '<div style="padding:12px; color:#94a3b8">No errors. 🎉</div>'
          : state.errors.map(renderErrorRow).join('');
      } else if (state.tab === 'openclaw') {
        const w = state.windowMs || 7 * 24 * 60 * 60 * 1000;
        const [eventsRes, statsRes] = await Promise.all([
          fetch(openclawUrl(), { cache: 'no-store' }).then(r => r.json()),
          fetch(openclawStatsUrl(w), { cache: 'no-store' }).then(r => r.json()),
        ]);
        const events = eventsRes.events || [];
        body.innerHTML = renderOpenClaw(events, statsRes);
      }
    } catch (err) {
      body.textContent = 'failed to load: ' + (err?.message || err);
    }
  }

  function winLabel() {
    return WINDOWS.find(w => w.ms === state.windowMs)?.label || '?';
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
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  // Provider → color mapping for chips
  const PROV_COLORS = {
    anthropic: '#7c3aed',
    lmstudio:  '#0e7490',
    kimi:      '#065f46',
    grok:      '#1d4ed8',
    gemini:    '#7c2d12',
    moonshot:  '#4c1d95',
    google:    '#7c2d12',
    openai:    '#065f46',
  };
  function provChip(provider) {
    const color = PROV_COLORS[provider] || '#475569';
    return `<span class="prov-chip" style="background:${color}aa; border:1px solid ${color}">${esc(provider || '?')}</span>`;
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
        ${provChip(c.provider)}
        <span style="font-size:10px; color:#64748b">${esc(c.model || '')}</span>
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
        <span>${esc(c.kind)} / </span>
        ${provChip(c.provider)}
        <span style="margin-left:auto">${fmtRel(c.at)}</span>
      </div>
      <pre style="color:#fda4af">⚠ [${esc(c.error.category)}] ${esc(c.error.message)}</pre>
      <div class="hint">${esc(c.error.hint)}</div>
    </div>`;
  }

  function renderOpenClaw(events, stats) {
    const winLbl = winLabel();
    const head = stats && stats.runs > 0 ? `
      <div class="summary" style="grid-template-columns:1fr">
        <div class="card"><h4>Window: ${esc(winLbl)}</h4>
          <div>runs: <b>${stats.runs}</b> · started ${stats.started} · ✓ ${stats.succeeded} · ✗ ${stats.failed}</div>
          <div>latency (completed): p50 ${stats.p50LatencyMs ? (stats.p50LatencyMs/1000).toFixed(2)+'s' : '—'} · p95 ${stats.p95LatencyMs ? (stats.p95LatencyMs/1000).toFixed(2)+'s' : '—'}</div>
          <div>by tool: ${Object.entries(stats.byTool || {}).map(([t, b]) => `${esc(t)} (✓${b.succeeded||0}/✗${b.failed||0})`).join(' · ') || '(none)'}</div>
        </div>
      </div>` : `<div style="padding:12px; color:#94a3b8">No OpenClaw runs in the last ${esc(winLbl)}.</div>`;
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

  // Kind labels — map internal kind names to readable descriptions
  const KIND_LABELS = {
    think:              '🧠 think — NPC decides next action',
    response:           '💬 response — NPC replies to player',
    chat:               '💬 chat — NPC conversation',
    email:              '📧 email — NPC sends/reads email',
    goal:               '🎯 goal — NPC sets a new goal',
    plan:               '📋 plan — NPC builds a plan',
    reflection:         '🪞 reflection — NPC reflects on memory',
    'city-plan':        '🏙 city-plan — world event planning',
    'response-fallback':'⚡ response-fallback — fast fallback reply',
    openclaw:           '🔧 openclaw — tool/code execution',
    other:              '❓ other — untagged call',
  };

  function renderStats(s) {
    const win = winLabel();
    if (!s || s.calls === 0) {
      return `<div style="padding:12px; color:#94a3b8">No telemetry in the last ${win}.</div>` +
             renderDecisions() + renderPcActivity() + renderActiveState();
    }
    const ms  = (n) => n == null ? '—' : (n / 1000).toFixed(2) + 's';
    const tok = (n) => n == null ? '—' : n.toLocaleString();

    // ── By-NPC / By-provider / By-kind table ─────────────────────────────
    const byTable = (obj, title, labelMap) => {
      const rows = Object.entries(obj).sort((a, b) => b[1].calls - a[1].calls);
      if (!rows.length) return `<div class="card"><h4>${title}</h4><div style="color:#94a3b8">(none)</div></div>`;
      return `<div class="card">
        <h4>${title}</h4>
        <div style="color:#64748b; font-size:10px; margin-bottom:4px">calls · avg latency · total tokens sent+received</div>
        ${rows.map(([k, v]) => {
          const label = labelMap ? (labelMap[k] || k) : k;
          const totalTok = (v.tokensIn || 0) + (v.tokensOut || 0);
          const latStr = v.avgLatencyMs != null ? (v.avgLatencyMs / 1000).toFixed(2) + 's avg' : '—';
          const errBadge = v.errors ? `<span style="color:#fda4af; margin-left:4px">${v.errors} error${v.errors > 1 ? 's' : ''}</span>` : '';
          const unknownNote = k === 'unknown' ? `<span style="color:#fbbf24; font-size:10px"> (untagged)</span>` : '';
          const provColor = PROV_COLORS[k] || null;
          const provDot = provColor ? `<span style="color:${provColor}; margin-right:3px">●</span>` : '';
          return `<div style="padding:3px 0; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:baseline">
            <span>${provDot}<b style="color:#c7d2fe">${esc(label)}</b>${unknownNote}${errBadge}</span>
            <span style="color:#94a3b8">${v.calls} call${v.calls !== 1 ? 's' : ''} · ${latStr} · ${tok(totalTok)} tok</span>
          </div>`;
        }).join('')}
      </div>`;
    };

    // ── Top errors ─────────────────────────────────────────────────────────
    const topErr = s.topErrors?.length
      ? s.topErrors.map(e =>
          `<div style="margin-bottom:6px">
            <b style="color:#fda4af">${esc(e.category)}</b> <span style="color:#94a3b8">×${e.count}</span><br/>
            <span style="color:#fbbf24; font-size:10px">${esc(e.hint)}</span>
          </div>`
        ).join('')
      : '<span style="color:#86efac">✓ No errors</span>';

    // ── Color thresholds ───────────────────────────────────────────────────
    const ratioColor = s.promptToCompletionRatio > 20 ? '#fda4af'
                     : s.promptToCompletionRatio > 10 ? '#fbbf24' : '#86efac';
    const ratioTip   = s.promptToCompletionRatio > 20
      ? ' — high: you\'re paying mostly to re-send context'
      : s.promptToCompletionRatio > 10 ? ' — moderate' : ' — efficient';

    const convoColor = s.maxConversationMsgs > 40 ? '#fda4af'
                     : s.maxConversationMsgs > 20 ? '#fbbf24' : '#cbd5e1';
    const errColor   = s.errorRate > 0.1 ? '#fda4af' : s.errorRate > 0 ? '#fbbf24' : '#86efac';

    // ── Throughput bar ─────────────────────────────────────────────────────
    const cpm = s.callsPerMin || 0;
    const barPct = Math.min(100, (cpm / 10) * 100);
    const barColor = cpm > 8 ? '#fda4af' : cpm > 4 ? '#fbbf24' : '#4ade80';
    const throughputBar = `
      <div style="margin-top:4px">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b; margin-bottom:2px">
          <span>throughput (calls/min)</span><span>${cpm}/min</span>
        </div>
        <div style="background:#1e293b; border-radius:4px; height:6px; overflow:hidden">
          <div style="width:${barPct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.5s"></div>
        </div>
      </div>`;

    return `<div class="summary">
      <!-- Overview card -->
      <div class="card" style="grid-column:1/-1">
        <h4>📊 Last ${esc(win)} — what happened</h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px">
          <div>
            <div><span style="color:#64748b">Calls:</span> <b>${s.calls}</b> total <span style="color:#64748b">(${s.callsPerMin}/min)</span></div>
            <div><span style="color:#64748b">Errors:</span> <b style="color:${errColor}">${s.errors}</b> <span style="color:#64748b">(${(s.errorRate * 100).toFixed(1)}%)</span></div>
            ${throughputBar}
          </div>
          <div>
            <div><span style="color:#64748b">Latency p50:</span> ${ms(s.p50LatencyMs)} <span style="color:#64748b">typical</span></div>
            <div><span style="color:#64748b">Latency p95:</span> ${ms(s.p95LatencyMs)} <span style="color:#64748b">slow tail</span></div>
            <div><span style="color:#64748b">Latency p99:</span> ${ms(s.p99LatencyMs)} <span style="color:#64748b">worst</span></div>
          </div>
        </div>
        <div style="margin-top:6px; border-top:1px solid #1e293b; padding-top:6px">
          <div><span style="color:#64748b">Tokens sent (↑ prompt):</span> <b>${tok(s.tokensInTotal)}</b></div>
          <div><span style="color:#64748b">Tokens received (↓ output):</span> <b>${tok(s.tokensOutTotal)}</b> <span style="color:#64748b">${s.tokensPerMin}/min total</span></div>
          ${s.promptToCompletionRatio != null
            ? `<div><span style="color:#64748b">Prompt:output ratio:</span> <b style="color:${ratioColor}">${s.promptToCompletionRatio}:1</b><span style="color:${ratioColor}; font-size:10px">${ratioTip}</span></div>`
            : ''}
          ${s.avgConversationMsgs != null
            ? `<div><span style="color:#64748b">History depth:</span> avg ${s.avgConversationMsgs} msgs · max <b style="color:${convoColor}">${s.maxConversationMsgs}</b> msgs per call${s.maxConversationMsgs > 40 ? ' <span style="color:#fda4af; font-size:10px">— trim history</span>' : ''}</div>`
            : ''}
        </div>
      </div>

      <!-- Top errors -->
      <div class="card"><h4>⚠ Top errors</h4>${topErr}</div>

      <!-- By NPC -->
      ${byTable(s.byNpc, '🤖 By NPC — who\'s calling the model', null)}

      <!-- By provider -->
      ${byTable(s.byProvider, '🌐 By provider', null)}

      <!-- By kind -->
      ${byTable(s.byKind, '🏷 By call type', KIND_LABELS)}

    </div>` + renderDecisions() + renderPcActivity() + renderActiveState();
  }

  // ── Decisions histogram ──────────────────────────────────────────────────
  function renderDecisions() {
    const d = state.decisions;
    if (!d || d.total === 0) {
      return `<div class="summary"><div class="card" style="grid-column:1/-1">
        <h4>🎯 What NPCs decided (${winLabel()})</h4>
        <div style="color:#94a3b8">No decision data yet — NPCs haven't finished a think cycle.</div>
      </div></div>`;
    }
    const bar = (label, count, total, color) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `<div style="margin-bottom:4px">
        <div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:1px">
          <span style="color:#c7d2fe">${esc(label)}</span>
          <span style="color:#94a3b8">${count} (${pct}%)</span>
        </div>
        <div style="background:#1e293b; border-radius:3px; height:5px">
          <div style="width:${pct}%; height:100%; background:${color}; border-radius:3px"></div>
        </div>
      </div>`;
    };
    const ACTION_COLORS = { walk: '#4ade80', talk: '#60a5fa', sit: '#a78bfa', work: '#fbbf24', run_skill: '#f97316', idle: '#94a3b8' };
    const actionBars = Object.entries(d.actions || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => bar(k, v, d.total, ACTION_COLORS[k] || '#64748b'))
      .join('');
    const skillBars = Object.entries(d.skills || {}).length
      ? Object.entries(d.skills).sort((a, b) => b[1] - a[1])
          .map(([k, v]) => bar(k, v, d.total, '#f97316')).join('')
      : '<div style="color:#94a3b8; font-size:10px">No skills invoked</div>';
    return `<div class="summary">
      <div class="card">
        <h4>🎯 Actions (${d.total} decisions)</h4>
        ${actionBars || '<div style="color:#94a3b8">No data</div>'}
      </div>
      <div class="card">
        <h4>🔧 Skills invoked</h4>
        ${skillBars}
      </div>
    </div>`;
  }

  // ── PC Activity ────────────────────────────────────────────────────────────
  function renderPcActivity() {
    const ps = state.pcStats;
    const active = state.pcActive || [];
    const recent = state.pcRecent || [];

    const totalRuns = ps?.total || 0;
    const statusSummary = ps?.byStatus
      ? Object.entries(ps.byStatus).map(([s, n]) => `${s}: ${n}`).join(' · ')
      : '';
    const kindSummary = ps?.byKind
      ? Object.entries(ps.byKind).sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${esc(k)}: <b>${n}</b>`).join(' · ')
      : '';

    const activeRows = active.length
      ? active.map(e => `<div style="padding:2px 0; color:#fde68a">▶ ${esc(e.npc || '?')} — ${esc(e.meta?.task || e.kind || '?')}</div>`).join('')
      : '<div style="color:#94a3b8; font-size:10px">None running</div>';

    const recentRows = recent.length
      ? recent.map(e => {
          const dot = e.status === 'done' ? '#86efac' : e.status === 'failed' ? '#fda4af' : '#fde68a';
          return `<div style="padding:2px 0; font-size:10px">
            <span style="color:${dot}">●</span>
            <span style="color:#c7d2fe">${esc(e.npc || '?')}</span>
            <span style="color:#64748b"> ${esc(e.kind || '?')}</span>
            <span style="float:right; color:#475569">${fmtRel(e.at)}</span>
          </div>`;
        }).join('')
      : '<div style="color:#94a3b8; font-size:10px">No recent PC tasks</div>';

    return `<div class="summary">
      <div class="card">
        <h4>🖥 PC activity (${winLabel()})</h4>
        ${totalRuns > 0
          ? `<div style="margin-bottom:4px"><b>${totalRuns}</b> runs — ${statusSummary}</div>
             <div style="font-size:10px; color:#94a3b8">${kindSummary}</div>`
          : '<div style="color:#94a3b8; font-size:10px">No PC tasks in this window</div>'}
        <div style="margin-top:6px; border-top:1px solid #1e293b; padding-top:4px">
          <div style="color:#64748b; font-size:10px; margin-bottom:3px">Active now:</div>
          ${activeRows}
        </div>
      </div>
      <div class="card">
        <h4>📋 Recent PC tasks</h4>
        ${recentRows}
      </div>
    </div>`;
  }

  // ── Active state ────────────────────────────────────────────────────────────
  function renderActiveState() {
    const active = state.active;
    if (!active) {
      return `<div class="summary"><div class="card" style="grid-column:1/-1">
        <h4>📊 Active state</h4>
        <div style="color:#94a3b8">Loading…</div>
      </div></div>`;
    }
    const chains = active.chains || [];
    const proposals = active.proposals || [];

    const chainRows = chains.length
      ? chains.map(c => `<div style="padding:3px 0; border-bottom:1px solid #1e293b">
          <span style="color:#c7d2fe">${esc(c.id?.slice(0,8) || '?')}</span>
          <span style="color:#64748b"> step ${c.currentStep ?? '?'}/${c.totalSteps ?? '?'}</span>
          <span style="color:#94a3b8; font-size:10px"> — ${esc(c.currentNpc || '?')}</span>
        </div>`).join('')
      : '<div style="color:#94a3b8; font-size:10px">No active chains</div>';

    const proposalRows = proposals.length
      ? proposals.map(p => `<div style="padding:3px 0; border-bottom:1px solid #1e293b">
          <span style="color:#fbbf24">${esc(p.npc || '?')}</span>
          <span style="color:#64748b; font-size:10px"> — ${esc((p.description || '').slice(0, 60))}</span>
        </div>`).join('')
      : '<div style="color:#94a3b8; font-size:10px">No pending proposals</div>';

    return `<div class="summary">
      <div class="card">
        <h4>⛓ Task chains (${chains.length} active)</h4>
        ${chainRows}
      </div>
      <div class="card">
        <h4>💡 Pending proposals (${proposals.length})</h4>
        ${proposalRows}
        ${proposals.length > 0 ? `<div style="margin-top:4px; font-size:10px; color:#64748b">Use /api/proposals/:id/approve to accept</div>` : ''}
      </div>
    </div>`;
  }

  // ---- poll ----
  async function pollStats() {
    try {
      const w = state.windowMs || 7 * 24 * 60 * 60 * 1000;
      const r = await fetch(statsUrl(w), { cache: 'no-store' });
      if (r.ok) state.stats = await r.json();
      paintChip();
      if (state.open && state.tab === 'stats') {
        document.querySelector('#denizen-llm-tel-panel .body').innerHTML = renderStats(state.stats);
      }
    } catch (_) { /* server may be restarting */ }
  }

  // Subscribe to PC activity WS events for instant panel refresh
  function subscribeWs() {
    if (typeof window === 'undefined' || !window.WebSocket) return;
    // Wait for the game's WS connection to exist (it may not be set up yet)
    const tryHook = () => {
      // Denizen exposes the WS via window._denizenWs after connection
      const ws = window._denizenWs;
      if (!ws) return;
      const orig = ws.onmessage;
      ws.onmessage = (evt) => {
        if (orig) orig.call(ws, evt);
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'pc_activity' && state.open && state.tab === 'stats') {
            loadTab(); // refresh stats on PC activity
          }
        } catch (_) {}
      };
    };
    // Poll until the WS is available (max ~10s)
    let attempts = 0;
    const interval = setInterval(() => {
      tryHook();
      if (++attempts > 20) clearInterval(interval);
    }, 500);
  }

  function boot() {
    injectStyle();
    ensureChip();
    ensurePanel();
    renderPanel();
    paintChip();
    pollStats();
    setInterval(pollStats, POLL_MS);
    subscribeWs();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
