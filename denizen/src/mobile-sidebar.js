/**
 * Mobile drawer — profile + compute full-screen sheet (touch devices).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-mobile-sidebar-style';
  const TOGGLE_ID = 'denizen-drawer-toggle';
  const DRAWER_ID = 'denizen-mobile-drawer';
  const BACKDROP_ID = 'denizen-mobile-drawer-backdrop';
  const MENU_BTN_ID = 'denizen-mobile-menu-btn';
  const BODY_ID = 'denizen-mobile-drawer-body';
  const FALLBACK_ID = 'denizen-mobile-drawer-fallback';

  const PANEL_IDS = [
    'denizen-account-panel',
    'denizen-node-ui-chip',
  ];

  let drawerEl = null;
  let backdropEl = null;
  let toggleEl = null;
  let menuBtn = null;
  let open = false;
  let activeTab = 'profile';
  let initialized = false;
  let touchModeApplied = false;
  let lastToggleAt = 0;

  function isTouchDrawerMode() {
    return document.documentElement.classList.contains('denizen-touch');
  }

  function isPhoneDrawerMode() {
    return isTouchDrawerMode()
      && document.documentElement.classList.contains('denizen-phone');
  }

  function getToggle() {
    return document.getElementById(TOGGLE_ID);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOGGLE_ID} {
        position: fixed;
        opacity: 0;
        width: 1px;
        height: 1px;
        margin: 0;
        padding: 0;
        border: 0;
        clip: rect(0 0 0 0);
        overflow: hidden;
        white-space: nowrap;
        pointer-events: none;
        z-index: -1;
      }

      html.denizen-mobile-drawer-mode {
        --denizen-dock-height: 34px;
        --denizen-play-gap: 0px;
      }
      html.denizen-mobile-drawer-mode.denizen-phone #denizen-bottom-dock .denizen-dock-chip,
      html.denizen-mobile-drawer-mode.denizen-phone #denizen-bottom-dock #player-chat-fab,
      html.denizen-mobile-drawer-mode.denizen-phone #denizen-bottom-dock #denizen-mic-button {
        min-height: 34px !important;
        min-width: 34px !important;
        max-width: 40px !important;
        padding: 4px 6px !important;
        font-size: 15px !important;
      }

      html.denizen-mobile-drawer-mode #denizen-visitor-credits-chip,
      html.denizen-mobile-drawer-mode #denizen-node-ui-restore {
        display: none !important;
      }

      html.denizen-mobile-drawer-mode:not(.denizen-drawer-open) #denizen-account-panel,
      html.denizen-mobile-drawer-mode:not(.denizen-drawer-open) #denizen-node-ui-chip {
        display: none !important;
      }

      #${MENU_BTN_ID} {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        position: fixed !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        bottom: calc(var(--denizen-dock-height, 40px) + max(6px, env(safe-area-inset-bottom, 0px))) !important;
        top: auto !important;
        right: auto !important;
        transform: none !important;
        min-height: 44px !important;
        min-width: 52px !important;
        padding: 6px 10px !important;
        margin: 0 !important;
        border-radius: 10px !important;
        border: 2px solid #60a5fa !important;
        background: rgba(15, 23, 42, 0.96) !important;
        color: #93c5fd !important;
        font: 700 13px/1 system-ui, sans-serif !important;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.35);
        flex-shrink: 0;
        pointer-events: auto !important;
        z-index: 2147483640 !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      }
      html.denizen-drawer-open #${MENU_BTN_ID} {
        border-color: #4ade80 !important;
        color: #4ade80 !important;
        background: rgba(20, 83, 45, 0.5) !important;
        z-index: 2147483646 !important;
      }
      /* Full-screen phone drawer has its own ✕ — the floating toggle would
         cover form fields at the bottom of the drawer */
      html.denizen-phone.denizen-drawer-open #${MENU_BTN_ID} {
        display: none !important;
      }
      /* Profile lives in the phone app — no floating Me chip on touch */
      html.denizen-touch #${MENU_BTN_ID} {
        display: none !important;
      }

      #${BACKDROP_ID} {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 2147483641;
        background: rgba(2, 6, 23, 0.72);
        border: none;
        padding: 0;
        margin: 0;
        touch-action: manipulation;
        pointer-events: auto;
        cursor: pointer;
      }
      html.denizen-drawer-open #${BACKDROP_ID},
      #${TOGGLE_ID}:checked + #${BACKDROP_ID} {
        display: block !important;
      }

      #${DRAWER_ID} {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        flex-direction: column;
        background: rgba(2, 6, 23, 0.98);
        pointer-events: auto;
        padding:
          max(10px, env(safe-area-inset-top, 0px))
          max(10px, env(safe-area-inset-right, 0px))
          max(10px, env(safe-area-inset-bottom, 0px))
          max(10px, env(safe-area-inset-left, 0px));
        overflow: hidden;
      }
      html.denizen-drawer-open #${DRAWER_ID},
      #${TOGGLE_ID}:checked + #${BACKDROP_ID} + #${DRAWER_ID} {
        display: flex !important;
      }

      #${DRAWER_ID} .drawer-head {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 12px;
        flex-shrink: 0;
      }
      #${DRAWER_ID} .drawer-grab {
        display: none;
      }
      #${DRAWER_ID} .drawer-title {
        color: #f8fafc;
        font: 700 18px/1.2 system-ui, sans-serif;
      }
      #${DRAWER_ID} .drawer-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${DRAWER_ID} .drawer-subtitle {
        color: #94a3b8;
        font: 500 13px/1.3 system-ui, sans-serif;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${DRAWER_ID} .drawer-close {
        min-width: 44px;
        min-height: 44px;
        border-radius: 10px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.9);
        color: #e2e8f0;
        font: 600 22px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
      }
      #${DRAWER_ID} .drawer-tabs {
        display: flex;
        flex: 1;
        min-width: 0;
        gap: 8px;
        padding: 4px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid #1e293b;
      }
      #${DRAWER_ID} .drawer-tab {
        flex: 1;
        min-height: 44px;
        border: none;
        border-radius: 9px;
        background: transparent;
        color: #94a3b8;
        font: 600 14px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${DRAWER_ID} .drawer-tab.active {
        background: rgba(59, 130, 246, 0.22);
        color: #e2e8f0;
        box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.45);
      }
      #${BODY_ID} {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
      }
      #${DRAWER_ID}[data-tab="profile"] #${BODY_ID} #denizen-node-ui-chip {
        display: none !important;
      }
      #${DRAWER_ID}[data-tab="compute"] #${BODY_ID} #denizen-account-panel {
        display: none !important;
      }
      #${BODY_ID} #denizen-account-panel,
      #${BODY_ID} #denizen-node-ui-chip {
        position: static !important;
        top: auto !important;
        right: auto !important;
        left: auto !important;
        bottom: auto !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        margin: 0 !important;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: auto !important;
        box-shadow: none !important;
        border-radius: 12px !important;
        padding: 14px 16px !important;
        font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        gap: 12px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip[data-panel-hidden="1"] {
        display: flex !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-name {
        font-size: 17px !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-email {
        font-size: 13px !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-toggle {
        display: none !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-stats {
        display: flex !important;
        gap: 10px !important;
        padding-top: 10px !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-stat-row {
        font-size: 14px !important;
        min-height: 28px;
        align-items: center;
      }
      #${BODY_ID} #denizen-account-panel .acct-stat-val {
        font-size: 15px !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-logout {
        min-height: 44px !important;
        padding: 10px 14px !important;
        font-size: 14px !important;
        border-radius: 8px !important;
      }
      #${BODY_ID} #denizen-account-panel .acct-tier {
        font-size: 11px !important;
        padding: 3px 8px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-hide-btn {
        display: none !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-credits {
        font-size: 20px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-badge {
        font-size: 11px !important;
        padding: 4px 9px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-optin-row {
        min-height: 44px;
        align-items: center;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-optin-label {
        font-size: 15px !important;
        gap: 12px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-optin {
        width: 22px !important;
        height: 22px !important;
        flex-shrink: 0;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-meta {
        font-size: 13px !important;
        max-width: none !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-contrib-toggle {
        display: none !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-contrib-body {
        display: flex !important;
        gap: 10px !important;
        padding-top: 8px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-contrib-row {
        font-size: 14px !important;
        min-height: 30px;
        align-items: center;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-contrib-val {
        font-size: 15px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-level-select {
        min-height: 44px !important;
        font-size: 15px !important;
        padding: 8px 10px !important;
        max-width: 160px !important;
        border-radius: 8px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-pair-btn {
        min-height: 48px !important;
        font-size: 15px !important;
        padding: 12px 14px !important;
        border-radius: 10px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-download {
        font-size: 14px !important;
        line-height: 1.5 !important;
        padding: 12px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-fleet-title {
        font-size: 12px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-fleet-card .name {
        font-size: 14px !important;
      }
      #${BODY_ID} #denizen-node-ui-chip .node-fleet-card .stats {
        font-size: 13px !important;
      }
      #${FALLBACK_ID} {
        display: block;
        color: #e2e8f0;
        font: 13px/1.45 system-ui, sans-serif;
        padding: 12px;
        border: 1px solid #334155;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.55);
      }
      #${FALLBACK_ID}[data-hidden="1"] {
        display: none;
      }
      #${FALLBACK_ID} .fb-name {
        font-weight: 700;
        font-size: 15px;
        margin-bottom: 4px;
      }
      #${FALLBACK_ID} .fb-email {
        color: #94a3b8;
        font-size: 12px;
        margin-bottom: 10px;
      }
      #${FALLBACK_ID} .fb-logout {
        min-height: 44px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #7f1d1d;
        background: rgba(127, 29, 29, 0.25);
        color: #fecaca;
        font: 600 13px/1 system-ui, sans-serif;
        width: 100%;
        touch-action: manipulation;
      }
      #${FALLBACK_ID} .fb-hint {
        color: #94a3b8;
        font-size: 11px;
        margin-top: 10px;
      }
      html.denizen-drawer-open #denizen-bottom-dock .denizen-dock-scroll {
        pointer-events: none;
      }

      /* Small phones — short landscape viewport (iPhone SE, mini, etc.) */
      html.denizen-phone #${MENU_BTN_ID} {
        min-height: 40px !important;
        min-width: 48px !important;
        padding: 4px 8px !important;
        font-size: 12px !important;
        border-radius: 8px !important;
        bottom: calc(var(--denizen-dock-height, 34px) + 4px + env(safe-area-inset-bottom, 0px)) !important;
      }
      html.denizen-phone.denizen-drawer-open #${DRAWER_ID} {
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
      }
      html.denizen-phone #${DRAWER_ID} .drawer-grab {
        display: block;
        width: 36px;
        height: 4px;
        margin: 2px auto 6px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.45);
        flex-shrink: 0;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-title {
        display: none;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-head {
        gap: 6px;
        margin-bottom: 6px;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-tabs {
        flex: 1;
        gap: 4px;
        padding: 3px;
        border-radius: 10px;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-tab {
        min-height: 40px;
        font-size: 13px;
        border-radius: 8px;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-close {
        min-width: 40px;
        min-height: 40px;
        font-size: 20px;
        border-radius: 8px;
      }
      html.denizen-phone #${DRAWER_ID} .drawer-subtitle {
        font-size: 12px;
        margin-top: 0;
        padding: 0 2px;
      }
      html.denizen-phone #${BODY_ID} {
        gap: 8px;
        padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
      }
      html.denizen-phone #${BODY_ID} {
        align-items: flex-start;
        padding-inline: 10px;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel,
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip {
        padding: 10px 12px !important;
        border-radius: 10px !important;
        font-size: 14px !important;
        gap: 8px !important;
        box-sizing: border-box !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel {
        width: auto !important;
        max-width: 100% !important;
        min-width: 0 !important;
        align-self: flex-start !important;
        margin-inline: 0 !important;
        padding: 8px 10px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip {
        width: 100% !important;
        max-width: 100% !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-top {
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        width: auto;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-identity {
        width: auto;
        max-width: 100%;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-actions {
        flex-direction: row;
        align-items: center;
        width: auto;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-name {
        font-size: 15px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-email {
        font-size: 12px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-stats {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        padding-top: 6px !important;
        width: auto;
        min-width: 0;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-stat-row {
        font-size: 12px !important;
        min-height: 0;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: auto;
        min-width: 0;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-stat-val {
        font-size: 13px !important;
        text-align: right;
        flex-shrink: 0;
      }
      html.denizen-phone #${BODY_ID} #denizen-account-panel .acct-logout {
        min-height: 36px !important;
        min-width: 0 !important;
        width: auto !important;
        padding: 6px 12px !important;
        font-size: 13px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-top {
        flex-wrap: wrap;
        gap: 6px;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-credits {
        font-size: 17px !important;
        flex: 1 1 100%;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-optin-row {
        min-height: 40px;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-optin-label {
        font-size: 14px !important;
        gap: 10px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-optin {
        width: 20px !important;
        height: 20px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-meta {
        font-size: 12px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-contrib-body {
        display: grid !important;
        grid-template-columns: 1fr 1fr;
        gap: 4px 10px !important;
        padding-top: 4px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-contrib-row {
        font-size: 12px !important;
        min-height: 0;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-contrib-row:has(#denizen-node-level),
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-fleet,
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-modes,
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-download {
        grid-column: 1 / -1;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-contrib-val {
        font-size: 13px !important;
        text-align: left;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-live-label {
        display: none;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-level-select {
        min-height: 40px !important;
        font-size: 14px !important;
        max-width: none !important;
        width: 100%;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-pair-btn {
        min-height: 44px !important;
        font-size: 14px !important;
        padding: 10px 12px !important;
      }
      html.denizen-phone #${BODY_ID} #denizen-node-ui-chip .node-fleet-card {
        padding: 5px 8px;
      }
      @media (max-height: 400px) {
        html.denizen-phone.denizen-drawer-open #${DRAWER_ID} {
          max-height: 98dvh;
          padding-top: 4px;
        }
        html.denizen-phone #${DRAWER_ID} .drawer-head {
          margin-bottom: 4px;
          gap: 4px;
        }
        html.denizen-phone #${DRAWER_ID} .drawer-tab {
          min-height: 36px;
          font-size: 12px;
        }
        html.denizen-phone #${BODY_ID} #denizen-account-panel,
        html.denizen-phone #${BODY_ID} #denizen-node-ui-chip {
          padding: 8px 10px !important;
          font-size: 13px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShell() {
    toggleEl = getToggle();
    if (!toggleEl) {
      toggleEl = document.createElement('input');
      toggleEl.type = 'checkbox';
      toggleEl.id = TOGGLE_ID;
      toggleEl.setAttribute('aria-hidden', 'true');
      toggleEl.tabIndex = -1;
      document.body.appendChild(toggleEl);
      toggleEl.addEventListener('change', () => {
        applyOpenState(toggleEl.checked, { syncToggle: false });
      });
    }

    if (!backdropEl) {
      backdropEl = document.createElement('button');
      backdropEl.id = BACKDROP_ID;
      backdropEl.type = 'button';
      backdropEl.setAttribute('aria-label', 'Close menu');
      bindDrawerPress(backdropEl, () => closeDrawer());
      toggleEl.insertAdjacentElement('afterend', backdropEl);
    }

    if (!drawerEl) {
      drawerEl = document.createElement('aside');
      drawerEl.id = DRAWER_ID;
      drawerEl.setAttribute('aria-label', 'Citizen ID and City Power menu');
      drawerEl.innerHTML = `
        <div class="drawer-head">
          <div class="drawer-grab" aria-hidden="true"></div>
          <div class="drawer-title">Me</div>
          <div class="drawer-toolbar">
            <div class="drawer-tabs" role="tablist" aria-label="Me sections">
              <button type="button" class="drawer-tab active" data-tab="profile" role="tab" aria-selected="true">Citizen ID</button>
              <button type="button" class="drawer-tab" data-tab="compute" role="tab" aria-selected="false">City Power</button>
            </div>
            <button type="button" class="drawer-close" aria-label="Close menu">×</button>
          </div>
          <div class="drawer-subtitle" id="denizen-drawer-subtitle">Your place in Denizen</div>
        </div>
        <div id="${BODY_ID}">
          <div id="${FALLBACK_ID}">
            <div class="fb-name" id="denizen-drawer-fb-name">Guest</div>
            <div class="fb-email" id="denizen-drawer-fb-email"></div>
            <button type="button" class="fb-logout" id="denizen-drawer-fb-logout">Log out</button>
            <div class="fb-hint">Scroll for city credits and station settings.</div>
          </div>
        </div>
      `;
      drawerEl.dataset.tab = activeTab;
      bindDrawerPress(drawerEl.querySelector('.drawer-close'), () => closeDrawer());
      wireDrawerTabs();
      bindDrawerPress(drawerEl.querySelector('#denizen-drawer-fb-logout'), async () => {
        try {
          await globalThis.DenizenVisitorSession?.logout?.();
        } catch (_) {}
        closeDrawer();
      });
      backdropEl.insertAdjacentElement('afterend', drawerEl);
    }
  }

  function updateDrawerHeader() {
    const subtitle = document.getElementById('denizen-drawer-subtitle');
    if (!subtitle) return;
    const sess = globalThis.DenizenVisitorSession;
    const profile = sess?.getProfile?.() || {};
    const name = profile.displayName || sess?.getDisplayName?.() || 'Guest';
    const credits = globalThis.DenizenNodeUI?.getState?.()?.credits;
    const creditsLabel = Number.isFinite(credits) ? ` · ${Math.round(credits)} credits` : '';
    subtitle.textContent = `${name}${creditsLabel}`;
  }

  function setActiveTab(tab) {
    activeTab = tab === 'compute' ? 'compute' : 'profile';
    if (drawerEl) drawerEl.dataset.tab = activeTab;
    drawerEl?.querySelectorAll('.drawer-tab').forEach((btn) => {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const body = document.getElementById(BODY_ID);
    if (body) body.scrollTop = 0;
  }

  function prepareMobilePanels() {
    globalThis.DenizenAccountPanel?.expandForDrawer?.();
    globalThis.DenizenNodeUI?.expandForDrawer?.();
    updateDrawerHeader();
  }

  function renderFallback() {
    const fb = document.getElementById(FALLBACK_ID);
    if (!fb) return;
    const sess = globalThis.DenizenVisitorSession;
    const profile = sess?.getProfile?.() || {};
    const name = profile.displayName || sess?.getDisplayName?.() || 'Guest';
    const email = profile.email || '';
    const nameEl = document.getElementById('denizen-drawer-fb-name');
    const emailEl = document.getElementById('denizen-drawer-fb-email');
    if (nameEl) nameEl.textContent = name;
    if (emailEl) {
      emailEl.textContent = email;
      emailEl.style.display = email ? 'block' : 'none';
    }
    const hasPanels = PANEL_IDS.every((id) => document.getElementById(id));
    fb.dataset.hidden = hasPanels ? '1' : '0';
  }

  function relocatePanels() {
    const body = document.getElementById(BODY_ID);
    if (!body) return false;

    for (const id of PANEL_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.parentElement !== body) body.appendChild(el);
      el.dataset.panelHidden = '0';
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
    }
    renderFallback();
    return true;
  }

  function paintOpenState() {
    const touch = isTouchDrawerMode();
    document.documentElement.classList.toggle('denizen-drawer-open', open);
    document.documentElement.classList.toggle('denizen-mobile-drawer-mode', touch);

    if (drawerEl) drawerEl.dataset.open = open ? '1' : '0';
    if (backdropEl) backdropEl.dataset.open = open ? '1' : '0';
    if (menuBtn) {
      menuBtn.dataset.open = open ? '1' : '0';
      menuBtn.textContent = open ? '✓ Me' : '☰ Me';
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function onDrawerOpened() {
    globalThis.DenizenBrowserMirror?.hide?.();
    globalThis.__DenizenPlayerChat?.close?.();
    setActiveTab('profile');
    renderFallback();
    relocatePanels();
    globalThis.DenizenNodeUI?.showPanel?.({ persist: false });
    globalThis.DenizenAccountPanel?.renderProfile?.();
    prepareMobilePanels();
    wireDrawerTabs();
    globalThis.DenizenHaptics?.tap?.();

    let tries = 0;
    const retry = () => {
      if (!open || tries >= 8) return;
      tries += 1;
      relocatePanels();
      globalThis.DenizenNodeUI?.showPanel?.({ persist: false });
      globalThis.DenizenAccountPanel?.renderProfile?.();
      prepareMobilePanels();
      renderFallback();
      if (!PANEL_IDS.every((id) => document.getElementById(id))) {
        setTimeout(retry, 250);
      }
    };
    setTimeout(retry, 250);
  }

  function applyOpenState(next, opts = {}) {
    const nextOpen = !!next;
    if (open === nextOpen && (!opts.syncToggle || getToggle()?.checked === nextOpen)) {
      paintOpenState();
      return;
    }
    open = nextOpen;
    ensureShell();

    if (opts.syncToggle !== false) {
      const toggle = getToggle();
      if (toggle && toggle.checked !== open) toggle.checked = open;
    }

    paintOpenState();

    if (open) {
      onDrawerOpened();
    } else {
      document.documentElement.classList.remove('denizen-browser-open');
    }
  }

  function setOpen(next) {
    applyOpenState(next, { syncToggle: true });
  }

  function openDrawer() {
    setOpen(true);
  }

  function closeDrawer() {
    setOpen(false);
  }

  function toggleDrawer() {
    setOpen(!open);
  }

  function handleMenuTap(e) {
    const now = Date.now();
    if (now - lastToggleAt < 300) return;
    lastToggleAt = now;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    toggleDrawer();
  }

  function bindDrawerPress(el, handler) {
    if (!el || typeof handler !== 'function') return;
    const wrapped = (e) => {
      e?.preventDefault?.();
      handler(e);
    };
    if (globalThis.DenizenTouchBind?.bindPress) {
      globalThis.DenizenTouchBind.bindPress(el, wrapped, { stop: true });
    } else {
      el.addEventListener('click', wrapped);
    }
  }

  function wireDrawerTabs() {
    if (!drawerEl) return;
    drawerEl.querySelectorAll('.drawer-tab').forEach((tabBtn) => {
      if (tabBtn.dataset.pressWired === '1') return;
      tabBtn.dataset.pressWired = '1';
      bindDrawerPress(tabBtn, () => setActiveTab(tabBtn.dataset.tab));
    });
  }

  function wireMenuButton(el) {
    if (!el) return;
    el.type = 'button';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-controls', DRAWER_ID);
    bindDrawerPress(el, (e) => handleMenuTap(e));
  }

  function ensureMenuButton() {
    if (!isTouchDrawerMode()) {
      menuBtn?.remove();
      menuBtn = null;
      return null;
    }

    ensureShell();
    wireDrawerTabs();

    menuBtn = document.getElementById(MENU_BTN_ID);
    if (!menuBtn) {
      menuBtn = document.createElement('button');
      menuBtn.id = MENU_BTN_ID;
      menuBtn.className = 'denizen-mobile-menu-btn';
      document.body.appendChild(menuBtn);
    } else if (menuBtn.parentElement !== document.body) {
      document.body.appendChild(menuBtn);
    }

    menuBtn.textContent = open ? '✓ Me' : '☰ Me';
    menuBtn.title = 'Citizen ID, city credits, and City Power';
    menuBtn.setAttribute('aria-label', 'Open Citizen ID and City Power');
    menuBtn.dataset.open = open ? '1' : '0';
    wireMenuButton(menuBtn);
    return menuBtn;
  }

  function applyTouchMode() {
    if (!isTouchDrawerMode()) {
      touchModeApplied = false;
      closeDrawer();
      menuBtn?.remove();
      menuBtn = null;
      document.getElementById(TOGGLE_ID)?.remove();
      toggleEl = null;
      document.documentElement.classList.remove('denizen-mobile-drawer-mode', 'denizen-drawer-open');
      return false;
    }

    injectStyles();
    document.documentElement.classList.add('denizen-mobile-drawer-mode');
    ensureShell();
    ensureMenuButton();

    if (!touchModeApplied) {
      touchModeApplied = true;
      try { localStorage.removeItem('denizen-node-ui-hidden'); } catch (_) {}
      globalThis.DenizenNodeUI?.showPanel?.({ persist: false });
      closeDrawer();
    }

    if (open) {
      relocatePanels();
      renderFallback();
    }
    return true;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    injectStyles();

    const tick = () => { applyTouchMode(); };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tick, { once: true });
    } else {
      tick();
    }

    window.addEventListener('resize', tick);
    document.addEventListener('denizen-visitor-session-ready', () => {
      renderFallback();
      if (open) relocatePanels();
      ensureMenuButton();
    });
    document.addEventListener('denizen-deferred-scripts-ready', tick, { once: true });

    setInterval(() => {
      if (isTouchDrawerMode()) ensureMenuButton();
    }, 1500);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) closeDrawer();
    });
  }

  globalThis.DenizenMobileSidebar = {
    init,
    relayout: applyTouchMode,
    ensureMenuButton,
    open: openDrawer,
    close: closeDrawer,
    toggle: toggleDrawer,
    isOpen: () => open,
    isPhoneDrawerMode,
    isTouchDrawerMode,
  };

  init();
})();
