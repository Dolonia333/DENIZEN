/**
 * Bottom dock — unified toolbar for chat, voice, health, LM telemetry, proposals.
 *
 * Desktop: three groups (status left · chat center · voice/tools right) in one bar.
 * Mobile:  same layout, compact chips, safe-area padding, panels full-width.
 */
(function () {
  'use strict';

  const DOCK_ID = 'denizen-bottom-dock';
  const STYLE_ID = 'denizen-bottom-dock-style';

  const SLOT_MAP_DESKTOP = {
    left: [
      'denizen-onboarding-replay-chip',
      'denizen-audio-mode-chip',
      'denizen-diag-chip',
      'denizen-security-chip',
      'denizen-mesh-jobs-chip',
      'denizen-content-pipeline-chip',
      'denizen-llm-tel-chip',
    ],
    center: ['player-chat-fab'],
    right: [
      'denizen-presence-chip',
      'denizen-browser-mirror-chip',
      'denizen-proposals-chip',
      'denizen-mic-button',
    ],
  };

  /** Mobile: mic + voice + LM beside chat so they are not off-screen in the dock scroll. */
  const SLOT_MAP_TOUCH = {
    left: [
      'denizen-onboarding-replay-chip',
      'denizen-audio-mode-chip',
      'denizen-diag-chip',
      'denizen-security-chip',
      'denizen-mesh-jobs-chip',
      'denizen-content-pipeline-chip',
    ],
    center: [
      'denizen-llm-tel-chip',
      'player-chat-fab',
      'denizen-mic-button',
      'denizen-presence-chip',
    ],
    right: [
      'denizen-browser-mirror-chip',
      'denizen-proposals-chip',
    ],
  };

  function slotMap() {
    return document.documentElement.classList.contains('denizen-touch')
      ? SLOT_MAP_TOUCH
      : SLOT_MAP_DESKTOP;
  }

  let dockEl = null;
  let groups = {};
  let resizeObs = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      :root {
        --denizen-dock-height: 56px;
        --denizen-dock-bg: rgba(2, 6, 23, 0.94);
        --denizen-dock-border: #334155;
        --denizen-dock-peek: 10px;
      }

      #${DOCK_ID} {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 100002;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px max(10px, env(safe-area-inset-right, 0px))
                 max(8px, env(safe-area-inset-bottom, 0px))
                 max(10px, env(safe-area-inset-left, 0px));
        background: var(--denizen-dock-bg);
        border-top: 1px solid var(--denizen-dock-border);
        box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(10px);
        pointer-events: auto;
        touch-action: manipulation;
        transform: translateY(0);
        opacity: 1;
        transition: transform 0.22s ease, opacity 0.22s ease, box-shadow 0.22s ease;
      }

      #${DOCK_ID}::before {
        content: "";
        position: absolute;
        top: -10px;
        left: 50%;
        width: 82px;
        height: 4px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.62);
        transform: translateX(-50%);
        opacity: 0;
        transition: opacity 0.18s ease, background 0.18s ease;
      }

      html.denizen-desktop:not(.denizen-dock-open):not(.denizen-chat-open):not(.denizen-proposals-open):not(.denizen-browser-open):not(.denizen-llm-tel-open):not(.denizen-mesh-jobs-open):not(.denizen-diag-open) #${DOCK_ID}:not(:hover):not(:focus-within) {
        transform: translateY(calc(100% - var(--denizen-dock-peek)));
        opacity: 0.72;
        box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.24);
      }

      html.denizen-desktop:not(.denizen-dock-open):not(.denizen-chat-open):not(.denizen-proposals-open):not(.denizen-browser-open):not(.denizen-llm-tel-open):not(.denizen-mesh-jobs-open):not(.denizen-diag-open) #${DOCK_ID}:not(:hover):not(:focus-within)::before {
        opacity: 1;
      }

      html.denizen-desktop #${DOCK_ID}:hover::before,
      html.denizen-desktop #${DOCK_ID}:focus-within::before,
      html.denizen-desktop.denizen-dock-open #${DOCK_ID}::before {
        opacity: 0.35;
        background: rgba(74, 222, 128, 0.7);
      }

      html.denizen-touch #${DOCK_ID} {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow: hidden;
      }
      html.denizen-touch #${DOCK_ID} .denizen-dock-scroll {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 2px;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      html.denizen-touch #${DOCK_ID} .denizen-dock-scroll::-webkit-scrollbar {
        display: none;
      }

      #${DOCK_ID} .denizen-dock-group {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      #${DOCK_ID} .denizen-dock-left {
        flex: 1 1 0;
        justify-content: flex-start;
      }
      #${DOCK_ID} .denizen-dock-center {
        flex: 0 0 auto;
        justify-content: center;
      }
      #${DOCK_ID} .denizen-dock-right {
        flex: 1 1 0;
        justify-content: flex-end;
      }

      /* Reset per-chip fixed positioning once dock owns them */
      #${DOCK_ID} button,
      #${DOCK_ID} #player-chat-fab {
        position: static !important;
        bottom: auto !important;
        left: auto !important;
        right: auto !important;
        top: auto !important;
        transform: none !important;
        margin: 0 !important;
        flex-shrink: 0;
      }

      #${DOCK_ID} .denizen-dock-chip {
        border-radius: 999px !important;
        padding: 6px 11px !important;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace !important;
        min-height: 36px;
        max-width: 168px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: none !important;
      }

      #${DOCK_ID} #denizen-llm-tel-chip {
        min-width: 0 !important;
        max-width: 200px;
        text-align: left !important;
      }

      #${DOCK_ID} #player-chat-fab {
        padding: 9px 22px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        border-width: 2px !important;
        min-height: 40px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35) !important;
      }

      #${DOCK_ID} #denizen-mic-button {
        width: 44px !important;
        height: 44px !important;
        min-width: 44px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        font-size: 20px !important;
        line-height: 1 !important;
      }

      #${DOCK_ID} #denizen-presence-chip {
        display: inline-flex !important;
        align-items: center;
      }

      /* Floating panels sit above the dock */
      #denizen-diag-panel,
      #denizen-mesh-jobs-panel,
      #denizen-proposals-panel,
      #denizen-browser-mirror-panel,
      #denizen-llm-tel-panel,
      #player-chat-panel,
      #denizen-mic-status {
        z-index: 100200 !important;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px)) !important;
        pointer-events: auto !important;
      }
      #denizen-diag-panel,
      #denizen-mesh-jobs-panel,
      #denizen-llm-tel-panel {
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
      }
      #denizen-proposals-panel,
      #denizen-browser-mirror-panel,
      #denizen-mic-status {
        right: max(10px, env(safe-area-inset-right, 0px)) !important;
        left: auto !important;
      }
      #denizen-browser-mirror-panel {
        min-height: 360px !important;
      }
      #denizen-mic-status {
        max-width: min(360px, calc(100vw - 20px)) !important;
      }

      #denizen-work-feed {
        bottom: calc(var(--denizen-dock-height, 56px) + 12px + env(safe-area-inset-bottom, 0px)) !important;
      }

      @media (max-width: 768px) {
        :root { --denizen-dock-height: 52px; }
        #${DOCK_ID} {
          gap: 4px;
          padding: 6px max(6px, env(safe-area-inset-right, 0px))
                   max(6px, env(safe-area-inset-bottom, 0px))
                   max(6px, env(safe-area-inset-left, 0px));
        }
        #${DOCK_ID} .denizen-dock-group { gap: 4px; }
        #${DOCK_ID} .denizen-dock-chip {
          padding: 5px 8px !important;
          font-size: 10px !important;
          min-height: 34px;
          max-width: 88px;
        }
        #${DOCK_ID} #denizen-llm-tel-chip { max-width: 96px; }
        #${DOCK_ID} #player-chat-fab {
          padding: 8px 16px !important;
          font-size: 12px !important;
        }
        #denizen-diag-panel,
        #denizen-mesh-jobs-panel,
        #denizen-llm-tel-panel,
        #denizen-proposals-panel,
        #denizen-browser-mirror-panel {
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          left: max(8px, env(safe-area-inset-left, 0px)) !important;
          right: max(8px, env(safe-area-inset-right, 0px)) !important;
        }
        #player-chat-panel {
          left: max(8px, env(safe-area-inset-left, 0px)) !important;
          right: max(8px, env(safe-area-inset-right, 0px)) !important;
          width: auto !important;
          bottom: calc(var(--denizen-dock-height, 52px) + 10px + env(safe-area-inset-bottom, 0px)) !important;
          max-height: min(42vh, 320px) !important;
        }
      }

      /* Touch: icon-compact dock — phones shrink further via mobile-sidebar.js */
      html.denizen-touch {
        --denizen-dock-height: 40px;
      }
      html.denizen-touch.denizen-phone:not(.denizen-mobile-drawer-mode) {
        --denizen-dock-height: 38px;
      }
      html.denizen-touch #${DOCK_ID} {
        gap: 2px;
        padding: 2px max(4px, env(safe-area-inset-right, 0px))
                 max(2px, env(safe-area-inset-bottom, 0px))
                 max(4px, env(safe-area-inset-left, 0px));
      }
      html.denizen-touch #${DOCK_ID} .denizen-dock-group {
        flex: 0 0 auto;
      }
      html.denizen-touch #${DOCK_ID} .denizen-dock-center {
        flex: 1 1 auto;
        justify-content: center;
        flex-wrap: nowrap;
        gap: 4px;
        min-width: 0;
      }
      html.denizen-touch #${DOCK_ID} #denizen-mic-button {
        flex-shrink: 0;
      }
      html.denizen-touch #${DOCK_ID} .denizen-dock-chip {
        min-height: 40px;
        min-width: 40px;
        max-width: 48px;
        padding: 6px 8px !important;
        font-size: 17px !important;
        line-height: 1 !important;
      }
      html.denizen-touch.denizen-phone #${DOCK_ID} .denizen-dock-chip {
        min-height: 38px;
        min-width: 38px;
        max-width: 44px;
        padding: 5px 7px !important;
        font-size: 16px !important;
      }
      html.denizen-touch #${DOCK_ID} #denizen-llm-tel-chip {
        max-width: 48px;
        font-size: 16px !important;
      }
      html.denizen-touch #${DOCK_ID} #player-chat-fab {
        padding: 6px 12px !important;
        font-size: 17px !important;
        min-height: 38px;
        min-width: 40px;
      }
      html.denizen-touch #${DOCK_ID} #denizen-mic-button {
        width: 40px !important;
        height: 40px !important;
        min-width: 40px !important;
        font-size: 17px !important;
      }
      html.denizen-touch.denizen-landscape #denizen-browser-mirror-panel {
        min-height: min(58dvh, 420px) !important;
      }

      @media (min-width: 769px) {
        #${DOCK_ID} .denizen-dock-chip { max-width: 200px; }
        #${DOCK_ID} #denizen-llm-tel-chip { max-width: 240px; }
      }
    `;
    document.head.appendChild(s);
  }

  function ensureDockScroll() {
    if (!dockEl) return null;
    let scroll = dockEl.querySelector('.denizen-dock-scroll');
    if (scroll) return scroll;
    scroll = document.createElement('div');
    scroll.className = 'denizen-dock-scroll';
    scroll.setAttribute('aria-label', 'Dock tools');
    const kids = Array.from(dockEl.children).filter((el) => el.id !== 'denizen-mobile-menu-btn');
    kids.forEach((el) => scroll.appendChild(el));
    dockEl.appendChild(scroll);
    return scroll;
  }

  function ensureDock() {
    if (dockEl) return dockEl;
    dockEl = document.createElement('div');
    dockEl.id = DOCK_ID;
    dockEl.setAttribute('role', 'toolbar');
    dockEl.setAttribute('aria-label', 'Denizen controls');

    ['left', 'center', 'right'].forEach((side) => {
      const g = document.createElement('div');
      g.className = `denizen-dock-group denizen-dock-${side}`;
      groups[side] = g;
      dockEl.appendChild(g);
    });

    document.body.appendChild(dockEl);
    document.body.classList.add('denizen-dock-ready');
    if (document.documentElement.classList.contains('denizen-touch')) {
      ensureDockScroll();
    }
    return dockEl;
  }

  const CHIP_ICONS = {
    'denizen-onboarding-replay-chip': { tabler: 'book', label: 'City Tour' },
    'denizen-superuser-replay-chip': { tabler: 'map', label: 'Power Tour' },
    'denizen-capabilities-guide-chip': { tabler: 'compass', label: 'City Guide' },
    'denizen-diag-chip': { tabler: 'stethoscope', label: 'Health' },
    'denizen-mesh-jobs-chip': { tabler: 'hexagon', label: 'Power' },
    'denizen-security-chip': { tabler: 'shield', label: 'Security' },
    'denizen-llm-tel-chip': { tabler: 'settings', label: 'LM Stats' },
    'denizen-audio-mode-chip': { tabler: 'volume', label: 'Listen-in' },
    'denizen-presence-chip': { tabler: 'user', label: 'Walk-up' },
    'denizen-browser-mirror-chip': { tabler: 'world-www', label: 'Browser' },
    'denizen-proposals-chip': { tabler: 'clipboard-list', label: 'Approvals' },
    'denizen-content-pipeline-chip': { tabler: 'news', label: 'Newsroom' },
    'player-chat-fab': { tabler: 'messages', label: 'Chat' },
    'denizen-mic-button': { tabler: 'microphone', label: 'Speak' },
  };

  function chipMarkup(entry, compact) {
    const T = globalThis.DenizenTablerIcons;
    const tabler = entry?.tabler;
    const label = entry?.label || '';
    if (!T || !tabler) return label;
    if (compact) return T.icon(tabler, { size: 14 });
    return T.chip(tabler, label, { size: 13 });
  }

  /** Panels call this instead of textContent so Tabler icons stick. */
  function renderChip(id, labelText, opts = {}) {
    const entry = CHIP_ICONS[id];
    const el = document.getElementById(id);
    if (!el || !entry) return;
    const T = globalThis.DenizenTablerIcons;
    const iconName = opts.iconOverride || entry.tabler;
    const label = labelText != null ? String(labelText) : entry.label;
    if (T?.paintChip) {
      T.paintChip(el, iconName, label, {
        iconOnly: opts.iconOnly,
        title: opts.title ?? (opts.iconOnly ? label : undefined),
      });
      el.dataset.fullLabel = el.innerHTML;
      return;
    }
    el.textContent = label;
  }

  /** Tabler loads lazily — drop text-only labels cached before icons were ready. */
  function clearStaleChipCache() {
    if (!globalThis.DenizenTablerIcons) return;
    for (const id of Object.keys(CHIP_ICONS)) {
      const el = document.getElementById(id);
      if (!el?.dataset?.fullLabel) continue;
      if (!/<i[^>]*class="[^"]*\bti\b/.test(el.dataset.fullLabel)) {
        delete el.dataset.fullLabel;
        delete el.dataset.compact;
      }
    }
  }

  function compactChipLabels() {
    clearStaleChipCache();
    const compact = document.documentElement.classList.contains('denizen-touch');
    const dynamicLabels = new Set([
      'denizen-presence-chip',
      'denizen-audio-mode-chip',
      'denizen-llm-tel-chip',
      'denizen-mesh-jobs-chip',
    ]);
    for (const [id, entry] of Object.entries(CHIP_ICONS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (dynamicLabels.has(id)) continue;
      if (id === 'player-chat-fab' && window.__DenizenPlayerChat?.isOpen) {
        if (!el.dataset.fullLabel) {
          el.dataset.fullLabel = window.__DenizenPlayerChat._chatFabClosedLabel?.() || chipMarkup(entry, false);
        }
        window.__DenizenPlayerChat._syncFabLabel?.();
        continue;
      }
      if (compact) {
        if (!el.dataset.fullLabel) el.dataset.fullLabel = chipMarkup(entry, false);
        el.innerHTML = chipMarkup(entry, true);
        el.title = entry.label || el.dataset.fullLabel;
        el.dataset.compact = '1';
      } else if (el.dataset.compact === '1') {
        el.innerHTML = el.dataset.fullLabel || chipMarkup(entry, false);
        delete el.dataset.compact;
      } else if (!el.dataset.fullLabel) {
        el.innerHTML = chipMarkup(entry, false);
        el.dataset.fullLabel = el.textContent || entry.label;
      }
    }
  }

  function adoptChip(id, side) {
    const el = document.getElementById(id);
    const group = groups[side];
    if (!el || !group || el.parentElement === group) return !!el;
    if (id !== 'denizen-mic-button' && id !== 'player-chat-fab') {
      el.classList.add('denizen-dock-chip');
    }
    group.appendChild(el);
    return true;
  }

  function wireDockTouch() {
    window.DenizenVoiceInput?.rewireTouch?.();
    window.DenizenProximityAudio?.rewireTouch?.();
    window.DenizenLlmTelemetry?.rewireTouch?.();
    window.DenizenBrowserMirror?.rewireTouch?.();
    window.__DenizenChatBootstrap?.rewireFab?.(window.__DenizenPlayerChat);
    globalThis.DenizenVisitorOnboarding?.rewireReplayChip?.();
  }

  function adoptAll() {
    ensureDock();
    if (document.documentElement.classList.contains('denizen-touch')) {
      ensureDockScroll();
    }
    let found = 0;
    let total = 0;
    let moved = 0;
    for (const [side, ids] of Object.entries(slotMap())) {
      for (const id of ids) {
        total += 1;
        const el = document.getElementById(id);
        const group = groups[side];
        const wasInDock = !!(el && group && el.parentElement === group);
        if (adoptChip(id, side)) found += 1;
        if (el && group && !wasInDock && el.parentElement === group) moved += 1;
      }
    }
    compactChipLabels();
    wireDockTouch();
    if (document.documentElement.classList.contains('denizen-touch')) {
      globalThis.DenizenMobileSidebar?.ensureMenuButton?.();
    }
    if (moved > 0) {
      globalThis.DenizenMobileSidebar?.relayout?.();
    }
    updateDockHeight();
    return { found, total };
  }

  function updateDockHeight() {
    if (!dockEl) return;
    const h = Math.ceil(dockEl.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty('--denizen-dock-height', `${h}px`);
    }
  }

  function watchDockSize() {
    if (!dockEl || resizeObs) return;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(updateDockHeight);
      resizeObs.observe(dockEl);
    }
    window.addEventListener('resize', () => { compactChipLabels(); updateDockHeight(); });
    window.addEventListener('orientationchange', () => setTimeout(() => {
      adoptAll();
      compactChipLabels();
      updateDockHeight();
      window.DenizenMobilePlay?.syncLayout?.();
    }, 120));
  }

  let dockRevealTimer = null;

  function revealDock(ms = 2600) {
    if (!document.documentElement.classList.contains('denizen-desktop')) return;
    document.documentElement.classList.add('denizen-dock-open');
    if (dockRevealTimer) clearTimeout(dockRevealTimer);
    dockRevealTimer = setTimeout(() => {
      document.documentElement.classList.remove('denizen-dock-open');
      dockRevealTimer = null;
    }, ms);
  }

  function wireAutoHideDock() {
    if (!dockEl || dockEl.dataset.autoHideWired === '1') return;
    dockEl.dataset.autoHideWired = '1';
    dockEl.addEventListener('pointerenter', () => revealDock(5000));
    dockEl.addEventListener('pointerdown', () => revealDock(5000));
    dockEl.addEventListener('focusin', () => revealDock(5000));
    dockEl.addEventListener('pointerleave', () => revealDock(900));
    window.addEventListener('mousemove', (e) => {
      if (!document.documentElement.classList.contains('denizen-desktop')) return;
      if (window.innerHeight - e.clientY <= 72) revealDock(2200);
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Alt') revealDock(3000);
    });
  }

  /** Lazy-loaded panels create their chips long after boot — adopt them whenever they appear. */
  function watchLateChips() {
    if (typeof MutationObserver === 'undefined') return;
    const ids = new Set();
    for (const map of [SLOT_MAP_DESKTOP, SLOT_MAP_TOUCH]) {
      for (const sideIds of Object.values(map)) sideIds.forEach((id) => ids.add(id));
    }
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node?.nodeType === 1 && ids.has(node.id)) {
            adoptAll();
            return;
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });
  }

  function boot() {
    injectStyles();
    ensureDock();
    adoptAll();
    watchDockSize();
    wireAutoHideDock();
    watchLateChips();

    let passes = 0;
    const poll = setInterval(() => {
      const { found, total } = adoptAll();
      passes += 1;
      if (found >= total || passes >= 12) clearInterval(poll);
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('denizen-deferred-scripts-ready', () => {
    clearStaleChipCache();
    adoptAll();
  });

  window.DenizenBottomDock = {
    refresh: adoptAll,
    renderChip,
    height: () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--denizen-dock-height'), 10) || 56,
  };
})();
