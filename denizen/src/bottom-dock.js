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
      'denizen-audio-mode-chip',
      'denizen-diag-chip',
      'denizen-security-chip',
      'denizen-llm-tel-chip',
    ],
    center: ['player-chat-fab'],
    right: [
      'denizen-presence-chip',
      'denizen-ceo-mode-chip',
      'denizen-browser-mirror-chip',
      'denizen-proposals-chip',
      'denizen-mic-button',
    ],
  };

  /** Mobile: mic + voice + LM beside chat so they are not off-screen in the dock scroll. */
  const SLOT_MAP_TOUCH = {
    left: ['denizen-audio-mode-chip', 'denizen-diag-chip', 'denizen-security-chip'],
    center: [
      'denizen-llm-tel-chip',
      'player-chat-fab',
      'denizen-mic-button',
      'denizen-presence-chip',
    ],
    right: [
      'denizen-ceo-mode-chip',
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
      }

      html.denizen-touch #${DOCK_ID} {
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      html.denizen-touch #${DOCK_ID}::-webkit-scrollbar {
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

      /* Touch: icon-compact dock — fits portrait + landscape like desktop */
      html.denizen-touch {
        --denizen-dock-height: 48px;
      }
      html.denizen-touch #${DOCK_ID} {
        gap: 3px;
        padding: 4px max(6px, env(safe-area-inset-right, 0px))
                 max(4px, env(safe-area-inset-bottom, 0px))
                 max(6px, env(safe-area-inset-left, 0px));
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
        font-size: 18px !important;
        line-height: 1 !important;
      }
      html.denizen-touch #${DOCK_ID} #denizen-llm-tel-chip {
        max-width: 48px;
        font-size: 16px !important;
      }
      html.denizen-touch #${DOCK_ID} #player-chat-fab {
        padding: 7px 14px !important;
        font-size: 18px !important;
        min-height: 40px;
        min-width: 44px;
      }
      html.denizen-touch #${DOCK_ID} #denizen-mic-button {
        width: 44px !important;
        height: 44px !important;
        min-width: 44px !important;
        font-size: 18px !important;
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
    return dockEl;
  }

  const CHIP_ICONS = {
    'denizen-diag-chip': '⋯',
    'denizen-security-chip': '🛡️',
    'denizen-llm-tel-chip': '⚙',
    'denizen-audio-mode-chip': '🔊',
    'denizen-presence-chip': '👤',
    'denizen-ceo-mode-chip': '👔',
    'denizen-browser-mirror-chip': '🌐',
    'denizen-proposals-chip': '📋',
    'player-chat-fab': '💬',
    'denizen-mic-button': '🎤',
  };

  function compactChipLabels() {
    const compact = document.documentElement.classList.contains('denizen-touch');
    const dynamicLabels = new Set([
      'denizen-presence-chip',
      'denizen-audio-mode-chip',
      'denizen-llm-tel-chip',
    ]);
    for (const [id, icon] of Object.entries(CHIP_ICONS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (dynamicLabels.has(id)) continue;
      if (compact) {
        if (!el.dataset.fullLabel) el.dataset.fullLabel = el.textContent || icon;
        el.textContent = icon;
        el.title = el.dataset.fullLabel;
        el.dataset.compact = '1';
      } else if (el.dataset.compact === '1') {
        el.textContent = el.dataset.fullLabel || el.textContent;
        delete el.dataset.compact;
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
  }

  function adoptAll() {
    ensureDock();
    let found = 0;
    let total = 0;
    for (const [side, ids] of Object.entries(slotMap())) {
      for (const id of ids) {
        total += 1;
        if (adoptChip(id, side)) found += 1;
      }
    }
    compactChipLabels();
    wireDockTouch();
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

  function boot() {
    injectStyles();
    ensureDock();
    adoptAll();
    watchDockSize();

    let passes = 0;
    const poll = setInterval(() => {
      adoptAll();
      passes += 1;
      if (passes > 40) clearInterval(poll);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenBottomDock = {
    refresh: adoptAll,
    height: () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--denizen-dock-height'), 10) || 56,
  };
})();
