/**
 * Compute node UI — credits/tier display + opt-in toggle.
 * Attaches to window.DenizenNodeUI (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-node-ui-style';
  const ROOT_ID = 'denizen-node-ui-chip';
  const RESTORE_ID = 'denizen-node-ui-restore';
  const PANEL_HIDDEN_KEY = 'denizen-node-ui-hidden';
  const REFRESH_MS = 30000;

  let rootEl = null;
  let restoreEl = null;
  let statusTimer = null;
  let initPromise = null;
  let busyToggle = false;
  let busyPairing = false;
  let busyLevel = false;
  let busySpend = false;
  let contribExpanded = false;
  let panelHidden = false;
  let suppressToggleEvent = false;
  let keyListenerBound = false;
  let state = {
    sessionId: null,
    sessionReady: false,
    credits: 0,
    tier: 'visitor',
    isSuperNode: false,
    optedIn: false,
    contributing: false,
    isHostNode: false,
    contributorState: 'browser_only',
    needsDesktopDownload: false,
    desktopLinked: false,
    canContribute: false,
    downloadUrl: '/desktop/download.html',
    statusLabel: 'browser only',
    lmStudioModel: null,
    jobsCompleted: 0,
    hardwareScore: 0,
    contributionLevel: 'off',
    cpuCores: null,
    ramMb: null,
    gpuModel: null,
    contributionModes: [],
    cpuPercent: null,
    ramUsedPercent: null,
    ramUsedMb: null,
    gpuUtilPercent: null,
    gpuVramUsedMb: null,
    fleet: [],
    creditsEconomy: null,
    estimatedJobCredits: null,
    lastError: null,
  };

  let liveRefreshTimer = null;
  const LIVE_REFRESH_MS = 10000;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${ROOT_ID} {
        position: fixed;
        z-index: 100520;
        left: max(12px, env(safe-area-inset-left, 0px));
        bottom: calc(var(--denizen-dock-height, 56px) + 48px + env(safe-area-inset-bottom, 0px));
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 220px;
        max-width: min(280px, calc(100vw - 24px));
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #334155;
        background: rgba(2, 6, 23, 0.94);
        color: #e2e8f0;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
        user-select: none;
      }
      #${ROOT_ID}[data-panel-hidden="1"] {
        display: none !important;
      }
      #${RESTORE_ID} {
        position: fixed;
        z-index: 100519;
        left: max(0px, env(safe-area-inset-left, 0px));
        bottom: calc(var(--denizen-dock-height, 56px) + 48px + env(safe-area-inset-bottom, 0px));
        display: none;
        align-items: center;
        gap: 6px;
        padding: 8px 10px 8px 8px;
        border-radius: 0 8px 8px 0;
        border: 1px solid #334155;
        border-left: none;
        background: rgba(2, 6, 23, 0.92);
        color: #93c5fd;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
        cursor: pointer;
        user-select: none;
      }
      #${RESTORE_ID}:hover {
        color: #e2e8f0;
        background: rgba(15, 23, 42, 0.96);
      }
      #${RESTORE_ID}[data-visible="1"] {
        display: inline-flex;
      }
      #${RESTORE_ID} .restore-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22c55e;
        box-shadow: 0 0 6px rgba(34, 197, 94, 0.65);
        flex-shrink: 0;
      }
      #${RESTORE_ID} .restore-dot.idle {
        background: #64748b;
        box-shadow: none;
      }
      #${ROOT_ID} .node-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #${ROOT_ID} .node-top-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      #${ROOT_ID} .node-hide-btn {
        background: transparent;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #94a3b8;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        padding: 2px 6px;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.25);
      }
      #${ROOT_ID} .node-hide-btn:hover {
        color: #e2e8f0;
        border-color: #475569;
      }
      html.denizen-touch #${ROOT_ID} .node-hide-btn,
      html.denizen-touch #${RESTORE_ID} {
        min-width: 44px;
        min-height: 44px;
        padding: 8px 12px;
        font-size: 16px;
        touch-action: manipulation;
      }
      html.denizen-touch #${RESTORE_ID} {
        z-index: 100525;
      }
      #${ROOT_ID} .node-credits {
        font-weight: 700;
        color: #93c5fd;
      }
      #${ROOT_ID} .node-badges {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      #${ROOT_ID} .node-badge {
        border-radius: 999px;
        border: 1px solid #334155;
        color: #cbd5e1;
        padding: 2px 7px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      #${ROOT_ID} .node-badge.super {
        border-color: rgba(250, 204, 21, 0.65);
        color: #fde68a;
        background: rgba(250, 204, 21, 0.12);
      }
      #${ROOT_ID} .node-optin-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #94a3b8;
      }
      #${ROOT_ID} .node-optin-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      #${ROOT_ID} .node-optin {
        accent-color: #4ade80;
        width: 14px;
        height: 14px;
        margin: 0;
      }
      #${ROOT_ID} .node-meta {
        color: #64748b;
        font-size: 10px;
        text-align: right;
        max-width: 140px;
        line-height: 1.25;
      }
      #${ROOT_ID}[data-host="1"] .node-optin {
        accent-color: #38bdf8;
      }
      #${ROOT_ID}[data-host="1"] .node-meta {
        color: #7dd3fc;
      }
      #${ROOT_ID} .node-download {
        display: none;
        margin-top: 4px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px dashed #475569;
        color: #cbd5e1;
        font-size: 10px;
        line-height: 1.4;
      }
      #${ROOT_ID} .node-download a {
        color: #93c5fd;
        text-decoration: none;
      }
      #${ROOT_ID} .node-pair-btn {
        display: block;
        width: 100%;
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #4ade80;
        background: rgba(74, 222, 128, 0.12);
        color: #4ade80;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
        touch-action: manipulation;
      }
      #${ROOT_ID} .node-pair-btn:hover { background: rgba(74, 222, 128, 0.22); }
      #${ROOT_ID} .node-pair-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      #${ROOT_ID}[data-needs-desktop="1"] .node-optin-row {
        display: none;
      }
      #${ROOT_ID}[data-needs-desktop="1"] .node-download {
        display: block;
      }
      #${ROOT_ID}[data-error="1"] .node-meta {
        color: #fca5a5;
      }
      #${ROOT_ID} .node-contrib-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid #1f2937;
        color: #94a3b8;
        font-size: 10px;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${ROOT_ID} .node-contrib-toggle:hover { color: #cbd5e1; }
      #${ROOT_ID} .node-contrib-body {
        display: none;
        flex-direction: column;
        gap: 6px;
        padding-top: 4px;
      }
      #${ROOT_ID}[data-contrib-expanded="1"] .node-contrib-body {
        display: flex;
      }
      #${ROOT_ID} .node-contrib-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #64748b;
        font-size: 10px;
      }
      #${ROOT_ID} .node-contrib-val {
        color: #93c5fd;
        font-weight: 600;
        text-align: right;
      }
      #${ROOT_ID} .node-level-select {
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid #334155;
        border-radius: 6px;
        color: #e2e8f0;
        font: inherit;
        font-size: 10px;
        padding: 4px 6px;
        max-width: 120px;
      }
      #${ROOT_ID} .node-level-select:disabled {
        opacity: 0.55;
      }
      #${ROOT_ID} .node-spend-row {
        margin-top: 4px;
      }
      #${ROOT_ID} .node-spend-btn {
        width: 100%;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #6366f1;
        background: rgba(99, 102, 241, 0.15);
        color: #a5b4fc;
        font: inherit;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${ROOT_ID} .node-spend-btn:hover:not(:disabled) {
        background: rgba(99, 102, 241, 0.28);
      }
      #${ROOT_ID} .node-spend-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #${ROOT_ID} .node-modes {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-top: 2px;
      }
      #${ROOT_ID} .node-mode {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-size: 9px;
        color: #64748b;
      }
      #${ROOT_ID} .node-mode.active { color: #4ade80; }
      #${ROOT_ID} .node-mode-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: #334155;
        flex-shrink: 0;
      }
      #${ROOT_ID} .node-mode.active .node-mode-dot { background: #4ade80; }
      #${ROOT_ID} .node-account-link {
        color: #64748b;
        font-size: 9px;
        text-decoration: none;
        margin-left: auto;
      }
      #${ROOT_ID} .node-account-link:hover { color: #93c5fd; }
      #${ROOT_ID} .node-live-label {
        color: #4ade80;
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #${ROOT_ID} .node-fleet {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid #1f2937;
      }
      #${ROOT_ID} .node-fleet-title {
        color: #94a3b8;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #${ROOT_ID} .node-fleet-card {
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 6px 8px;
        background: rgba(15, 23, 42, 0.55);
      }
      #${ROOT_ID} .node-fleet-card .name {
        color: #e2e8f0;
        font-weight: 600;
        font-size: 10px;
      }
      #${ROOT_ID} .node-fleet-card .stats {
        color: #7dd3fc;
        font-size: 9px;
        margin-top: 3px;
        line-height: 1.35;
      }
      html.denizen-mobile-drawer-mode:not(.denizen-drawer-open) #${ROOT_ID} {
        display: none !important;
      }
      html.denizen-drawer-open #denizen-mobile-drawer-body #${ROOT_ID} {
        display: flex !important;
      }
    `;
    document.head.appendChild(s);
  }

  function getSessionApi() {
    return globalThis.DenizenVisitorSession || null;
  }

  function getSessionId() {
    return getSessionApi()?.getSessionId?.() || null;
  }

  function isLocalClient() {
    try {
      const host = String(window.location.hostname || '').trim().toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    } catch (_) {
      return false;
    }
  }

  function authHeaders(extra = {}) {
    const api = getSessionApi();
    const headers = typeof api?.authHeaders === 'function'
      ? api.authHeaders(extra)
      : { ...extra };
    const ceoHost = typeof api?.isCeoPrincipal === 'function' && api.isCeoPrincipal();
    if (globalThis.DenizenDesktop?.isDesktop) {
      headers['X-Denizen-Client'] = 'desktop';
    } else if (ceoHost) {
      headers['X-Denizen-Client'] = 'host';
    } else {
      headers['X-Denizen-Client'] = 'browser';
    }
    if (isLocalClient() || ceoHost) {
      headers['X-Denizen-Local-Client'] = '1';
    }
    if (ceoHost) {
      headers['X-Ceo-Principal'] = '1';
    }
    return headers;
  }

  const REQUEST_TIMEOUT_MS = 12000;

  async function fetchWithTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function readPanelHidden() {
    try {
      return localStorage.getItem(PANEL_HIDDEN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function writePanelHidden(hidden) {
    try {
      localStorage.setItem(PANEL_HIDDEN_KEY, hidden ? '1' : '0');
    } catch (_) {}
  }

  function isTypingTarget(el) {
    if (!el || el === document.body) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
  }

  function ensureRestoreTab() {
    if (restoreEl) return restoreEl;
    restoreEl = document.createElement('button');
    restoreEl.id = RESTORE_ID;
    restoreEl.type = 'button';
    restoreEl.title = 'Show compute panel (Ctrl+Shift+H)';
    restoreEl.setAttribute('aria-label', 'Show compute panel');
    restoreEl.innerHTML = '<span class="restore-dot idle" aria-hidden="true"></span><span>Compute</span>';
    const onRestore = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const drawer = globalThis.DenizenMobileSidebar;
      if (drawer?.isTouchDrawerMode?.()) {
        drawer.open();
        return;
      }
      showPanel();
    };
    restoreEl.addEventListener('click', onRestore);
    document.body.appendChild(restoreEl);
    return restoreEl;
  }

  function applyPanelVisibility() {
    if (rootEl) rootEl.dataset.panelHidden = panelHidden ? '1' : '0';
    const tab = ensureRestoreTab();
    tab.dataset.visible = panelHidden ? '1' : '0';
    const dot = tab.querySelector('.restore-dot');
    if (dot) {
      dot.classList.toggle('idle', !state.contributing);
    }
    if (panelHidden) {
      stopLiveRefresh();
    } else if (contribExpanded || getSessionApi()?.isCeoPrincipal?.()) {
      startLiveRefresh();
    }
  }

  function hidePanel(opts = {}) {
    panelHidden = true;
    if (opts.persist !== false) writePanelHidden(true);
    applyPanelVisibility();
    return { hidden: true };
  }

  function showPanel(opts = {}) {
    panelHidden = false;
    if (opts.persist !== false) writePanelHidden(false);
    applyPanelVisibility();
    return { hidden: false };
  }

  function togglePanel(opts = {}) {
    return panelHidden ? showPanel(opts) : hidePanel(opts);
  }

  function isPanelHidden() {
    return panelHidden;
  }

  function bindPanelHotkey() {
    if (keyListenerBound) return;
    keyListenerBound = true;
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || !e.shiftKey || String(e.key || '').toLowerCase() !== 'h') return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      togglePanel();
    });
  }

  function getSessionTier() {
    const api = getSessionApi();
    if (api?.isCeoPrincipal?.()) return 'ceo';
    const tier = api?.getTier?.();
    if (tier) return String(tier);
    const method = api?.getAccessMethod?.();
    if (method === 'ceo') return 'ceo';
    return null;
  }

  function collectHardwareReport() {
    const report = {};
    if (typeof navigator.hardwareConcurrency === 'number') {
      report.hardware_concurrency = navigator.hardwareConcurrency;
    }
    if (typeof navigator.deviceMemory === 'number') {
      report.device_memory_gb = navigator.deviceMemory;
    }
    return report;
  }

  function applyLiveSnapshot(live, fleet) {
    if (!live || typeof live !== 'object') return;
    state = {
      ...state,
      fleet: Array.isArray(fleet) ? fleet : state.fleet,
      cpuPercent: live.cpu_percent ?? state.cpuPercent,
      ramUsedPercent: live.ram?.used_percent ?? state.ramUsedPercent,
      ramUsedMb: live.ram?.used_mb ?? state.ramUsedMb,
      ramMb: live.ram?.total_mb ?? state.ramMb,
      gpuUtilPercent: live.gpu?.utilization_percent ?? state.gpuUtilPercent,
      gpuVramUsedMb: live.gpu?.vram_used_mb ?? state.gpuVramUsedMb,
      gpuModel: live.gpu?.model ?? state.gpuModel,
      cpuCores: live.cpu_cores ?? state.cpuCores,
    };
  }

  async function fetchHealthHardware() {
    const res = await fetchWithTimeout('/api/health', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.hardware) return null;
    const live = data.hardware.live_usage || null;
    const fleet = Array.isArray(data.hardware.fleet) ? data.hardware.fleet : [];
    if (live) applyLiveSnapshot(live, fleet);
    render();
    emitStatus();
    return data.hardware;
  }

  function mapContributionSummary(summary) {
    if (!summary || typeof summary !== 'object') return {};
    const modes = Array.isArray(summary.contribution_modes) ? summary.contribution_modes : [];
    const live = summary.live_usage && typeof summary.live_usage === 'object'
      ? summary.live_usage
      : null;
    return {
      jobsCompleted: Number(summary.jobs_completed) || 0,
      hardwareScore: Number(summary.hardware_score) || 0,
      contributionLevel: String(summary.contribution_level || 'off'),
      cpuCores: summary.cpu_cores ?? live?.cpu_cores ?? null,
      ramMb: summary.ram_mb ?? live?.ram?.total_mb ?? null,
      gpuModel: summary.gpu_model ?? live?.gpu?.model ?? null,
      contributionModes: modes,
      cpuPercent: summary.cpu_percent ?? live?.cpu_percent ?? null,
      ramUsedPercent: summary.ram_used_percent ?? live?.ram?.used_percent ?? null,
      ramUsedMb: summary.ram_used_mb ?? live?.ram?.used_mb ?? null,
      gpuUtilPercent: summary.gpu_utilization_percent ?? live?.gpu?.utilization_percent ?? null,
      gpuVramUsedMb: summary.gpu_vram_used_mb ?? live?.gpu?.vram_used_mb ?? null,
      fleet: Array.isArray(summary.fleet) ? summary.fleet : [],
      creditsEconomy: summary.credits_economy || null,
      estimatedJobCredits: summary.estimated_job_credits || null,
    };
  }

  function normalizeStatus(payload) {
    const base = payload?.status || payload?.node || payload || {};
    const creditsVal = base.credits_balance ?? base.credits ?? payload?.credits_balance ?? payload?.credits;
    const tierVal = base.node_tier ?? base.tier ?? payload?.node_tier ?? payload?.tier;
    const superVal = base.is_super_node ?? base.super_node ?? payload?.is_super_node ?? payload?.super_node;
    const contributingVal = base.contributing ?? payload?.contributing;
    const optInVal = base.opted_in ?? base.opt_in ?? base.is_opted_in ?? payload?.opted_in ?? payload?.opt_in;
    const hostVal = base.is_host_node ?? base.host_lmstudio_active ?? payload?.is_host_node ?? payload?.host_lmstudio_active;
    const statusLabel = base.status_label ?? payload?.status_label ?? null;
    const lmStudio = base.lm_studio ?? payload?.lm_studio ?? null;
    const contributing = contributingVal != null
      ? !!contributingVal
      : (!!optInVal || !!hostVal);
    const sessionTier = getSessionTier();
    let resolvedTier = tierVal || sessionTier || 'visitor';
    if (getSessionApi()?.isCeoPrincipal?.()) resolvedTier = 'ceo';
    const contributorState = base.contributor_state ?? payload?.contributor_state ?? 'browser_only';
    const needsDesktop = !!(base.needs_desktop_download ?? payload?.needs_desktop_download);
    const canContribute = !!(base.can_contribute ?? payload?.can_contribute);
    const desktopLinked = !!(base.desktop_linked ?? payload?.desktop_linked);
    const downloadUrl = base.download_url ?? payload?.download_url ?? '/desktop/download.html';
    const summaryRaw = base.contribution_summary ?? payload?.contribution_summary ?? null;
    const fromSummary = mapContributionSummary(summaryRaw);
    const activeNode = base.active_node ?? payload?.active_node ?? summaryRaw?.active_node ?? null;
    const levelVal = base.contribution_level ?? payload?.contribution_level ?? fromSummary.contributionLevel;
    return {
      credits: Number.isFinite(Number(creditsVal)) ? Number(creditsVal) : 0,
      tier: String(resolvedTier),
      isSuperNode: !!superVal,
      optedIn: canContribute && contributing,
      contributing: canContribute && contributing,
      isHostNode: !!hostVal,
      contributorState: String(contributorState),
      needsDesktopDownload: needsDesktop && contributorState === 'browser_only',
      desktopLinked,
      canContribute,
      downloadUrl: String(downloadUrl),
      statusLabel: String(statusLabel || (contributing ? 'active' : 'browser only')),
      lmStudioModel: lmStudio?.model_short || lmStudio?.model || null,
      jobsCompleted: fromSummary.jobsCompleted || Number(activeNode?.jobs_completed) || 0,
      hardwareScore: fromSummary.hardwareScore || Number(base.hardware_score ?? payload?.hardware_score) || 0,
      contributionLevel: String(levelVal || 'off'),
      cpuCores: fromSummary.cpuCores ?? base.profile?.cpu_cores ?? payload?.profile?.cpu_cores ?? null,
      ramMb: fromSummary.ramMb ?? base.profile?.ram_mb ?? payload?.profile?.ram_mb ?? null,
      gpuModel: fromSummary.gpuModel ?? base.profile?.gpu_model ?? payload?.profile?.gpu_model ?? null,
      contributionModes: fromSummary.contributionModes.length
        ? fromSummary.contributionModes
        : (Array.isArray(base.contribution_modes) ? base.contribution_modes : []),
      cpuPercent: fromSummary.cpuPercent ?? null,
      ramUsedPercent: fromSummary.ramUsedPercent ?? null,
      ramUsedMb: fromSummary.ramUsedMb ?? null,
      gpuUtilPercent: fromSummary.gpuUtilPercent ?? null,
      gpuVramUsedMb: fromSummary.gpuVramUsedMb ?? null,
      fleet: fromSummary.fleet || [],
      creditsEconomy: fromSummary.creditsEconomy ?? null,
      estimatedJobCredits: fromSummary.estimatedJobCredits ?? null,
    };
  }

  function emitStatus() {
    try {
      window.dispatchEvent(new CustomEvent('denizen-node-status', { detail: { ...state } }));
    } catch (_) {}
  }

  function ensureRoot() {
    if (rootEl) return rootEl;
    injectStyles();
    rootEl = document.createElement('section');
    rootEl.id = ROOT_ID;
    rootEl.innerHTML = `
      <div class="node-top">
        <span class="node-credits">Credits: 0</span>
        <span class="node-top-actions">
          <span class="node-badges">
            <span class="node-badge node-tier">VISITOR</span>
            <span class="node-badge node-super" hidden>SUPER NODE</span>
          </span>
          <button type="button" class="node-hide-btn" id="denizen-node-hide-btn" title="Hide compute panel (Ctrl+Shift+H)" aria-label="Hide compute panel">−</button>
        </span>
      </div>
      <div class="node-optin-row">
        <label class="node-optin-label" for="denizen-node-optin-toggle">
          <input id="denizen-node-optin-toggle" class="node-optin" type="checkbox" />
          <span>Contribute compute</span>
        </label>
        <span class="node-meta" id="denizen-node-meta">idle</span>
      </div>
      <div class="node-download" id="denizen-node-download">
        Browser can't access this machine. Install
        <a href="/desktop/download.html" target="_blank" rel="noopener">Denizen Desktop</a>
        to profile hardware, approve agent permissions, and contribute compute.
      </div>
      <div class="node-browser-hint" id="denizen-node-browser-hint">
        <span id="denizen-node-browser-hint-text">Browser mode — delegate work to the cloud mesh. Pair Desktop to unlock hardware stats, contribution controls, and PC automation.</span>
        <button type="button" class="node-upgrade-btn" id="denizen-node-guide-btn">Open Guide → Desktop</button>
      </div>
      <div class="node-contrib-toggle" id="denizen-node-contrib-toggle" role="button" tabindex="0" aria-expanded="false">
        <span>Contribution</span>
        <span>
          <span id="denizen-node-contrib-chevron">▾</span>
          <a href="#" class="node-account-link" id="denizen-node-account-link" hidden>Account</a>
        </span>
      </div>
      <div class="node-contrib-body" id="denizen-node-contrib-body">
        <div class="node-contrib-row"><span>Jobs done</span><span class="node-contrib-val" id="denizen-node-jobs">0</span></div>
        <div class="node-contrib-row"><span>Credits today</span><span class="node-contrib-val" id="denizen-node-credits-today">0</span></div>
        <div class="node-contrib-row node-spend-row">
          <button type="button" class="node-spend-btn" id="denizen-node-spend-btn" disabled>Boost priority (10 cr)</button>
        </div>
        <div class="node-contrib-row"><span>Est. job credit</span><span class="node-contrib-val" id="denizen-node-est-job">—</span></div>
        <div class="node-contrib-row"><span>Hardware score</span><span class="node-contrib-val" id="denizen-node-hw-score">0</span></div>
        <div class="node-contrib-row"><span>CPU <span class="node-live-label">live</span></span><span class="node-contrib-val" id="denizen-node-cpu">—</span></div>
        <div class="node-contrib-row"><span>RAM <span class="node-live-label">live</span></span><span class="node-contrib-val" id="denizen-node-ram">—</span></div>
        <div class="node-contrib-row"><span>GPU <span class="node-live-label">live</span></span><span class="node-contrib-val" id="denizen-node-gpu">—</span></div>
        <div class="node-fleet" id="denizen-node-fleet" hidden>
          <div class="node-fleet-title">Your machines</div>
          <div id="denizen-node-fleet-list"></div>
        </div>
        <div class="node-contrib-row">
          <span>Level</span>
          <select id="denizen-node-level" class="node-level-select" aria-label="Contribution level">
            <option value="off">off</option>
            <option value="light">light</option>
            <option value="standard">standard</option>
            <option value="max">max</option>
          </select>
        </div>
        <div class="node-contrib-row"><span>How</span><span class="node-contrib-val" id="denizen-node-how">idle</span></div>
        <div class="node-modes" id="denizen-node-modes"></div>
      </div>
    `;
    document.body.appendChild(rootEl);
    globalThis.DenizenMobileSidebar?.relayout?.();
    panelHidden = globalThis.DenizenMobileSidebar?.isTouchDrawerMode?.()
      ? false
      : readPanelHidden();
    ensureRestoreTab();
    applyPanelVisibility();
    bindPanelHotkey();
    const onHidePanel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const drawer = globalThis.DenizenMobileSidebar;
      if (drawer?.isTouchDrawerMode?.()) {
        drawer.close();
        return;
      }
      hidePanel();
    };
    const hideBtn = rootEl.querySelector('#denizen-node-hide-btn');
    hideBtn?.addEventListener('click', onHidePanel);
    const toggle = rootEl.querySelector('#denizen-node-optin-toggle');
    toggle?.addEventListener('change', () => {
      if (suppressToggleEvent || busyToggle) return;
      setOptIn(!!toggle.checked).catch((err) => {
        console.warn('[DenizenNodeUI] opt-in update failed:', err?.message || err);
      });
    });
    const onPairDesktop = () => {
      if (busyPairing || !state.sessionReady || !getSessionId()) return;
      const pairing = globalThis.DenizenDesktopPairing;
      if (typeof pairing?.createPairingLink !== 'function') {
        console.warn('[DenizenNodeUI] DenizenDesktopPairing unavailable');
        return;
      }
      busyPairing = true;
      state.lastError = null;
      render();
      pairing.createPairingLink()
        .catch((err) => {
          const msg = err?.message || 'Desktop pairing failed';
          console.warn('[DenizenNodeUI] desktop pairing failed:', msg);
          state.lastError = msg;
        })
        .finally(() => {
          busyPairing = false;
          render();
        });
    };
    rootEl.addEventListener('click', (e) => {
      if (!e.target?.closest?.('#denizen-node-pair-btn')) return;
      e.preventDefault();
      onPairDesktop();
    });
    const onContribToggle = () => {
      contribExpanded = !contribExpanded;
      rootEl.dataset.contribExpanded = contribExpanded ? '1' : '0';
      const chevron = rootEl.querySelector('#denizen-node-contrib-chevron');
      const toggle = rootEl.querySelector('#denizen-node-contrib-toggle');
      if (chevron) chevron.textContent = contribExpanded ? '▴' : '▾';
      if (toggle) toggle.setAttribute('aria-expanded', contribExpanded ? 'true' : 'false');
      if (contribExpanded) {
        fetchContributionSummary().catch(() => null);
        startLiveRefresh();
      } else {
        stopLiveRefresh();
      }
    };
    const contribToggle = rootEl.querySelector('#denizen-node-contrib-toggle');
    contribToggle?.addEventListener('click', (e) => {
      if (e.target?.closest?.('#denizen-node-account-link')) return;
      onContribToggle();
    });
    contribToggle?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onContribToggle();
      }
    });
    const levelSelect = rootEl.querySelector('#denizen-node-level');
    levelSelect?.addEventListener('change', () => {
      if (busyLevel) return;
      const level = String(levelSelect.value || 'off');
      setContributionLevel(level).catch((err) => {
        console.warn('[DenizenNodeUI] level update failed:', err?.message || err);
      });
    });
    const accountLink = rootEl.querySelector('#denizen-node-account-link');
    accountLink?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = globalThis.DenizenAccountPanel;
      if (panel?.renderProfile) panel.renderProfile();
      if (panel?.renderStats) panel.renderStats();
    });
    const spendBtn = rootEl.querySelector('#denizen-node-spend-btn');
    spendBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      spendPriorityBoost().catch((err) => {
        console.warn('[DenizenNodeUI] credit spend failed:', err?.message || err);
        state.lastError = err?.message || 'Spend failed';
        render();
      });
    });
    return rootEl;
  }

  async function fetchCreditsEconomy() {
    const sid = getSessionId();
    if (!sid) return null;
    const res = await fetchWithTimeout(
      `/api/compute/credits/economy?session_id=${encodeURIComponent(sid)}`,
      { method: 'GET', headers: authHeaders() },
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (Number.isFinite(Number(data.credits_balance))) {
      state.credits = Number(data.credits_balance);
    }
    state.creditsEconomy = data.economy || data;
    const cost = data.spend_catalog?.priority_boost?.cost || 10;
    const spendBtn = rootEl?.querySelector('#denizen-node-spend-btn');
    if (spendBtn) spendBtn.textContent = `Boost priority (${cost} cr)`;
    return data;
  }

  async function spendPriorityBoost() {
    const sid = getSessionId();
    if (!sid || busySpend) return;
    busySpend = true;
    state.lastError = null;
    render();
    try {
      const res = await fetchWithTimeout('/api/compute/credits/spend', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session_id: sid, reason: 'priority_boost' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (Number.isFinite(Number(data.credits_balance))) {
        state.credits = Number(data.credits_balance);
      }
      await refresh();
    } finally {
      busySpend = false;
      render();
    }
  }

  function formatRam(mb) {
    const n = Number(mb);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1024) return `${Math.round(n / 1024)} GB`;
    return `${Math.round(n)} MB`;
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${Math.round(n * 10) / 10}%`;
  }

  function formatCpuLine() {
    const cores = Number(state.cpuCores);
    const pct = formatPercent(state.cpuPercent);
    if (pct && Number.isFinite(cores) && cores > 0) return `${pct} · ${cores} cores`;
    if (pct) return pct;
    if (Number.isFinite(cores) && cores > 0) return `${cores} cores`;
    return '—';
  }

  function formatRamLine() {
    const pct = formatPercent(state.ramUsedPercent);
    const used = state.ramUsedMb;
    const total = state.ramMb;
    if (pct && used) return `${pct} · ${formatRam(used)} used`;
    if (pct && total) return `${pct} · ${formatRam(total)} total`;
    return formatRam(total);
  }

  function formatGpuLine() {
    const util = formatPercent(state.gpuUtilPercent);
    const model = state.gpuModel || state.lmStudioModel;
    const vram = state.gpuVramUsedMb;
    const parts = [];
    if (util) parts.push(util);
    if (vram) parts.push(`${formatRam(vram)} VRAM`);
    if (model) parts.push(String(model));
    return parts.length ? parts.join(' · ') : '—';
  }

  function formatFleetMachine(machine) {
    if (!machine || typeof machine !== 'object') return '';
    const label = machine.label || machine.hostname || machine.machine_id || 'machine';
    const role = machine.role ? ` (${machine.role})` : '';
    const stats = [];
    if (Number.isFinite(Number(machine.cpu_percent))) stats.push(`CPU ${formatPercent(machine.cpu_percent)}`);
    if (machine.ram?.used_percent != null) {
      stats.push(`RAM ${formatPercent(machine.ram.used_percent)}`);
    } else if (machine.reachable === false) {
      stats.push('offline');
    } else if (machine.reachable === true) {
      stats.push(`online${machine.latency_ms ? ` · ${machine.latency_ms}ms` : ''}`);
    }
    if (machine.gpu?.utilization_percent != null) {
      stats.push(`GPU ${formatPercent(machine.gpu.utilization_percent)}`);
    }
    if (Number(machine.jobs_completed) > 0) stats.push(`${machine.jobs_completed} jobs`);
    return `<div class="node-fleet-card"><div class="name">${label}${role}</div><div class="stats">${stats.join(' · ') || 'awaiting metrics'}</div></div>`;
  }

  function formatModeLabel(mode) {
    if (!mode || typeof mode !== 'object') return String(mode || '');
    return String(mode.label || mode.mode || mode.key || 'mode');
  }

  function isModeActive(mode) {
    if (!mode || typeof mode !== 'object') return false;
    return !!(mode.active || mode.enabled);
  }

  function applyClientModeLayout() {
    if (!rootEl) return;
    const caps = globalThis.DenizenVisitorCapabilities;
    const browserOnly = !!caps?.isBrowserOnlyWeb?.();
    const fullPanel = !!caps?.canSeeFullComputePanel?.();
    rootEl.dataset.browserCompact = (browserOnly && !fullPanel) ? '1' : '0';
    rootEl.dataset.clientMode = caps?.clientModeLabel?.() || 'browser';
    const hint = rootEl.querySelector('#denizen-node-browser-hint-text');
    if (hint && browserOnly && !fullPanel) {
      hint.textContent = 'Browser mode — chat, handoffs, and cloud mesh only. Install Denizen Desktop to unlock live hardware, mesh contribution, and PC automation.';
    }
    const guideBtn = rootEl.querySelector('#denizen-node-guide-btn');
    if (guideBtn && !guideBtn.dataset.wired) {
      guideBtn.dataset.wired = '1';
      guideBtn.addEventListener('click', () => {
        globalThis.DenizenCapabilitiesGuide?.open?.({ tab: 'mesh' });
      });
    }
  }

  function render() {
    if (!rootEl) return;
    const creditsEl = rootEl.querySelector('.node-credits');
    const tierEl = rootEl.querySelector('.node-tier');
    const superEl = rootEl.querySelector('.node-super');
    const toggleEl = rootEl.querySelector('#denizen-node-optin-toggle');
    const metaEl = rootEl.querySelector('#denizen-node-meta');
    if (creditsEl) creditsEl.textContent = `Credits: ${Math.round(state.credits)}`;
    if (tierEl) tierEl.textContent = String(state.tier || 'visitor').toUpperCase();
    if (superEl) {
      superEl.hidden = !state.isSuperNode;
      superEl.classList.toggle('super', state.isSuperNode);
    }
    const showToggle = state.canContribute || state.isHostNode || state.desktopLinked;
    const optinRow = rootEl.querySelector('.node-optin-row');
    if (optinRow) optinRow.hidden = !showToggle && state.needsDesktopDownload;
    if (toggleEl) {
      suppressToggleEvent = true;
      toggleEl.checked = !!(state.contributing || state.optedIn);
      toggleEl.disabled = busyToggle || !state.canContribute;
      suppressToggleEvent = false;
    }
    if (metaEl) {
      if (busyToggle) metaEl.textContent = 'saving...';
      else if (state.lastError) metaEl.textContent = 'sync failed';
      else metaEl.textContent = state.statusLabel || (state.contributing ? 'active' : 'browser only');
    }
    const downloadEl = rootEl.querySelector('#denizen-node-download');
    if (downloadEl) {
      if (state.sessionReady && state.needsDesktopDownload) {
        const href = state.downloadUrl || '/desktop/download.html';
        const pairDisabled = busyPairing || !getSessionId();
        const pairLabel = busyPairing ? 'Creating link…' : 'Pair Desktop';
        downloadEl.innerHTML = `Browser can't profile this machine. Install <a href="${href}" target="_blank" rel="noopener">Denizen Desktop</a> to link hardware, approve agent access, and contribute compute. <button type="button" class="node-pair-btn" id="denizen-node-pair-btn"${pairDisabled ? ' disabled' : ''}>${pairLabel}</button>`;
        downloadEl.hidden = false;
      } else {
        downloadEl.hidden = true;
      }
    }
    rootEl.dataset.error = state.lastError ? '1' : '0';
    rootEl.dataset.host = state.isHostNode ? '1' : '0';
    rootEl.dataset.needsDesktop = (state.sessionReady && state.needsDesktopDownload) ? '1' : '0';
    rootEl.dataset.contribExpanded = contribExpanded ? '1' : '0';

    const jobsEl = rootEl.querySelector('#denizen-node-jobs');
    const creditsTodayEl = rootEl.querySelector('#denizen-node-credits-today');
    const estJobEl = rootEl.querySelector('#denizen-node-est-job');
    const hwEl = rootEl.querySelector('#denizen-node-hw-score');
    const cpuEl = rootEl.querySelector('#denizen-node-cpu');
    const ramEl = rootEl.querySelector('#denizen-node-ram');
    const gpuEl = rootEl.querySelector('#denizen-node-gpu');
    const howEl = rootEl.querySelector('#denizen-node-how');
    const modesEl = rootEl.querySelector('#denizen-node-modes');
    const levelEl = rootEl.querySelector('#denizen-node-level');
    const accountEl = rootEl.querySelector('#denizen-node-account-link');

    if (jobsEl) jobsEl.textContent = String(Math.round(state.jobsCompleted) || 0);
    if (creditsTodayEl) {
      const dailyTotal = state.creditsEconomy?.daily_totals?.total;
      creditsTodayEl.textContent = Number.isFinite(Number(dailyTotal))
        ? String(Math.round(Number(dailyTotal)))
        : '0';
    }
    if (estJobEl) {
      const est = state.estimatedJobCredits?.amount;
      estJobEl.textContent = Number.isFinite(Number(est)) ? `~${Math.round(Number(est))}` : '—';
    }
    if (hwEl) hwEl.textContent = String(Math.round(state.hardwareScore) || 0);
    if (cpuEl) cpuEl.textContent = formatCpuLine();
    if (ramEl) ramEl.textContent = formatRamLine();
    if (gpuEl) gpuEl.textContent = formatGpuLine();
    const fleetWrap = rootEl.querySelector('#denizen-node-fleet');
    const fleetList = rootEl.querySelector('#denizen-node-fleet-list');
    const fleet = Array.isArray(state.fleet) ? state.fleet : [];
    if (fleetWrap && fleetList) {
      if (fleet.length) {
        fleetWrap.hidden = false;
        fleetList.innerHTML = fleet.map(formatFleetMachine).join('');
      } else {
        fleetWrap.hidden = true;
        fleetList.innerHTML = '';
      }
    }
    if (howEl) {
      howEl.textContent = busyLevel ? 'saving...' : (state.statusLabel || 'idle');
    }
    if (levelEl) {
      const level = String(state.contributionLevel || 'off');
      if (levelEl.value !== level) levelEl.value = level;
      levelEl.disabled = busyLevel || (!state.canContribute && !state.isHostNode);
    }
    if (modesEl) {
      const modes = Array.isArray(state.contributionModes) ? state.contributionModes : [];
      if (!modes.length) {
        modesEl.innerHTML = '<div class="node-mode"><span class="node-mode-dot"></span><span>no modes</span></div>';
      } else {
        modesEl.innerHTML = modes.map((mode) => {
          const active = isModeActive(mode);
          const label = formatModeLabel(mode);
          return `<div class="node-mode${active ? ' active' : ''}"><span class="node-mode-dot"></span><span>${label}</span></div>`;
        }).join('');
      }
    }
    if (accountEl) {
      accountEl.hidden = !globalThis.DenizenAccountPanel;
    }
    const spendBtn = rootEl.querySelector('#denizen-node-spend-btn');
    if (spendBtn) {
      const cost = state.creditsEconomy?.spend_catalog?.priority_boost?.cost
        || 10;
      spendBtn.textContent = `Boost priority (${cost} cr)`;
      spendBtn.disabled = busySpend || !state.sessionReady || state.credits < cost;
    }
    if (restoreEl) {
      const dot = restoreEl.querySelector('.restore-dot');
      if (dot) dot.classList.toggle('idle', !state.contributing);
    }
    applyClientModeLayout();
  }

  function markSessionReady() {
    if (!state.sessionReady) {
      state.sessionReady = true;
      render();
    }
  }

  async function refresh() {
    const sid = getSessionId();
    if (sid) markSessionReady();
    return fetchStatus()
      .then(async (result) => {
        await fetchLiveHardware().catch(() => null);
        return result;
      })
      .catch(async (err) => {
        const msg = err?.name === 'AbortError'
          ? 'Status timed out'
          : (err?.message || 'Status unavailable');
        state.lastError = msg;
        state.tier = getSessionTier() || state.tier;
        await fetchLiveHardware().catch(() => null);
        render();
        throw err;
      });
  }

  async function fetchLiveHardware() {
    const sid = getSessionId();
    if (sid) {
      const res = await fetchWithTimeout(
        `/api/compute/hardware/live?session_id=${encodeURIComponent(sid)}`,
        { method: 'GET', headers: authHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      if (data?.live_usage) {
        applyLiveSnapshot(data.live_usage, data.fleet);
        render();
        emitStatus();
        return data;
      }
    }
    return fetchHealthHardware();
  }

  function startLiveRefresh() {
    stopLiveRefresh();
    liveRefreshTimer = setInterval(() => {
      fetchLiveHardware().catch(() => null);
    }, LIVE_REFRESH_MS);
  }

  function stopLiveRefresh() {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer);
      liveRefreshTimer = null;
    }
  }

  async function fetchContributionSummary() {
    const sid = getSessionId();
    if (!sid) return null;
    const [summaryRes, liveRes] = await Promise.all([
      fetchWithTimeout(
        `/api/compute/contribution/summary?session_id=${encodeURIComponent(sid)}`,
        { method: 'GET', headers: authHeaders() },
      ).catch(() => null),
      fetchWithTimeout(
        `/api/compute/hardware/live?session_id=${encodeURIComponent(sid)}`,
        { method: 'GET', headers: authHeaders() },
      ).catch(() => null),
    ]);
    let next = {};
    if (summaryRes?.ok) {
      const data = await summaryRes.json().catch(() => ({}));
      const summary = data.contribution_summary || data;
      next = mapContributionSummary(summary);
    }
    await fetchCreditsEconomy().catch(() => null);
    if (liveRes?.ok) {
      const liveData = await liveRes.json().catch(() => ({}));
      const live = liveData.live_usage || null;
      if (live) {
        next = {
          ...next,
          cpuPercent: live.cpu_percent ?? next.cpuPercent,
          ramUsedPercent: live.ram?.used_percent ?? next.ramUsedPercent,
          ramUsedMb: live.ram?.used_mb ?? next.ramUsedMb,
          ramMb: live.ram?.total_mb ?? next.ramMb,
          gpuUtilPercent: live.gpu?.utilization_percent ?? next.gpuUtilPercent,
          gpuVramUsedMb: live.gpu?.vram_used_mb ?? next.gpuVramUsedMb,
          gpuModel: live.gpu?.model ?? next.gpuModel,
          cpuCores: live.cpu_cores ?? next.cpuCores,
        };
      }
      if (Array.isArray(liveData.fleet)) next.fleet = liveData.fleet;
    }
    state = { ...state, ...next, lastError: null };
    render();
    emitStatus();
    return { ...state };
  }

  async function fetchStatus() {
    const sid = getSessionId();
    if (!sid) return null;
    state.sessionId = sid;
    state.sessionReady = true;
    const res = await fetchWithTimeout(
      `/api/compute/node/status?session_id=${encodeURIComponent(sid)}`,
      { method: 'GET', headers: authHeaders() },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Status request failed (${res.status})`);
    }
    const next = normalizeStatus(data);
    const liveFields = [
      'cpuPercent', 'ramUsedPercent', 'ramUsedMb', 'ramMb',
      'gpuUtilPercent', 'gpuVramUsedMb', 'gpuModel', 'cpuCores', 'fleet',
    ];
    for (const key of liveFields) {
      if (next[key] == null && state[key] != null) next[key] = state[key];
    }
    state = { ...state, ...next, lastError: null };
    render();
    emitStatus();
    return { ...state };
  }

  async function setContributionLevel(level) {
    const sid = getSessionId();
    if (!sid) throw new Error('Session unavailable');
    const normalized = String(level || 'off').toLowerCase();
    if (!['off', 'light', 'standard', 'max'].includes(normalized)) {
      throw new Error('Invalid contribution level');
    }
    if (!state.canContribute && !state.isHostNode) {
      throw new Error('Install Denizen Desktop on this machine to contribute compute.');
    }
    busyLevel = true;
    state.lastError = null;
    render();
    try {
      const res = await fetchWithTimeout('/api/compute/node/opt-in', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          session_id: sid,
          opt_in: normalized !== 'off',
          contribution_level: normalized,
          hardware: collectHardwareReport(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Level update failed (${res.status})`);
      }
      const next = normalizeStatus(data);
      state = {
        ...state,
        ...next,
        contributionLevel: normalized,
        optedIn: normalized !== 'off',
        lastError: null,
      };
      render();
      emitStatus();
      return { ...state };
    } catch (err) {
      const msg = err?.name === 'AbortError'
        ? 'Request timed out'
        : (err?.message || 'Level update failed');
      state.lastError = msg;
      render();
      emitStatus();
      throw err;
    } finally {
      busyLevel = false;
      render();
    }
  }

  async function setOptIn(enabled) {
    const sid = getSessionId();
    if (!sid) throw new Error('Session unavailable');
    if (!state.canContribute && !state.isHostNode) {
      throw new Error('Install Denizen Desktop on this machine to contribute compute.');
    }
    busyToggle = true;
    state.lastError = null;
    render();
    try {
      const res = await fetchWithTimeout('/api/compute/node/opt-in', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          session_id: sid,
          opt_in: !!enabled,
          hardware: collectHardwareReport(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Opt-in request failed (${res.status})`);
      }
      const next = normalizeStatus(data);
      state = {
        ...state,
        ...next,
        optedIn: typeof next.optedIn === 'boolean' ? next.optedIn : !!enabled,
        lastError: null,
      };
      render();
      emitStatus();
      return { ...state };
    } catch (err) {
      const msg = err?.name === 'AbortError'
        ? 'Request timed out'
        : (err?.message || 'Opt-in failed');
      state.lastError = msg;
      render();
      emitStatus();
      throw err;
    } finally {
      busyToggle = false;
      render();
    }
  }

  function stop() {
    stopLiveRefresh();
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  function startPolling() {
    stop();
    statusTimer = setInterval(() => {
      refresh().catch((err) => {
        state.lastError = err?.message || 'Status refresh failed';
        render();
      });
    }, REFRESH_MS);
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      ensureRoot();
      const sessionApi = getSessionApi();
      if (sessionApi?.init) {
        await sessionApi.init().catch(() => null);
      }
      const refreshStatus = () => {
        refresh().catch(() => null);
      };
      if (getSessionId()) markSessionReady();
      refreshStatus();
      document.addEventListener('denizen-visitor-session-ready', () => {
        markSessionReady();
        refreshStatus();
        if (getSessionApi()?.isCeoPrincipal?.()) startLiveRefresh();
      });
      if (getSessionApi()?.isCeoPrincipal?.()) startLiveRefresh();
      startPolling();
      return { ...state };
    })();
    return initPromise;
  }

  function expandForDrawer() {
    if (!rootEl) return;
    contribExpanded = true;
    rootEl.dataset.contribExpanded = '1';
    const chevron = rootEl.querySelector('#denizen-node-contrib-chevron');
    const toggle = rootEl.querySelector('#denizen-node-contrib-toggle');
    if (chevron) chevron.textContent = '▴';
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    fetchContributionSummary().catch(() => null);
    startLiveRefresh();
  }

  const DenizenNodeUI = {
    init,
    stop,
    refresh,
    fetchStatus,
    fetchContributionSummary,
    setOptIn,
    setContributionLevel,
    hidePanel,
    showPanel,
    togglePanel,
    isPanelHidden,
    expandForDrawer,
    applyClientMode: applyClientModeLayout,
    getState() {
      return { ...state, panelHidden };
    },
  };

  globalThis.DenizenNodeUI = DenizenNodeUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      DenizenNodeUI.init().catch((err) => {
        console.warn('[DenizenNodeUI] init failed:', err?.message || err);
      });
    }, { once: true });
  } else {
    DenizenNodeUI.init().catch((err) => {
      console.warn('[DenizenNodeUI] init failed:', err?.message || err);
    });
  }
})();
