/**
 * Device profile — phone / tablet / desktop detection for responsive UI.
 * Sets html classes + CSS vars used by panels (Me, Settings, chat, etc.).
 */
(function () {
  'use strict';

  const PHONE_SHORT_EDGE = 520;
  /** iPhone SE / mini width — standard phones (iPhone 14 = 390pt) stay in phone tier */
  const COMPACT_SHORT_EDGE = 376;

  function panelMaxWidthFor(sw, lw, phone, compact, tablet, landscape) {
    if (tablet) {
      return Math.min(540, Math.round(lw * 0.78));
    }
    if (!phone) {
      return 580;
    }
    if (landscape) {
      const widthShare = compact ? 0.84 : 0.86;
      const byViewport = Math.round(lw * widthShare);
      const byHeight = Math.round(sw * 1.48);
      const cap = compact ? 580 : 660;
      const floor = compact ? 500 : 540;
      return Math.max(floor, Math.min(cap, byViewport, byHeight));
    }
    return Math.min(compact ? 400 : 440, Math.round(sw * 0.94));
  }

  function detectTouch() {
    if (typeof window.__DenizenForceTouch === 'boolean') return window.__DenizenForceTouch;
    try {
      return window.matchMedia('(pointer: coarse)').matches
        || navigator.maxTouchPoints > 0
        || ('ontouchstart' in window);
    } catch (_) {
      return false;
    }
  }

  function shortEdge() {
    return Math.min(window.innerWidth, window.innerHeight);
  }

  function longEdge() {
    return Math.max(window.innerWidth, window.innerHeight);
  }

  function computeProfile() {
    const touch = detectTouch();
    const sw = shortEdge();
    const lw = longEdge();
    const landscape = window.innerWidth > window.innerHeight;
    const phone = touch && sw < PHONE_SHORT_EDGE;
    const tablet = touch && !phone;
    const compact = phone && sw < COMPACT_SHORT_EDGE;
    const desktop = !touch;

    let tier = 'desktop';
    if (compact) tier = 'phone-compact';
    else if (phone) tier = 'phone';
    else if (tablet) tier = 'tablet';

    const panelMaxWidth = panelMaxWidthFor(sw, lw, phone, compact, tablet, landscape);

    return {
      tier,
      isTouch: touch,
      isPhone: phone,
      isTablet: tablet,
      isDesktop: desktop,
      isCompactPhone: compact,
      isLandscape: landscape,
      width: window.innerWidth,
      height: window.innerHeight,
      shortEdge: sw,
      longEdge: lw,
      panelMaxWidth,
    };
  }

  const PHONE_SHELL_STYLE_ID = 'denizen-phone-panel-shell';

  function injectPhonePanelShellStyles() {
    if (!document?.head || document.getElementById(PHONE_SHELL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PHONE_SHELL_STYLE_ID;
    style.textContent = `
      :root {
        --denizen-phone-panel-inset: 6px;
      }
      html.denizen-touch.denizen-phone #denizen-llm-tel-panel.open,
      html.denizen-touch.denizen-phone #denizen-mesh-jobs-panel.open,
      html.denizen-touch.denizen-phone #denizen-proposals-panel.open,
      html.denizen-touch.denizen-phone #denizen-diag-panel.open,
      html.denizen-touch.denizen-phone #denizen-browser-mirror-panel.open,
      html.denizen-touch.denizen-phone #denizen-npc-team-panel.open,
      html.denizen-touch.denizen-phone #denizen-content-pipeline-panel.open {
        top: max(var(--denizen-phone-panel-inset), env(safe-area-inset-top, 0px)) !important;
        left: max(var(--denizen-phone-panel-inset), env(safe-area-inset-left, 0px)) !important;
        right: max(var(--denizen-phone-panel-inset), env(safe-area-inset-right, 0px)) !important;
        bottom: max(var(--denizen-phone-panel-inset), env(safe-area-inset-bottom, 0px)) !important;
        width: auto !important;
        max-width: none !important;
        min-height: 0 !important;
        max-height: none !important;
        height: auto !important;
        transform: none !important;
        border-radius: 10px !important;
        z-index: 100600 !important;
        overflow: hidden;
      }
      html.denizen-touch.denizen-phone.denizen-drawer-open #denizen-mobile-drawer {
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        border-radius: 0 !important;
        box-sizing: border-box !important;
        padding:
          max(8px, env(safe-area-inset-top, 0px))
          max(8px, env(safe-area-inset-right, 0px))
          max(8px, env(safe-area-inset-bottom, 0px))
          max(8px, env(safe-area-inset-left, 0px));
      }
      html.denizen-touch.denizen-phone #denizen-llm-tel-panel.open,
      html.denizen-touch.denizen-phone #denizen-mesh-jobs-panel.open,
      html.denizen-touch.denizen-phone #denizen-proposals-panel.open,
      html.denizen-touch.denizen-phone #denizen-npc-team-panel.open,
      html.denizen-touch.denizen-phone #denizen-content-pipeline-panel.open {
        display: flex !important;
        flex-direction: column !important;
      }
      html.denizen-touch.denizen-phone #denizen-diag-panel.open {
        display: block !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      html.denizen-touch.denizen-phone.denizen-llm-tel-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-mesh-jobs-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-proposals-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-diag-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-browser-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-npc-team-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-content-pipeline-open #denizen-bottom-dock,
      html.denizen-touch.denizen-phone.denizen-drawer-open #denizen-bottom-dock {
        opacity: 0;
        pointer-events: none;
        transform: translateY(110%);
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  function resetPhonePanelLayout(panelEl) {
    if (!profile.isPhone || !panelEl) return;
    panelEl.removeAttribute('data-positioned');
    [
      'top', 'left', 'right', 'bottom', 'width', 'min-height', 'max-height', 'transform',
    ].forEach((prop) => panelEl.style.removeProperty(prop));
  }

  let profile = computeProfile();

  function applyProfile(next) {
    profile = next;
    const root = document.documentElement;
    root.classList.toggle('denizen-touch', next.isTouch);
    root.classList.toggle('denizen-desktop', next.isDesktop);
    root.classList.toggle('denizen-phone', next.isPhone);
    root.classList.toggle('denizen-tablet', next.isTablet);
    root.classList.toggle('denizen-compact-phone', next.isCompactPhone);
    root.classList.toggle('denizen-landscape', next.isLandscape);
    root.classList.toggle('denizen-portrait', !next.isLandscape);
    root.dataset.denizenTier = next.tier;
    root.style.setProperty('--denizen-short-edge', `${next.shortEdge}px`);
    root.style.setProperty('--denizen-long-edge', `${next.longEdge}px`);
    root.style.setProperty('--denizen-panel-max-width', `${next.panelMaxWidth}px`);
    window.__DenizenDeviceProfile = { ...next };
    try {
      window.dispatchEvent(new CustomEvent('denizen-device-profile-change', { detail: { ...next } }));
    } catch (_) {}
  }

  function sync() {
    applyProfile(computeProfile());
    return profile;
  }

  injectPhonePanelShellStyles();
  applyProfile(profile);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', () => { window.setTimeout(sync, 100); });

  window.DenizenDeviceProfile = {
    get: () => ({ ...profile }),
    sync,
    tier: () => profile.tier,
    isPhone: () => profile.isPhone,
    isTablet: () => profile.isTablet,
    isDesktop: () => profile.isDesktop,
    isTouch: () => profile.isTouch,
    isCompactPhone: () => profile.isCompactPhone,
    panelMaxWidth: () => profile.panelMaxWidth,
    resetPhonePanelLayout,
  };
})();
