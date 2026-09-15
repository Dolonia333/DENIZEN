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
  function costUrl(w)              { return `/api/telemetry/cost?windowMs=${w}`; }
  function npcProfilesUrl(w)       { return `/api/npc-profiles?windowMs=${w}`; }
  function parseHealthUrl()        { return '/api/telemetry/parse-health'; }
  function groundingUrl()          { return '/api/telemetry/grounding'; }

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
    cost: null,
    npcProfiles: null,
    parseHealth: null,
    grounding: null,
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
        background: rgba(17,24,39,0.92); color: #93c5fd;
        border: 1px solid #1e40af; border-radius: 999px;
        padding: 6px 12px; font: 12px/1.2 monospace; cursor: pointer;
        user-select: none; min-width: 44px; min-height: 44px; text-align: center;
        touch-action: manipulation;
        pointer-events: auto;
      }
      html.denizen-touch #denizen-llm-tel-chip {
        min-width: 44px !important;
        max-width: 48px !important;
        padding: 6px 8px !important;
      }
      #denizen-llm-tel-chip[data-state="busy"] { color: #fde68a; border-color: #b45309; }
      #denizen-llm-tel-chip[data-state="err"]  { color: #fda4af; border-color: #be123c; }
      #denizen-llm-tel-panel {
        position: fixed; z-index: 100200;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px));
        left: max(10px, env(safe-area-inset-left, 0px));
        right: max(10px, env(safe-area-inset-right, 0px));
        width: min(580px, calc(100vw - 20px));
        max-height: 75vh; overflow: hidden;
        background: rgba(15,23,42,0.97); color: #e2e8f0;
        border: 1px solid #334155; border-radius: 12px;
        font: 12px/1.4 monospace; display: none; flex-direction: column;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        pointer-events: auto;
      }
      #denizen-llm-tel-panel.open { display: flex !important; }
      #denizen-llm-tel-panel header {
        display: flex; gap: 4px; padding: 8px;
        border-bottom: 1px solid #334155;
        background: rgba(30,41,59,0.6);
        flex-wrap: wrap;
        align-items: center;
      }
      #denizen-llm-tel-panel .tab-row {
        display: flex; gap: 4px; flex: 1 1 auto; flex-wrap: wrap;
        align-items: center;
      }
      #denizen-llm-tel-panel .header-controls {
        display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
        margin-left: auto;
      }
      html.denizen-touch #denizen-llm-tel-panel header {
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
      }
      html.denizen-touch #denizen-llm-tel-panel .tab-row {
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding-bottom: 2px;
      }
      html.denizen-touch #denizen-llm-tel-panel .tab-row::-webkit-scrollbar {
        display: none;
      }
      html.denizen-touch #denizen-llm-tel-panel .header-controls {
        margin-left: 0;
        justify-content: space-between;
      }
      #denizen-llm-tel-panel .tab {
        padding: 4px 10px; background: rgba(51,65,85,0.5); color: #cbd5e1;
        border: 1px solid #475569; border-radius: 4px; cursor: pointer;
        touch-action: manipulation;
        min-height: 36px;
        flex: 0 0 auto;
      }
      #denizen-llm-tel-panel .close-btn {
        padding: 4px 10px; background: rgba(51,65,85,0.5); color: #cbd5e1;
        border: 1px solid #475569; border-radius: 4px; cursor: pointer;
        touch-action: manipulation;
        min-height: 36px;
        flex: 0 0 auto;
      }
      html.denizen-touch #denizen-llm-tel-panel .tab,
      html.denizen-touch #denizen-llm-tel-panel .close-btn,
      html.denizen-touch #denizen-llm-tel-panel .win-btn,
      html.denizen-touch #denizen-llm-tel-panel .filters button {
        min-height: 44px;
        min-width: 44px;
        padding: 8px 12px;
        font-size: 12px;
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
      @media (max-width: 768px), (max-height: 500px) {
        #denizen-llm-tel-panel {
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          max-height: min(72dvh, 560px) !important;
        }
        #denizen-llm-tel-panel .body {
          max-height: calc(60dvh - 110px) !important;
        }
        #denizen-llm-tel-panel .summary {
          grid-template-columns: 1fr;
        }
      }

      #denizen-llm-tel-panel .tel-grab {
        display: none;
      }
      #denizen-llm-tel-panel .tel-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      #denizen-llm-tel-panel .tel-toolbar .tab-row {
        flex: 1;
        min-width: 0;
      }

      html.denizen-touch #denizen-llm-tel-panel {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        border-radius: 12px;
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
      }
      html.denizen-touch.denizen-llm-tel-open #denizen-llm-tel-panel.open {
        z-index: 2147483644 !important;
      }
      html.denizen-touch.denizen-llm-tel-open #game-container,
      html.denizen-touch.denizen-llm-tel-open #game-container canvas {
        pointer-events: none !important;
      }

      html.denizen-phone.denizen-llm-tel-open #denizen-llm-tel-panel.open {
        display: flex !important;
        flex-direction: column !important;
        padding: 0;
        margin: 0;
      }
      html.denizen-phone #denizen-llm-tel-panel .tel-grab {
        display: block;
        width: 36px;
        height: 4px;
        margin: 6px auto 4px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.45);
        flex-shrink: 0;
      }
      html.denizen-phone #denizen-llm-tel-panel header {
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        padding: 0 8px 6px;
        border-bottom: 1px solid #334155;
      }
      html.denizen-phone #denizen-llm-tel-panel .tel-toolbar .tab-row {
        gap: 4px;
        padding: 3px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid #1e293b;
      }
      html.denizen-phone #denizen-llm-tel-panel .tab {
        min-height: 40px;
        padding: 6px 10px;
        font-size: 13px;
        border-radius: 8px;
      }
      html.denizen-phone #denizen-llm-tel-panel .close-btn {
        min-width: 40px;
        min-height: 40px;
        font-size: 18px;
        border-radius: 8px;
        flex-shrink: 0;
      }
      html.denizen-phone #denizen-llm-tel-panel .header-controls {
        padding-bottom: 2px;
      }
      html.denizen-phone #denizen-llm-tel-panel .win-row {
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 4px;
        padding-bottom: 2px;
      }
      html.denizen-phone #denizen-llm-tel-panel .win-row::-webkit-scrollbar {
        display: none;
      }
      html.denizen-phone #denizen-llm-tel-panel .win-btn {
        min-height: 36px;
        min-width: 40px;
        padding: 6px 10px;
        font-size: 12px;
        flex: 0 0 auto;
      }
      html.denizen-phone #denizen-llm-tel-panel .filters {
        flex-wrap: nowrap;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 6px;
        padding: 6px 8px;
      }
      html.denizen-phone #denizen-llm-tel-panel .filters::-webkit-scrollbar {
        display: none;
      }
      html.denizen-phone #denizen-llm-tel-panel .filters input,
      html.denizen-phone #denizen-llm-tel-panel .filters select {
        min-height: 40px;
        font-size: 14px;
        padding: 6px 8px;
        flex: 0 0 auto;
      }
      html.denizen-phone #denizen-llm-tel-panel .filters button {
        min-height: 40px;
        min-width: 40px;
        font-size: 14px;
        flex: 0 0 auto;
      }
      html.denizen-phone #denizen-llm-tel-panel .filters label {
        font-size: 13px;
        flex: 0 0 auto;
        white-space: nowrap;
      }
      html.denizen-phone #denizen-llm-tel-panel .body {
        flex: 1 1 auto;
        min-height: 0;
        max-height: none !important;
        padding: 8px 10px 10px;
        font-size: 13px;
        line-height: 1.4;
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      html.denizen-phone #denizen-llm-tel-panel .row {
        max-width: 100%;
        overflow: hidden;
        padding: 5px 8px;
        margin-bottom: 5px;
        box-sizing: border-box;
      }
      html.denizen-phone #denizen-llm-tel-panel .meta {
        font-size: 12px;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
      }
      html.denizen-phone.denizen-landscape #denizen-llm-tel-panel .meta {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
      }
      html.denizen-phone #denizen-llm-tel-panel .meta > span {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      html.denizen-phone.denizen-landscape #denizen-llm-tel-panel .meta > span {
        white-space: normal;
        overflow: visible;
        text-overflow: unset;
      }
      html.denizen-phone #denizen-llm-tel-panel pre {
        font-size: 12px;
        max-height: 64px;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100%;
      }
      html.denizen-phone.denizen-landscape #denizen-llm-tel-panel pre {
        font-size: 12px;
        max-height: 80px;
        line-height: 1.45;
      }
      html.denizen-phone #denizen-llm-tel-panel .hint {
        font-size: 10px;
        overflow-wrap: anywhere;
      }
      html.denizen-phone #denizen-llm-tel-panel .summary {
        grid-template-columns: 1fr;
        gap: 6px;
        font-size: 12px;
        padding: 6px 4px;
      }
      html.denizen-phone #denizen-llm-tel-panel .prov-chip {
        font-size: 9px;
        padding: 2px 5px;
      }
      @media (max-height: 400px) {
        html.denizen-phone #denizen-llm-tel-panel .tab {
          min-height: 36px;
          font-size: 12px;
        }
        html.denizen-phone #denizen-llm-tel-panel .body {
          padding: 6px 8px 8px;
        }
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
    chip.textContent = '⚙';
    wireLmChip(chip);
    document.body.appendChild(chip);
    return chip;
  }

  function isTouchUi() {
    return !!window.__DenizenIsTouch
      || document.documentElement.classList.contains('denizen-touch');
  }

  function isPhoneUi() {
    return globalThis.DenizenDeviceProfile?.isPhone?.()
      || (isTouchUi() && document.documentElement.classList.contains('denizen-phone'));
  }

  function getDeviceTier() {
    return globalThis.DenizenDeviceProfile?.tier?.()
      || (isPhoneUi() ? 'phone' : isTouchUi() ? 'tablet' : 'desktop');
  }

  function wireLmChip(chip) {
    if (!chip || chip.dataset.denizenTouchWired === '1') return;
    chip.dataset.denizenTouchWired = '1';
    const openLm = (e) => {
      e?.preventDefault?.();
      setPanelOpen(!state.open);
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(chip, openLm, { stop: true });
    else chip.addEventListener('click', openLm);
    chip.style.touchAction = 'manipulation';
  }

  function rewireTouch() {
    wireLmChip(document.getElementById('denizen-llm-tel-chip'));
    wirePanelButtons(document.getElementById('denizen-llm-tel-panel'));
  }

  function paintChip() {
    const chip = ensureChip();
    const s = state.stats;
    const touch = isTouchUi();
    const paint = (label, title) => {
      chip.textContent = touch ? '⚙' : label;
      if (title) chip.title = title;
    };
    if (!s) {
      paint(touch ? '' : 'LM …', chip.title);
      return;
    }
    const p95 = s.p95LatencyMs != null ? (s.p95LatencyMs / 1000).toFixed(1) + 's' : '—';
    const e = s.errors || 0;
    const winLabel = WINDOWS.find(w => w.ms === state.windowMs)?.label || '?';
    const title = `LM telemetry — p95 ${p95}, ${s.calls} calls/${winLabel}, ${e} errors`;
    paint(touch ? '' : `LM p95 ${p95} • ${s.calls}c/${winLabel} • ${e}e`, title);
    chip.dataset.state = e > 0 ? 'err' : (s.calls > 0 ? 'busy' : '');
  }

  // ---- panel ----
  function ensurePanel() {
    let panel = document.getElementById('denizen-llm-tel-panel');
    if (panel) {
      wirePanelButtons(panel);
      return panel;
    }
    panel = document.createElement('div');
    panel.id = 'denizen-llm-tel-panel';
    panel.innerHTML = `
      <header>
        <div class="tel-grab" aria-hidden="true"></div>
        <div class="tel-toolbar">
          <div class="tab-row">
            <button type="button" class="tab" data-tab="calls">Calls</button>
            <button type="button" class="tab" data-tab="stats">Stats</button>
            <button type="button" class="tab" data-tab="errors">Errors</button>
            <button type="button" class="tab" data-tab="openclaw">OpenClaw</button>
          </div>
          <button type="button" class="close-btn" data-action="close" aria-label="Close settings">✕</button>
        </div>
        <div class="header-controls">
          <div class="win-row" id="tel-win-row"></div>
        </div>
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
        <button type="button" data-action="refresh">↻</button>
        <button type="button" data-action="export">⬇ CSV</button>
      </div>
      <div class="body" data-section="body">loading…</div>
    `;
    document.body.appendChild(panel);

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
    // Build time-window buttons
    buildWindowButtons(panel);
    wirePanelButtons(panel);

    return panel;
  }

  function onPanelPress(e, btnOverride) {
    const btn = btnOverride || e.target?.closest?.('button');
    if (!btn) return;

    if (btn.dataset.action === 'close') {
      setPanelOpen(false);
      return;
    }

    if (btn.classList.contains('tab')) {
      const tab = btn.dataset.tab;
      if (tab) {
        state.tab = tab;
        loadTab();
      }
      return;
    }

    if (btn.classList.contains('win-btn')) {
      const ms = Number(btn.dataset.ms);
      if (!Number.isFinite(ms)) return;
      state.windowMs = ms;
      const panel = document.getElementById('denizen-llm-tel-panel');
      panel?.querySelectorAll('.win-btn').forEach((b) => {
        b.dataset.active = (Number(b.dataset.ms) === state.windowMs).toString();
      });
      pollStats();
      if (state.open) loadTab();
      return;
    }

    const action = btn.getAttribute('data-action');
    if (action === 'refresh') loadTab();
    else if (action === 'export') exportCsv();
  }

  function wirePanelButton(btn) {
    if (!btn || btn.dataset.lmTouchWired === '1') return;
    btn.dataset.lmTouchWired = '1';
    btn.style.touchAction = 'manipulation';
    const fire = (e) => onPanelPress(e, btn);
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) {
      bind(btn, fire, { stop: true });
    } else {
      btn.addEventListener('click', fire);
    }
  }

  function wirePanelButtons(panel) {
    if (!panel) return;
    panel.querySelectorAll(
      'button.tab[data-tab], button.close-btn, button[data-action="close"], button.win-btn, .filters button[data-action]'
    ).forEach(wirePanelButton);
    if (panel.dataset.pointerWired === '1') return;
    panel.dataset.pointerWired = '1';
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  function buildWindowButtons(panel) {
    const row = panel.querySelector('#tel-win-row');
    if (!row) return;
    row.innerHTML = '';
    WINDOWS.forEach(w => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'win-btn';
      btn.textContent = w.label;
      btn.dataset.ms = w.ms;
      btn.dataset.active = (w.ms === state.windowMs).toString();
      row.appendChild(btn);
      wirePanelButton(btn);
    });
  }

  function setPanelOpen(open) {
    state.open = !!open;
    document.documentElement.classList.toggle('denizen-llm-tel-open', state.open);
    if (state.open) {
      globalThis.DenizenMobileSidebar?.close?.();
      globalThis.__DenizenPlayerChat?.close?.();
      globalThis.DenizenHaptics?.tap?.();
    }
    renderPanel();
    if (state.open) {
      const panel = document.getElementById('denizen-llm-tel-panel');
      globalThis.DenizenDeviceProfile?.resetPhonePanelLayout?.(panel);
      loadTab();
    }
  }

  function renderPanel() {
    const panel = ensurePanel();
    panel.classList.toggle('open', state.open);
    panel.dataset.phone = isPhoneUi() ? '1' : '0';
    panel.dataset.tier = getDeviceTier();
    panel.style.display = state.open ? 'flex' : 'none';
    panel.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.dataset.active = (t.dataset.tab === state.tab).toString();
    });
    const filtersDiv = panel.querySelector('.filters');
    if (filtersDiv) filtersDiv.style.display = state.tab === 'calls' ? 'flex' : 'none';
  }

  function togglePanel() {
    setPanelOpen(!state.open);
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
      fetch(url, { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) })
        .then(r => r.ok ? r.json() : fallback)
        .catch(() => fallback);
    const [stats, decisions, pcStats, pcActive, pcRecent, chains, proposals, cost, npcProfiles, parseHealth, grounding] = await Promise.all([
      safe(statsUrl(w), null),
      safe(decisionsUrl(w), { actions: {}, skills: {}, total: 0 }),
      safe(pcStatsUrl(w), { total: 0, byKind: {}, byNpc: {}, byStatus: {} }),
      safe(pcActiveUrl(), { active: [] }),
      safe(pcRecentUrl(), { events: [] }),
      safe(taskChainsUrl(), { chains: [] }),
      safe(proposalsUrl(), { proposals: [] }),
      safe(costUrl(w), null),
      safe(npcProfilesUrl(w), null),
      safe(parseHealthUrl(), null),
      safe(groundingUrl(), null),
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
    state.cost        = cost;
    state.npcProfiles = npcProfiles;
    state.parseHealth = parseHealth;
    state.grounding   = grounding;
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
        const r = await fetch(callsUrl(qs.toString()), { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) });
        const j = await r.json();
        state.calls = j.calls || [];
        body.innerHTML = state.calls.length === 0
          ? `<div style="padding:12px; color:#94a3b8">No calls in the last ${winLabel()}.</div>`
          : state.calls.map(renderCallRow).join('');
      } else if (state.tab === 'stats') {
        await loadStatsBundle();
        body.innerHTML = renderStats(state.stats);
      } else if (state.tab === 'errors') {
        const r = await fetch(errorsUrl(), { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) });
        const j = await r.json();
        state.errors = j.errors || [];
        body.innerHTML = state.errors.length === 0
          ? '<div style="padding:12px; color:#94a3b8">No errors. 🎉</div>'
          : state.errors.map(renderErrorRow).join('');
      } else if (state.tab === 'openclaw') {
        const w = state.windowMs || 7 * 24 * 60 * 60 * 1000;
        const [eventsRes, statsRes] = await Promise.all([
          fetch(openclawUrl(), { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) }).then(r => r.json()),
          fetch(openclawStatsUrl(w), { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) }).then(r => r.json()),
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
             renderDecisions() + renderCost() + renderNpcProfiles() + renderPcActivity() + renderActiveState();
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
      ? ' — high: mostly re-sent prompt (trim history / hybrid director / compact chat)'
      : s.promptToCompletionRatio > 10 ? ' — moderate' : ' — efficient';
    const ratioByKind = s.ratioByKind && Object.keys(s.ratioByKind).length
      ? Object.entries(s.ratioByKind)
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 4)
        .map(([kind, ratio]) => `${kind} ${ratio}:1`)
        .join(' · ')
      : '';

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
          ${ratioByKind
            ? `<div style="font-size:10px; color:#64748b; margin-top:2px">By kind: ${esc(ratioByKind)}</div>`
            : ''}
          ${s.avgConversationMsgs != null
            ? `<div><span style="color:#64748b">History depth:</span> avg ${s.avgConversationMsgs} msgs · max <b style="color:${convoColor}">${s.maxConversationMsgs}</b> msgs per call${s.maxConversationMsgs > 40 ? ' <span style="color:#fda4af; font-size:10px">— trim history</span>' : ''}</div>`
            : ''}
          ${s.avgPromptChars != null
            ? `<div><span style="color:#64748b">Est. prompt size:</span> ~${s.avgPromptChars} chars/call <span style="color:#64748b; font-size:10px">(think uses trimmed SOUL)</span></div>`
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

    </div>` + renderDecisions() + renderCost() + renderNpcProfiles() + renderPcActivity() + renderActiveState();
  }

  // ── Per-NPC profile tracker ───────────────────────────────────────────────
  function renderNpcProfiles() {
    const p = state.npcProfiles;
    if (!p || !p.profiles || !p.profiles.length) {
      return `<div class="summary"><div class="card" style="grid-column:1/-1">
        <h4>👤 NPC profiles (${winLabel()})</h4>
        <div style="color:#94a3b8">No NPC activity measured yet — let the office think a few cycles.</div>
      </div></div>`;
    }
    const usd = (n) => n == null ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const k   = (n) => n == null ? '—' : n.toLocaleString();

    const rows = p.profiles.map(prof => {
      const localBadge = prof.isLocal
        ? `<span class="prov-chip" style="background:#0e749088; border:1px solid #0e7490">LOCAL</span>`
        : provChip(prof.provider);
      const lat = prof.avgLatencyMs != null ? Math.round(prof.avgLatencyMs) + 'ms' : '—';
      const errBadge = prof.errors ? `<span style="color:#fda4af"> ${prof.errors}e</span>` : '';
      // Local NPCs → show ESTIMATE (what cloud would cost). Cloud NPCs → show ACTUAL.
      const costCell = prof.isLocal
        ? `<span style="color:#94a3b8">est <b style="color:#fbbf24">${usd(prof.estPerMonth)}/mo</b> <span style="font-size:9px">on ${esc(p.referenceModel)}</span></span>`
        : `<span style="color:#94a3b8">actual <b style="color:#86efac">${usd(prof.actualPerMonth)}/mo</b></span>`;
      return `<div style="padding:4px 0; border-bottom:1px solid #1e293b">
        <div style="display:flex; justify-content:space-between; align-items:baseline">
          <span><b style="color:#c7d2fe">${esc(prof.npc)}</b> ${localBadge}${errBadge}</span>
          ${costCell}
        </div>
        <div style="font-size:10px; color:#64748b; margin-top:1px">
          ${esc(prof.model || '?')} · ${prof.calls} calls · ${k(prof.tokensIn)}↑/${k(prof.tokensOut)}↓ tok · ${lat}
        </div>
      </div>`;
    }).join('');

    return `<div class="summary"><div class="card" style="grid-column:1/-1">
      <h4>👤 NPC profiles — cost per agent (${winLabel()})</h4>
      <div style="color:#64748b; font-size:10px; margin-bottom:6px">
        Local agents show an <span style="color:#fbbf24">estimate</span> (what they'd cost on ${esc(p.referenceModel)}).
        Cloud agents show <span style="color:#86efac">actual</span> measured spend.
      </div>
      ${rows}
    </div></div>`;
  }

  // ── Cost projection ───────────────────────────────────────────────────────
  function renderCost() {
    const c = state.cost;
    if (!c || !c.models || !c.models.length) {
      return `<div class="summary"><div class="card" style="grid-column:1/-1">
        <h4>💰 Cloud cost projection (${winLabel()})</h4>
        <div style="color:#94a3b8">No token usage measured yet — let the office run a few minutes.</div>
      </div></div>`;
    }
    const usd = (n) => n == null ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const k = (n) => n == null ? '—' : n.toLocaleString();

    // Cloud models sorted cheapest-first (local first since $0).
    const rows = c.models.map(m => {
      const isLocal = m.local;
      const cachedNote = m.perMonthCached != null
        ? `<span style="color:#86efac"> · ${usd(m.perMonthCached)}/mo cached</span>`
        : '';
      const est = m.estimate ? '<span style="color:#fbbf24; font-size:9px"> est</span>' : '';
      return `<div style="padding:3px 0; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:baseline">
        <span><b style="color:${isLocal ? '#86efac' : '#c7d2fe'}">${esc(m.label)}</b>${est}</span>
        <span style="color:#94a3b8">${isLocal ? '<b style="color:#86efac">FREE</b>' : usd(m.perDay) + '/day · <b>' + usd(m.perMonth) + '/mo</b>' + cachedNote}</span>
      </div>`;
    }).join('');

    const perNpc = c.perNpc && c.perNpc.rows && c.perNpc.rows.length
      ? `<div class="card">
          <h4>🤖 Cost per NPC (on ${esc(c.perNpc.model)})</h4>
          <div style="color:#64748b; font-size:10px; margin-bottom:4px">who'd cost the most to run on cloud · $/month</div>
          ${c.perNpc.rows.slice(0, 12).map(r => `
            <div style="padding:2px 0; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between">
              <span style="color:#c7d2fe">${esc(r.npc)}</span>
              <span style="color:#94a3b8">${k(r.tokensIn)}↑/${k(r.tokensOut)}↓ tok · <b>${usd(r.perMonth)}/mo</b></span>
            </div>`).join('')}
        </div>`
      : '';

    return `<div class="summary">
      <div class="card" style="grid-column:1/-1">
        <h4>💰 Cloud cost projection — if you switched providers ${c.pricingAsOf ? `<span style="color:#475569; font-size:9px">prices ${esc(c.pricingAsOf)}</span>` : ''}</h4>
        <div style="color:#64748b; font-size:10px; margin-bottom:6px">
          Measured locally: ${k(c.tokensIn)}↑ / ${k(c.tokensOut)}↓ tokens over ${winLabel()}
          (${k(c.callsPerDay)} calls/day, ${k(c.tokensInPerDay)}↑/${k(c.tokensOutPerDay)}↓ tok/day projected)
        </div>
        ${rows}
        <div style="margin-top:6px; font-size:9px; color:#475569">${esc(c.note)}</div>
      </div>
      ${perNpc}
    </div>`;
  }

  // ── Decisions histogram ──────────────────────────────────────────────────
  // Compact one-line decision-parse health indicator (model-friendliness).
  // Green = model emits clean JSON; amber = parser is repairing; red = failing.
  function parseHealthLine() {
    const h = state.parseHealth;
    if (!h || !h.total) return '';
    const repairPct = Math.round((h.repairRate || 0) * 100);
    const failPct   = Math.round((h.failRate || 0) * 100);
    const color = failPct > 5 ? '#fda4af' : repairPct > 15 ? '#fbbf24' : '#86efac';
    const verdict = failPct > 5 ? 'parse failures — restart after updates; check think max tokens'
                  : repairPct > 15 ? 'parser repairing often — was truncation; should improve after restart'
                  : 'clean — model is JSON-reliable';
    return `<div style="margin-top:4px; font-size:10px; color:#64748b">
      JSON health (since boot): <b style="color:${color}">${100 - failPct}% ok</b>
      · ${h.ok} ok / ${h.repairs} repaired / ${h.fail} failed
      · <span style="color:${color}">${esc(verdict)}</span>
    </div>`;
  }

  // Compact grounding/hallucination indicator — how many NPC claims were
  // flagged as unbacked. Green = grounded; amber/red = making things up.
  function groundingLine() {
    const g = state.grounding;
    if (!g || !g.checked) return '';
    const flagPct = Math.round((g.flagRate || 0) * 100);
    const color = flagPct > 25 ? '#fda4af' : flagPct > 10 ? '#fbbf24' : '#86efac';
    const verdict = flagPct > 25 ? 'unbacked claims — enable real-work mode to enforce'
                  : flagPct > 10 ? 'some unbacked claims' : 'claims grounded or immersion mode';
    return `<div style="margin-top:2px; font-size:10px; color:#64748b">
      Grounding (since boot): <b style="color:${color}">${100 - flagPct}% backed</b>
      · ${g.checked} claims / ${g.flagged} flagged
      · <span style="color:${color}">${esc(verdict)}</span>
    </div>`;
  }

  function renderDecisions() {
    const d = state.decisions;
    if (!d || d.total === 0) {
      return `<div class="summary"><div class="card" style="grid-column:1/-1">
        <h4>🎯 What NPCs decided (${winLabel()})</h4>
        <div style="color:#94a3b8">No decision data yet — NPCs haven't finished a think cycle.</div>
        ${parseHealthLine()}
        ${groundingLine()}
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
      <div class="card" style="grid-column:1/-1; padding-top:4px; padding-bottom:4px">
        ${parseHealthLine() || '<div style="color:#64748b; font-size:10px">JSON health: no data yet</div>'}
        ${groundingLine()}
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
      const r = await fetch(statsUrl(w), { cache: 'no-store', headers: (globalThis.DenizenVisitorSession?.authHeaders?.() || {}) });
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

  function shouldShowOperatorPanel() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (!caps) return true;
    return caps.canUseOperatorPanels();
  }

  function boot() {
    if (!shouldShowOperatorPanel()) return;
    injectStyle();
    ensureChip();
    ensurePanel();
    renderPanel();
    paintChip();
    rewireTouch();
    pollStats();
    setInterval(pollStats, POLL_MS);
    subscribeWs();
    window.DenizenLlmTelemetry = {
      show: () => setPanelOpen(true),
      hide: () => setPanelOpen(false),
      toggle: togglePanel,
      isOpen: () => state.open,
      rewireTouch,
    };
  }

  function bootWhenReady() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.init) {
      sess.init().finally(boot);
      return;
    }
    boot();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootWhenReady);
  } else {
    bootWhenReady();
  }
})();
