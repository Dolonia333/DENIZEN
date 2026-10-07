/**
 * browser-mirror-panel.js — Live feed of Lucy's Playwright browser.
 * Uses WebSocket JPEG frames + fast HTTP polling (MJPEG is unreliable in Chrome).
 */
(function () {
  'use strict';

  const CHIP_ID = 'denizen-browser-mirror-chip';
  const PANEL_ID = 'denizen-browser-mirror-panel';
  const STYLE_ID = 'denizen-browser-mirror-styles';
  const POLL_OPEN_MS = 1500;
  const POLL_IDLE_MS = 6000;
  const FRAME_POLL_ACTIVE_MS = 220;
  const FRAME_POLL_BACKUP_MS = 500;
  const WS_FRAME_ACTIVE_MS = 1800;
  const POS_KEY = 'denizen-bm-panel-pos';
  const SIZE_KEY = 'denizen-bm-panel-size';
  const MIN_W = 280;
  const MIN_H = 240;
  const MAX_W = () => Math.min(1200, window.innerWidth - 16);
  const MAX_H = () => Math.min(900, window.innerHeight - 16);

  let chipEl = null;
  let panelEl = null;
  let panelOpen = false;
  let chipBindCleanup = null;
  let pollTimer = null;
  let framePollTimer = null;
  let shellReady = false;
  let frameLive = false;
  let snapshotShown = false;
  let lastFrameAt = 0;
  let lastWsFrameAt = 0;
  let liveSlot = 0;
  let framePaintRaf = null;
  let pendingFrame = null;
  let lastFeedKey = '';
  let lastStatusKey = '';
  const frameBlobUrls = [null, null];
  let state = { open: false, status: 'idle', streaming: false, staleFrame: false };
  let boundNpcKey = 'lucy';

  function resolveBoundNpcKey() {
    const asst = globalThis.DenizenVisitorSession?.getAssistant?.();
    return asst?.npc_key || 'lucy';
  }

  function visitorCanUseRealTools() {
    const sess = globalThis.DenizenVisitorSession;
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isCeo?.() || caps?.canUseRealTools?.()) return true;
    if (sess?.isCeoPrincipal?.()) return true;
    // Local CEO play has no visitor session — full browser mirror access.
    if (!sess?.getSessionId?.()) return true;
    return !sess.isDemo?.();
  }

  function browserChipLocked() {
    return !visitorCanUseRealTools();
  }

  function isMobilePhone() {
    const root = document.documentElement;
    return root.classList.contains('denizen-touch')
      && root.classList.contains('denizen-phone');
  }

  function resetPanelLayoutForMobile() {
    if (!panelEl || !isMobilePhone()) return;
    panelEl.removeAttribute('data-positioned');
    panelEl.style.removeProperty('top');
    panelEl.style.removeProperty('left');
    panelEl.style.removeProperty('right');
    panelEl.style.removeProperty('bottom');
    panelEl.style.removeProperty('width');
    panelEl.style.removeProperty('min-height');
    panelEl.style.removeProperty('max-height');
  }

  function setPanelOpen(next) {
    panelOpen = !!next;
    if (panelOpen) {
      globalThis.DenizenMobileSidebar?.close?.();
    }
    if (panelEl) {
      panelEl.classList.toggle('open', panelOpen);
      if (panelOpen) resetPanelLayoutForMobile();
    }
    document.documentElement.classList.toggle('denizen-browser-open', panelOpen);
    if (panelOpen) {
      updatePanel();
      refresh();
      schedulePoll();
    } else {
      stopFramePoll();
      stopPoll();
    }
  }

  function npcDisplayName(key) {
    const k = String(key || 'lucy');
    return k.charAt(0).toUpperCase() + k.slice(1);
  }

  function apiBase() {
    return `/api/npc-browser/${encodeURIComponent(boundNpcKey)}`;
  }

  function mirrorUrl() {
    return `${apiBase()}/mirror`;
  }

  function liveFrameUrl() {
    return `${apiBase()}/live-frame`;
  }

  function inputUrl() {
    return `${apiBase()}/input`;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed !important;
        width: min(760px, calc(100vw - 20px)) !important;
        min-height: 380px !important;
        max-height: min(85vh, 740px) !important;
        display: none;
        flex-direction: column;
        overflow: hidden;
        padding: 0 !important;
        background: #0b1220 !important;
        border: 1px solid rgba(96, 165, 250, 0.4) !important;
        border-radius: 12px !important;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55) !important;
        z-index: 100200 !important;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px)) !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        right: max(10px, env(safe-area-inset-right, 0px)) !important;
        pointer-events: auto;
      }
      #${PANEL_ID}.open { display: flex !important; }
      #${PANEL_ID}[data-positioned] {
        bottom: auto !important;
        right: auto !important;
      }
      #${PANEL_ID} .bm-header {
        flex-shrink: 0;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-family: system-ui, sans-serif;
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      #${PANEL_ID} .bm-header:active { cursor: grabbing; }
      #${PANEL_ID} .bm-title {
        font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #93c5fd;
        display: flex; align-items: center; gap: 6px; min-width: 0;
      }
      #${PANEL_ID} .bm-drag-hint {
        font-size: 9px; font-weight: 600; letter-spacing: 0.04em;
        color: #64748b; white-space: nowrap;
      }
      #${PANEL_ID} .bm-resize-handle {
        position: absolute;
        width: 14px;
        height: 14px;
        z-index: 5;
        touch-action: none;
      }
      #${PANEL_ID} .bm-resize-handle.se { right: 2px; bottom: 2px; cursor: nwse-resize; }
      #${PANEL_ID} .bm-resize-handle.sw { left: 2px; bottom: 2px; cursor: nesw-resize; }
      #${PANEL_ID} .bm-resize-handle.ne { right: 2px; top: 2px; cursor: nesw-resize; }
      #${PANEL_ID} .bm-resize-handle.nw { left: 2px; top: 2px; cursor: nwse-resize; }
      #${PANEL_ID} .bm-status-pill {
        font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.35); color: #cbd5e1;
      }
      #${PANEL_ID} .bm-status-pill.live { color: #86efac; border-color: rgba(34, 197, 94, 0.5); background: rgba(22, 101, 52, 0.25); }
      #${PANEL_ID} .bm-status-pill.searching { color: #fde68a; border-color: rgba(250, 204, 21, 0.5); background: rgba(113, 63, 18, 0.35); }
      #${PANEL_ID} .bm-body {
        flex: 1; min-height: 0; overflow-y: auto; padding: 12px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y;
      }
      #${PANEL_ID} .bm-screen {
        border: 1px solid #334155; border-radius: 10px; overflow: hidden;
        background: #020617; min-height: 300px; display: flex; flex-direction: column;
      }
      #${PANEL_ID} .bm-chrome-bar {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        background: #0f172a; border-bottom: 1px solid #334155; flex-shrink: 0;
      }
      #${PANEL_ID} .bm-dots { display: flex; gap: 5px; flex-shrink: 0; }
      #${PANEL_ID} .bm-dots span { width: 9px; height: 9px; border-radius: 50%; }
      #${PANEL_ID} .bm-dots span:nth-child(1) { background: #ef4444; }
      #${PANEL_ID} .bm-dots span:nth-child(2) { background: #eab308; }
      #${PANEL_ID} .bm-dots span:nth-child(3) { background: #22c55e; }
      #${PANEL_ID} .bm-url {
        flex: 1; min-width: 0; font-size: 10px; color: #94a3b8; background: #020617;
        border: 1px solid #334155; border-radius: 6px; padding: 5px 8px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-family: ui-monospace, monospace;
      }
      #${PANEL_ID} .bm-viewport {
        position: relative; flex: 1; min-height: 200px; max-height: min(52vh, 480px);
        background: #0a0f1a; overflow: hidden;
        overscroll-behavior: contain;
        touch-action: none;
        cursor: crosshair;
        contain: layout paint style;
      }
      #${PANEL_ID} .bm-viewport.control-off { cursor: not-allowed; touch-action: auto; }
      #${PANEL_ID} .bm-control-banner {
        position: absolute; inset: 0; display: none; z-index: 3;
        align-items: center; justify-content: center; text-align: center;
        padding: 20px; pointer-events: none;
        background: rgba(2, 6, 23, 0.78); color: #fca5a5;
        font: 600 12px/1.5 system-ui, sans-serif;
      }
      #${PANEL_ID} .bm-control-banner.on { display: flex; }
      #${PANEL_ID} .bm-control-banner.ok {
        inset: auto 0 0 0; height: auto; padding: 6px 10px;
        color: #bbf7d0; background: rgba(22, 101, 52, 0.88);
        font-size: 10px; font-weight: 600;
      }
      #${PANEL_ID} .bm-live {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: top center;
        background: #0a0f1a;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        will-change: opacity;
      }
      #${PANEL_ID} .bm-live.on {
        opacity: 1;
        visibility: visible;
        z-index: 1;
      }
      #${PANEL_ID} .bm-idle {
        padding: 32px 24px; text-align: center; color: #64748b; font-size: 12px;
        line-height: 1.55; font-family: system-ui, sans-serif; max-width: 340px; margin: auto;
      }
      #${PANEL_ID} .bm-idle.hidden { display: none; }
      #${CHIP_ID}.bm-chip-locked {
        background: #1e293b !important;
        border-color: #475569 !important;
        color: #64748b !important;
        opacity: 0.92;
      }
      html.denizen-touch.denizen-phone:not(.denizen-phone-mode) #${PANEL_ID}.open {
        top: max(6px, env(safe-area-inset-top, 0px)) !important;
        left: max(6px, env(safe-area-inset-left, 0px)) !important;
        right: max(6px, env(safe-area-inset-right, 0px)) !important;
        bottom: max(6px, env(safe-area-inset-bottom, 0px)) !important;
        width: auto !important;
        max-width: none !important;
        min-height: 0 !important;
        max-height: none !important;
        height: auto !important;
        z-index: 100600 !important;
        border-radius: 10px !important;
      }
      html.denizen-phone-mode #${PANEL_ID} {
        display: none !important;
        flex-direction: column !important;
        overflow: hidden !important;
        padding: 0 !important;
        border-radius: 12px !important;
      }
      html.denizen-phone-mode #${PANEL_ID}.open {
        display: flex !important;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-drag-hint,
      html.denizen-phone-mode #${PANEL_ID} .bm-resize-handle {
        display: none !important;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-header {
        padding: 8px 10px;
        cursor: default;
        touch-action: manipulation;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-body {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 8px;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-screen {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-viewport {
        flex: 1 1 auto;
        min-height: 120px;
        max-height: none;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-meta {
        flex: 0 0 auto;
        margin-top: 6px;
      }
      html.denizen-phone-mode #${PANEL_ID} .bm-feed {
        flex: 0 0 auto;
        max-height: 72px;
        margin-top: 6px;
      }
      html.denizen-touch.denizen-phone.denizen-browser-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-drawer-open #denizen-bottom-dock {
        opacity: 0;
        pointer-events: none;
        transform: translateY(110%);
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
      #${PANEL_ID} .bm-close {
        min-width: 44px;
        min-height: 44px;
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid #475569;
        border-radius: 8px;
        font: 600 18px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
      }
      #${PANEL_ID} .bm-locked-msg {
        padding: 22px 20px;
        color: #94a3b8;
        font: 13px/1.5 system-ui, sans-serif;
      }
      #${PANEL_ID} .bm-locked-msg h3 {
        margin: 0 0 10px;
        color: #e2e8f0;
        font-size: 15px;
      }
      #${PANEL_ID} .bm-locked-msg button {
        margin-top: 14px;
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid #475569;
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 13px;
        cursor: pointer;
        min-height: 44px;
        touch-action: manipulation;
      }
      #${PANEL_ID} .bm-meta { margin-top: 10px; font-family: system-ui, sans-serif; font-size: 11px; color: #94a3b8; }
      #${PANEL_ID} .bm-meta strong { color: #e2e8f0; }
      #${PANEL_ID} .bm-feed {
        margin-top: 10px; border: 1px solid #334155; border-radius: 8px;
        background: rgba(15, 23, 42, 0.65); max-height: 100px; overflow-y: auto;
        font-family: ui-monospace, monospace; font-size: 10px;
      }
      #${PANEL_ID} .bm-feed-line { padding: 5px 8px; border-bottom: 1px solid rgba(51, 65, 85, 0.5); color: #bae6fd; }
      #${PANEL_ID} .bm-feed-empty { padding: 10px; color: #64748b; font-style: italic; }
      @media (max-width: 640px) {
        #${PANEL_ID} { width: calc(100vw - 12px) !important; min-height: 320px !important; }
        #${PANEL_ID} .bm-viewport, #${PANEL_ID} .bm-live { min-height: 200px; }
      }
    `;
    document.head.appendChild(style);
  }

  function browserRunsLocally() {
    try {
      const h = window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1';
    } catch (_) {
      return false;
    }
  }

  function idleBrowserHint(npcKey) {
    const name = npcDisplayName(npcKey);
    if (browserRunsLocally()) {
      return `Tell ${name} to <strong>search</strong> something. A Chromium window opens on this PC — the live picture also appears here.`;
    }
    return `Tell ${name} to <strong>search</strong> something. The browser runs on the server — the live feed appears in this 🌐 panel (no separate window on your PC).`;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function shouldRunLivePoll() {
    return !!(state.streaming || state.streamUrl);
  }

  function hasStaleSnapshot() {
    return !!(state.staleFrame && state.frameUrl);
  }

  function statusLabel() {
    if (frameLive && shouldRunLivePoll()) return '● Live feed';
    if (state.streaming) return '● Connecting…';
    if (state.searching || state.status === 'searching') return 'Starting…';
    if (hasStaleSnapshot() && snapshotShown) return 'Last snapshot';
    return 'Idle';
  }

  function statusClass() {
    if ((frameLive && shouldRunLivePoll()) || state.streaming) return 'live';
    if (state.searching || state.status === 'searching') return 'searching';
    return '';
  }

  function setChipState() {
    if (!chipEl) return;
    const touch = document.documentElement.classList.contains('denizen-touch');
    let label = 'browser';
    if (frameLive && shouldRunLivePoll()) {
      chipEl.style.background = '#14532d';
      chipEl.style.borderColor = '#4ade80';
      label = touch ? '' : 'live';
    } else if (state.streaming) {
      chipEl.style.background = '#713f12';
      chipEl.style.borderColor = '#facc15';
      label = touch ? '' : 'connecting…';
    } else if (state.searching || state.status === 'searching') {
      chipEl.style.background = '#713f12';
      chipEl.style.borderColor = '#facc15';
      label = touch ? '' : 'starting…';
    } else {
      chipEl.style.background = '#0f172a';
      chipEl.style.borderColor = '#355';
      label = touch ? '' : 'browser';
    }
    globalThis.DenizenBottomDock?.renderChip?.('denizen-browser-mirror-chip', label, { iconOnly: touch });
    if (!globalThis.DenizenBottomDock?.renderChip) {
      chipEl.textContent = touch ? '🌐' : `🌐 ${label}`;
    }
  }

  function syncChipAccess() {
    if (!chipEl) return;
    const locked = browserChipLocked();
    chipEl.classList.toggle('bm-chip-locked', locked);
    chipEl.setAttribute('aria-disabled', locked ? 'true' : 'false');
    if (locked) {
      const demo = globalThis.DenizenVisitorSession?.isDemo?.();
      chipEl.title = demo
        ? 'Demo preview — Team or CEO access unlocks the live browser mirror'
        : 'Sign in with Team or CEO access to watch the live browser mirror';
      chipEl.style.background = '#1e293b';
      chipEl.style.borderColor = '#475569';
      chipEl.style.color = '#64748b';
      globalThis.DenizenBottomDock?.renderChip?.('denizen-browser-mirror-chip', 'browser', { iconOnly: true });
      if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = '🌐 browser';
      return;
    }
    boundNpcKey = resolveBoundNpcKey();
    chipEl.title = `Watch ${npcDisplayName(boundNpcKey)}'s browser live`;
    setChipState();
  }

  function handleChipPress() {
    buildUI();
    if (browserChipLocked()) {
      showLockedPanel();
      return;
    }
    ensureShell();
    setPanelOpen(!panelOpen);
  }

  function rewireTouch() {
    if (!chipEl) return;
    if (chipBindCleanup) {
      chipBindCleanup();
      chipBindCleanup = null;
    }
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) chipBindCleanup = bind(chipEl, handleChipPress);
    else {
      chipEl.onclick = (e) => {
        e.preventDefault();
        handleChipPress();
      };
    }
  }

  function showLockedPanel() {
    buildUI();
    shellReady = false;
    resetPanelLayoutForMobile();
    panelEl.classList.add('open');
    document.documentElement.classList.add('denizen-browser-open');
    panelOpen = true;
    const demo = globalThis.DenizenVisitorSession?.isDemo?.();
    panelEl.innerHTML = `
      <div class="bm-locked-msg">
        <h3>Live browser mirror</h3>
        <p>Watch your assistant's real browser session in real time — useful when Lucy is researching, filling forms, or browsing for you.</p>
        <p>${demo
    ? '<strong>Demo mode:</strong> this is a preview only. Use <strong>Team access</strong> or <strong>CEO access</strong> to unlock the live feed.'
    : 'Use <strong>Team access</strong> or <strong>CEO access</strong> to unlock this feature.'}</p>
        <button type="button" data-bm-locked-close>Got it</button>
      </div>`;
    const closeBtn = panelEl.querySelector('[data-bm-locked-close]');
    const close = () => setPanelOpen(false);
    if (window.DenizenTouchBind?.bindPress) window.DenizenTouchBind.bindPress(closeBtn, close);
    else closeBtn.addEventListener('click', close);
  }

  function buildUI() {
    injectStyles();
    if (chipEl && panelEl) return;
    const existingChip = document.getElementById(CHIP_ID);
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingChip && existingPanel) {
      chipEl = existingChip;
      panelEl = existingPanel;
      rewireTouch();
      syncChipAccess();
      return;
    }
    chipEl = document.createElement('button');
    chipEl.id = CHIP_ID;
    chipEl.type = 'button';
    chipEl.className = 'denizen-dock-chip';
    Object.assign(chipEl.style, {
      background: '#0f172a', color: '#cfe7ff', border: '1px solid #355',
      cursor: 'pointer',
    });
    boundNpcKey = resolveBoundNpcKey();
    globalThis.DenizenBottomDock?.renderChip?.(CHIP_ID, 'browser');
    if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = '🌐 browser';
    document.body.appendChild(chipEl);
    rewireTouch();

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'dialog');
    panelEl.style.bottom = 'calc(56px + 10px)';
    panelEl.style.right = '10px';
    document.body.appendChild(panelEl);
    syncChipAccess();
  }

  function ensureShell() {
    if (!panelEl || shellReady) return;
    const npcName = npcDisplayName(boundNpcKey).toUpperCase();
    panelEl.innerHTML = `
      <div class="bm-resize-handle nw" data-resize="nw"></div>
      <div class="bm-resize-handle ne" data-resize="ne"></div>
      <div class="bm-resize-handle sw" data-resize="sw"></div>
      <div class="bm-resize-handle se" data-resize="se"></div>
      <div class="bm-header">
        <div class="bm-title">
          <span>${npcName} BROWSER</span>
          <span class="bm-drag-hint">drag header · resize corners</span>
        </div>
        <span class="bm-status-pill" data-bm="status">Idle</span>
        <button type="button" data-bm="refresh" title="Refresh"
          style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer;">↻</button>
        <button type="button" class="bm-close" data-bm="close" aria-label="Close browser panel">×</button>
      </div>
      <div class="bm-body">
        <div class="bm-screen">
          <div class="bm-chrome-bar">
            <div class="bm-dots"><span></span><span></span><span></span></div>
            <div class="bm-url" data-bm="url">about:blank</div>
          </div>
          <div class="bm-viewport">
            <img class="bm-live" data-bm-live="0" data-bm="live" alt="Lucy browser live feed">
            <img class="bm-live" data-bm-live="1" alt="" aria-hidden="true">
            <div class="bm-control-banner" data-bm="control-banner"></div>
            <div class="bm-idle" data-bm="idle">
              ${idleBrowserHint(boundNpcKey)}
            </div>
          </div>
        </div>
        <div class="bm-meta">
          <div data-bm="title"><strong>${npcDisplayName(boundNpcKey)}'s browser</strong></div>
          <div data-bm="query"></div>
        </div>
        <div class="bm-feed" data-bm="feed"><div class="bm-feed-empty">Activity will show here…</div></div>
      </div>`;
    const refreshBtn = panelEl.querySelector('[data-bm="refresh"]');
    const closeBtn = panelEl.querySelector('[data-bm="close"]');
    const bind = window.DenizenTouchBind?.bindPress;
    if (refreshBtn) {
      if (bind) bind(refreshBtn, () => refresh());
      else refreshBtn.addEventListener('click', () => refresh());
    }
    if (closeBtn) {
      if (bind) bind(closeBtn, () => setPanelOpen(false));
      else closeBtn.addEventListener('click', () => setPanelOpen(false));
    }
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (!isMobilePhone()) {
      wirePanelDrag();
      wirePanelResize();
      restorePanelPosition();
      restorePanelSize();
    }
    wirePanelScroll();
    wireRemoteControl();
    shellReady = true;
  }

  function canControlBrowser() {
    if (state.open) return true;
    if (state.streaming && !state.staleFrame && (frameLive || !!state.streamUrl)) return true;
    return false;
  }

  function liveImg() {
    return panelEl?.querySelector(`[data-bm-live="${liveSlot}"]`) || $('[data-bm="live"]');
  }

  function liveImgs() {
    return panelEl ? [...panelEl.querySelectorAll('[data-bm-live]')] : [];
  }

  function revokeFrameBlob(slot) {
    if (frameBlobUrls[slot]) {
      URL.revokeObjectURL(frameBlobUrls[slot]);
      frameBlobUrls[slot] = null;
    }
  }

  function wsFeedActive() {
    return Date.now() - lastWsFrameAt < WS_FRAME_ACTIVE_MS;
  }

  function framePollDelayMs() {
    return wsFeedActive() ? FRAME_POLL_BACKUP_MS : FRAME_POLL_ACTIVE_MS;
  }

  function shouldHttpFramePoll() {
    return !!(panelOpen && shouldRunLivePoll());
  }

  function updateControlBanner(msg) {
    const banner = $('[data-bm="control-banner"]');
    const live = liveImg();
    if (!banner) return;
    if (msg) {
      banner.textContent = msg;
      banner.classList.add('on');
      banner.classList.toggle('ok', /connected|tap|scroll/i.test(msg));
      return;
    }
    const showing = live?.classList.contains('on');
    if (showing && canControlBrowser()) {
      banner.textContent = 'Tap to click · drag to scroll';
      banner.classList.add('on', 'ok');
    } else if (showing && (state.staleFrame || !state.open)) {
      banner.textContent = `Snapshot only — ask ${npcDisplayName(boundNpcKey)} to search again for live control`;
      banner.classList.add('on');
      banner.classList.remove('ok');
    } else {
      banner.classList.remove('on', 'ok');
      banner.textContent = '';
    }
  }

  function mapBrowserCoords(img, clientX, clientY) {
    const rect = img.getBoundingClientRect();
    const srcW = state.viewportWidth || img.naturalWidth || rect.width;
    const srcH = state.viewportHeight || img.naturalHeight || rect.height;
    const x = ((clientX - rect.left) / rect.width) * srcW;
    const y = ((clientY - rect.top) / rect.height) * srcH;
    return {
      x: Math.max(0, Math.min(srcW, Math.round(x))),
      y: Math.max(0, Math.min(srcH, Math.round(y))),
    };
  }

  async function sendBrowserInput(payload) {
    if (!canControlBrowser()) {
      updateControlBanner(`Browser not live — ask ${npcDisplayName(boundNpcKey)} to search again`);
      return;
    }
    try {
      const res = await fetch(inputUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        updateControlBanner(err.error || `Control failed (${res.status})`);
      }
    } catch (_) {
      updateControlBanner('Control request failed — check server');
    }
  }

  function wireRemoteControl() {
    const viewport = panelEl?.querySelector('.bm-viewport');
    if (!viewport || viewport.dataset.bmRemote === '1') return;
    viewport.dataset.bmRemote = '1';

    let pointer = null;
    let didScroll = false;
    let lastScrollAt = 0;

    viewport._bmSyncControl = () => {
      viewport.classList.toggle('control-off', !canControlBrowser());
      updateControlBanner();
    };
    viewport._bmSyncControl();

    viewport.addEventListener('wheel', (e) => {
      if (!canControlBrowser()) return;
      const live = liveImg();
      if (!live) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = mapBrowserCoords(live, e.clientX, e.clientY);
      sendBrowserInput({
        type: 'scroll',
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        x,
        y,
      });
    }, { passive: false, capture: true });

    viewport.addEventListener('pointerdown', (e) => {
      if (!canControlBrowser() || e.button !== 0) return;
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      didScroll = false;
      try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });

    viewport.addEventListener('pointermove', (e) => {
      if (!pointer || pointer.id !== e.pointerId || !canControlBrowser()) return;
      const live = liveImg();
      if (!live) return;
      const dx = pointer.x - e.clientX;
      const dy = pointer.y - e.clientY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      didScroll = true;
      const now = Date.now();
      if (now - lastScrollAt < 45) return;
      lastScrollAt = now;
      const { x, y } = mapBrowserCoords(live, e.clientX, e.clientY);
      sendBrowserInput({
        type: 'scroll',
        deltaX: dx * 2.5,
        deltaY: dy * 2.5,
        x,
        y,
      });
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.preventDefault();
    }, { capture: true });

    const endPointer = (e) => {
      if (!pointer || pointer.id !== e.pointerId) return;
      if (!didScroll && canControlBrowser()) {
        const live = liveImg();
        if (live) {
          const { x, y } = mapBrowserCoords(live, e.clientX, e.clientY);
          sendBrowserInput({ type: 'click', x, y });
        }
      }
      pointer = null;
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    viewport.addEventListener('pointerup', endPointer, { capture: true });
    viewport.addEventListener('pointercancel', endPointer, { capture: true });

    // Keyboard: when the viewport is focused, forward keys into Lucy's browser.
    if (!viewport.hasAttribute('tabindex')) viewport.setAttribute('tabindex', '0');
    viewport.addEventListener('keydown', (e) => {
      if (!canControlBrowser()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key.length === 1) {
        sendBrowserInput({ type: 'type', text: e.key });
        return;
      }
      const map = {
        Enter: 'Enter',
        Backspace: 'Backspace',
        Tab: 'Tab',
        Escape: 'Escape',
        ArrowUp: 'ArrowUp',
        ArrowDown: 'ArrowDown',
        ArrowLeft: 'ArrowLeft',
        ArrowRight: 'ArrowRight',
        Delete: 'Delete',
        Home: 'Home',
        End: 'End',
        PageUp: 'PageUp',
        PageDown: 'PageDown',
      };
      const key = map[e.key];
      if (key) sendBrowserInput({ type: 'key', key });
    }, { capture: true });
  }

  function dockBottomInset() {
    const dockH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--denizen-dock-height'),
      10,
    ) || 56;
    const safe = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom'),
      10,
    ) || 0;
    return dockH + safe + 8;
  }

  function clampPanelPos(left, top) {
    const w = panelEl?.offsetWidth || 320;
    const h = panelEl?.offsetHeight || 380;
    const maxLeft = Math.max(0, window.innerWidth - w);
    const maxTop = Math.max(0, window.innerHeight - h - dockBottomInset());
    return {
      left: Math.max(0, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
    };
  }

  function applyPanelPosition(left, top, persist) {
    if (!panelEl) return;
    const pos = clampPanelPos(left, top);
    panelEl.setAttribute('data-positioned', '1');
    panelEl.style.setProperty('bottom', 'auto', 'important');
    panelEl.style.setProperty('right', 'auto', 'important');
    panelEl.style.setProperty('left', `${pos.left}px`, 'important');
    panelEl.style.setProperty('top', `${pos.top}px`, 'important');
    if (persist) {
      try {
        sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch (_) {}
    }
  }

  function restorePanelPosition() {
    if (!panelEl) return;
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (!Number.isFinite(pos?.left) || !Number.isFinite(pos?.top)) return;
      applyPanelPosition(pos.left, pos.top, false);
    } catch (_) {}
  }

  function applyPanelSize(width, height, persist) {
    if (!panelEl) return;
    const w = Math.max(MIN_W, Math.min(MAX_W(), Math.round(width)));
    const h = Math.max(MIN_H, Math.min(MAX_H(), Math.round(height)));
    panelEl.style.setProperty('width', `${w}px`, 'important');
    panelEl.style.setProperty('min-height', `${h}px`, 'important');
    panelEl.style.setProperty('max-height', `${h}px`, 'important');
    if (persist) {
      try {
        sessionStorage.setItem(SIZE_KEY, JSON.stringify({ width: w, height: h }));
      } catch (_) {}
    }
  }

  function restorePanelSize() {
    if (!panelEl) return;
    try {
      const raw = sessionStorage.getItem(SIZE_KEY);
      if (!raw) return;
      const size = JSON.parse(raw);
      if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height)) return;
      applyPanelSize(size.width, size.height, false);
    } catch (_) {}
  }

  function wirePanelResize() {
    if (!panelEl || panelEl.dataset.bmResize === '1') return;
    panelEl.dataset.bmResize = '1';
    panelEl.style.position = 'fixed';

    panelEl.querySelectorAll('[data-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const corner = handle.getAttribute('data-resize');
        const rect = panelEl.getBoundingClientRect();
        const start = {
          x: e.clientX,
          y: e.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          corner,
        };
        const onMove = (ev) => {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
          let left = start.left;
          let top = start.top;
          let width = start.width;
          let height = start.height;
          if (corner.includes('e')) width = start.width + dx;
          if (corner.includes('w')) {
            width = start.width - dx;
            left = start.left + dx;
          }
          if (corner.includes('s')) height = start.height + dy;
          if (corner.includes('n')) {
            height = start.height - dy;
            top = start.top + dy;
          }
          width = Math.max(MIN_W, Math.min(MAX_W(), width));
          height = Math.max(MIN_H, Math.min(MAX_H(), height));
          if (corner.includes('w')) left = start.left + (start.width - width);
          if (corner.includes('n')) top = start.top + (start.height - height);
          applyPanelPosition(left, top, false);
          applyPanelSize(width, height, false);
        };
        const onUp = (ev) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          const rect = panelEl.getBoundingClientRect();
          applyPanelPosition(rect.left, rect.top, true);
          applyPanelSize(rect.width, rect.height, true);
          try { handle.releasePointerCapture(ev.pointerId); } catch (_) {}
        };
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        e.preventDefault();
        e.stopPropagation();
      });
    });
  }

  function wirePanelDrag() {
    const header = panelEl?.querySelector('.bm-header');
    if (!header || header.dataset.bmDrag === '1') return;
    header.dataset.bmDrag = '1';

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      header.style.cursor = 'grab';
      const rect = panelEl.getBoundingClientRect();
      applyPanelPosition(rect.left, rect.top, true);
      try { header.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      dragging = true;
      header.style.cursor = 'grabbing';
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      applyPanelPosition(startLeft, startTop, false);
      try { header.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    });
    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const pos = clampPanelPos(startLeft + dx, startTop + dy);
      panelEl.style.setProperty('left', `${pos.left}px`, 'important');
      panelEl.style.setProperty('top', `${pos.top}px`, 'important');
      e.preventDefault();
    });
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
  }

  function wirePanelScroll() {
    if (!panelEl || panelEl.dataset.bmScroll === '1') return;
    panelEl.dataset.bmScroll = '1';
    panelEl.querySelectorAll('.bm-body, .bm-feed').forEach((el) => {
      el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    });
  }

  function syncViewportControl() {
    panelEl?.querySelector('.bm-viewport')?._bmSyncControl?.();
  }

  function $(sel) { return panelEl ? panelEl.querySelector(sel) : null; }

  function updateStatusPill() {
    const pill = $('[data-bm="status"]');
    if (!pill) return;
    const label = statusLabel();
    const cls = statusClass();
    const key = `${label}|${cls}`;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    pill.textContent = label;
    pill.className = `bm-status-pill ${cls}`;
  }

  function applyFramePaint(src, opts = {}) {
    const imgs = liveImgs();
    if (!imgs.length || !src) return;
    const nextSlot = imgs.length > 1 ? 1 - liveSlot : 0;
    const next = imgs[nextSlot];
    const cur = imgs[liveSlot];
    const idle = $('[data-bm="idle"]');

    const finish = () => {
      next.classList.add('on');
      if (cur && cur !== next) {
        cur.classList.remove('on');
        cur.removeAttribute('src');
        revokeFrameBlob(liveSlot);
      }
      liveSlot = nextSlot;
      if (idle) idle.classList.add('hidden');
      if (opts.snapshot) {
        snapshotShown = true;
        frameLive = false;
      } else {
        frameLive = true;
        snapshotShown = false;
        lastFrameAt = Date.now();
      }
      setChipState();
      updateStatusPill();
      syncViewportControl();
    };

    if (next.src === src && next.complete) {
      finish();
      return;
    }

    revokeFrameBlob(nextSlot);
    if (src.startsWith('blob:')) frameBlobUrls[nextSlot] = src;

    next.onload = () => {
      next.onload = null;
      next.onerror = null;
      finish();
    };
    next.onerror = () => {
      next.onload = null;
      next.onerror = null;
    };
    next.src = src;
  }

  function queueFramePaint(src, opts = {}) {
    pendingFrame = { src, opts };
    if (framePaintRaf) return;
    framePaintRaf = requestAnimationFrame(() => {
      framePaintRaf = null;
      const job = pendingFrame;
      pendingFrame = null;
      if (job) applyFramePaint(job.src, job.opts);
    });
  }

  function clearViewport(msg) {
    frameLive = false;
    snapshotShown = false;
    lastFrameAt = 0;
    lastWsFrameAt = 0;
    lastStatusKey = '';
    if (framePaintRaf) {
      cancelAnimationFrame(framePaintRaf);
      framePaintRaf = null;
    }
    pendingFrame = null;
    liveImgs().forEach((img, i) => {
      img.classList.remove('on');
      img.removeAttribute('src');
      revokeFrameBlob(i);
    });
    liveSlot = 0;
    const idle = $('[data-bm="idle"]');
    if (idle) {
      idle.classList.remove('hidden');
      if (msg) idle.innerHTML = msg;
    }
    setChipState();
    updateStatusPill();
    syncViewportControl();
  }

  function onFrame(msg) {
    if (!msg?.data || !panelOpen) return;
    if (msg.npcKey && msg.npcKey !== boundNpcKey) return;
    lastWsFrameAt = Date.now();
    const mime = msg.format === 'png' ? 'image/png' : 'image/jpeg';
    queueFramePaint(`data:${mime};base64,${msg.data}`);
    if (msg.url || msg.query || msg.title) ingest(msg);
  }

  async function pullSnapshot() {
    if (!panelOpen || !hasStaleSnapshot() || snapshotShown) return;
    try {
      const res = await fetch(`${state.frameUrl}&t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob || blob.size < 80) return;
      queueFramePaint(URL.createObjectURL(blob), { snapshot: true });
    } catch (_) {}
  }

  async function pullFrame() {
    if (!shouldHttpFramePoll()) return;
    if (wsFeedActive()) return;
    try {
      const res = await fetch(`${liveFrameUrl()}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 404 && !wsFeedActive()) {
          clearViewport(
            `${npcDisplayName(boundNpcKey)}'s browser isn't running on this PC. <strong>Ask them to search again</strong> to open a new window.`
          );
          stopFramePoll();
        }
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size < 80) return;
      queueFramePaint(URL.createObjectURL(blob));
    } catch (_) {}
  }

  function scheduleFramePollTick() {
    if (!shouldHttpFramePoll()) return;
    framePollTimer = setTimeout(async () => {
      framePollTimer = null;
      if (!shouldHttpFramePoll()) return;
      await pullFrame();
      if (shouldHttpFramePoll()) scheduleFramePollTick();
    }, framePollDelayMs());
  }

  function startFramePoll() {
    stopFramePoll();
    if (!wsFeedActive()) pullFrame();
    scheduleFramePollTick();
  }

  function stopFramePoll() {
    if (framePollTimer) clearTimeout(framePollTimer);
    framePollTimer = null;
  }

  function syncFramePoll() {
    if (panelOpen && shouldRunLivePoll()) startFramePoll();
    else stopFramePoll();

    if (panelOpen && hasStaleSnapshot() && !shouldRunLivePoll()) {
      pullSnapshot();
    } else if (!shouldRunLivePoll() && !hasStaleSnapshot()) {
      clearViewport();
    } else if (frameLive && shouldRunLivePoll() && lastFrameAt && Date.now() - lastFrameAt > 8000) {
      clearViewport(
        `Live feed stopped — ${npcDisplayName(boundNpcKey)}'s browser may have closed. <strong>Search again</strong> to reopen.`
      );
      stopFramePoll();
    }
  }

  function renderActivityFeed(feedEl) {
    const lines = Array.isArray(state.activityLog) ? [...state.activityLog] : [];
    if (state.lastActivity && !lines.some((l) => l.line === state.lastActivity)) {
      lines.push({ line: state.lastActivity, at: Date.now() });
    }
    const key = lines.slice(-10).map((e) => `${e.at || ''}:${e.line || ''}`).join('\n');
    if (key === lastFeedKey) return;
    lastFeedKey = key;
    feedEl.innerHTML = lines.length
      ? lines.slice(-10).map((e) => {
        const t = e.at ? new Date(e.at).toLocaleTimeString() : '';
        return `<div class="bm-feed-line"><span style="color:#64748b">${esc(t)}</span> ${esc(e.line || '')}</div>`;
      }).join('')
      : '<div class="bm-feed-empty">Activity will show here…</div>';
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function updatePanel() {
    if (!panelEl || !shellReady) return;
    updateStatusPill();
    const url = state.url || (state.query ? `search: ${state.query}` : 'about:blank');
    const urlEl = $('[data-bm="url"]');
    if (urlEl) { urlEl.textContent = url; urlEl.title = url; }
    const titleEl = $('[data-bm="title"]');
    if (titleEl) {
      const label = state.browserLabel ? ` · ${state.browserLabel}` : '';
      titleEl.innerHTML = `<strong>${esc(state.title || `${npcDisplayName(boundNpcKey)}'s browser`)}</strong>${esc(label)}`;
    }
    const queryEl = $('[data-bm="query"]');
    if (queryEl) queryEl.innerHTML = state.query ? `Query: <strong>${esc(state.query)}</strong>` : '';
    const idle = $('[data-bm="idle"]');
    if (idle && !frameLive && !snapshotShown) {
      if (state.searching || state.status === 'searching') {
        idle.innerHTML = `${npcDisplayName(boundNpcKey)} is launching their browser — <strong>live feed connecting…</strong>`;
      } else if (state.streaming) {
        idle.innerHTML = 'Browser is running — <strong>waiting for first frame…</strong>';
      } else if (hasStaleSnapshot()) {
        const age = state.frameAgeMs ? ` (${Math.round(state.frameAgeMs / 1000)}s old)` : '';
        idle.innerHTML = `Last captured frame${age} — browser is <strong>not open</strong>. Ask ${npcDisplayName(boundNpcKey)} to search again for a live feed.`;
      } else if (state.busyWithOtherNpc && state.activeNpcKey) {
        idle.innerHTML = `Browser is in use by <strong>${esc(npcDisplayName(state.activeNpcKey))}</strong> right now. Ask your assistant to search when it is free.`;
      } else {
        idle.innerHTML = `Tell ${npcDisplayName(boundNpcKey)} to <strong>search</strong> something. Their Playwright browser opens on this PC — the live picture appears here within a few seconds.`;
      }
    }
    const feed = $('[data-bm="feed"]');
    if (feed) renderActivityFeed(feed);
    updateControlBanner();
    syncFramePoll();
  }

  function togglePanel() {
    buildUI();
    if (browserChipLocked()) {
      showLockedPanel();
      return;
    }
    ensureShell();
    setPanelOpen(!panelOpen);
  }

  async function refresh() {
    try {
      const res = await fetch(mirrorUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ingest(await res.json());
    } catch (err) {
      console.warn('[browser-mirror] refresh failed:', err);
    }
  }

  function pollIntervalMs() {
    return (shouldRunLivePoll() || state.searching || state.status === 'searching')
      ? POLL_OPEN_MS
      : POLL_IDLE_MS;
  }

  function ingest(patch) {
    if (patch?.npcKey && patch.npcKey !== boundNpcKey) return;
    const prevMs = pollIntervalMs();
    const wasStreaming = state.streaming;
    state = { ...state, ...patch };
    if (!state.streaming && wasStreaming) {
      frameLive = false;
      lastFrameAt = 0;
    }
    if (!hasStaleSnapshot()) snapshotShown = false;
    setChipState();
    if ((patch?.searching || patch?.open || patch?.status === 'searching') && !browserChipLocked()) {
      ensureShell();
      setPanelOpen(true);
    }
    if (panelOpen) { ensureShell(); updatePanel(); }
    if (panelOpen && pollIntervalMs() !== prevMs) schedulePoll();
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    if (!panelOpen) return;
    stopPoll();
    pollTimer = setInterval(() => refresh(), pollIntervalMs());
  }

  function afterVisitorSessionReady(fn) {
    const run = () => {
      const sess = globalThis.DenizenVisitorSession;
      if (!sess?.init) return false;
      sess.init().then(fn).catch(() => {});
      return true;
    };
    if (run()) return;
    const poll = setInterval(() => {
      if (run()) clearInterval(poll);
    }, 100);
    setTimeout(() => clearInterval(poll), 20_000);
  }

  function onSessionReady() {
    buildUI();
    syncChipAccess();
    rewireTouch();
    window.DenizenBottomDock?.refresh?.();
    const next = resolveBoundNpcKey();
    if (next !== boundNpcKey) {
      boundNpcKey = next;
      shellReady = false;
      if (chipEl) chipEl.title = `Watch ${npcDisplayName(boundNpcKey)}'s browser live`;
    }
    if (panelOpen) refresh();
  }

  async function init() {
    boundNpcKey = resolveBoundNpcKey();
    buildUI();
    syncChipAccess();
    afterVisitorSessionReady(onSessionReady);
    try {
      if (new URL(window.location.href).searchParams.get('browser')) {
        ensureShell();
        setPanelOpen(true);
      }
    } catch (_) {}
    window.DenizenBrowserMirror = {
      show() {
        buildUI();
        if (browserChipLocked()) {
          showLockedPanel();
          return;
        }
        ensureShell();
        setPanelOpen(true);
      },
      hide() { setPanelOpen(false); },
      toggle: togglePanel,
      rewireTouch,
      refresh,
      ingest,
      onFrame,
      setNpcKey(key) {
        boundNpcKey = String(key || 'lucy').toLowerCase();
        shellReady = false;
        if (chipEl) chipEl.title = `Watch ${npcDisplayName(boundNpcKey)}'s browser live`;
        if (panelOpen) { ensureShell(); updatePanel(); refresh(); }
      },
      npcKey: () => boundNpcKey,
      state: () => ({ ...state }),
    };
    console.log('[BrowserMirror] live feed ready (WS primary + buffered frame poll)');
    try {
      document.dispatchEvent(new CustomEvent('denizen-browser-mirror-ready'));
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
