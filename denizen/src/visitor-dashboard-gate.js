/**
 * Browser vs desktop-identity dashboard gating.
 * Desktop-linked users see full mesh/ops UI even when browsing the website.
 * Browser-only team users get a compact dashboard + upgrade prompts.
 */
(function () {
  'use strict';

  const HIDDEN_CLASS = 'denizen-dash-gated';

  const CHIP_RULES = {
    'denizen-diag-chip': 'canSeeOperatorTelemetry',
    'denizen-llm-tel-chip': 'canSeeOperatorTelemetry',
    'denizen-mesh-jobs-chip': 'canSeeMeshDashboard',
  };

  function chipAllowed(chipId) {
    if (chipId === 'denizen-superuser-replay-chip') {
      const c = caps();
      return !!(c.isTeam?.() && !c.isDemo?.());
    }
    const rule = CHIP_RULES[chipId];
    if (!rule) return true;
    return !!caps()[rule]?.();
  }

  function caps() {
    return globalThis.DenizenVisitorCapabilities || {};
  }

  function applyDocumentClass() {
    const mode = caps().isBrowserOnlyWeb?.() ? 'browser' : 'desktop';
    document.documentElement.dataset.denizenClient = mode;
    document.documentElement.classList.toggle('denizen-browser-only', mode === 'browser');
    document.documentElement.classList.toggle('denizen-desktop-identity', mode === 'desktop');
  }

  function applyChipVisibility() {
    for (const [chipId, rule] of Object.entries(CHIP_RULES)) {
      const el = document.getElementById(chipId);
      if (!el) continue;
      const allowed = chipAllowed(chipId);
      el.classList.toggle(HIDDEN_CLASS, !allowed);
      el.hidden = !allowed;
      el.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    }
    globalThis.DenizenBottomDock?.refresh?.();
  }

  function applyAll() {
    applyDocumentClass();
    applyChipVisibility();
    globalThis.DenizenNodeUI?.applyClientMode?.();
    try {
      document.dispatchEvent(new CustomEvent('denizen-dashboard-gate', {
        detail: {
          mode: document.documentElement.dataset.denizenClient,
          browserOnly: caps().isBrowserOnlyWeb?.(),
          desktopIdentity: caps().hasDesktopIdentity?.(),
        },
      }));
    } catch (_) {}
  }

  function init() {
    const styleId = 'denizen-dashboard-gate-style';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
        .${HIDDEN_CLASS} { display: none !important; }
        html.denizen-browser-only #denizen-node-ui-chip[data-browser-compact="1"] .node-contrib-toggle,
        html.denizen-browser-only #denizen-node-ui-chip[data-browser-compact="1"] .node-contrib-body,
        html.denizen-browser-only #denizen-node-ui-chip[data-browser-compact="1"] .node-optin-row {
          display: none !important;
        }
        html.denizen-browser-only #denizen-node-ui-chip[data-browser-compact="1"] .node-browser-hint {
          display: block;
        }
        #denizen-node-ui-chip .node-browser-hint {
          display: none;
          font-size: 10px;
          line-height: 1.45;
          color: #94a3b8;
          padding: 8px 10px 4px;
          border-top: 1px solid rgba(51, 65, 85, 0.5);
        }
        #denizen-node-ui-chip .node-browser-hint a {
          color: #7dd3fc;
        }
        #denizen-node-ui-chip .node-browser-hint .node-upgrade-btn {
          margin-top: 8px;
          background: rgba(56, 189, 248, 0.12);
          border: 1px solid rgba(56, 189, 248, 0.4);
          border-radius: 6px;
          color: #e0f2fe;
          font: inherit;
          font-size: 10px;
          padding: 6px 10px;
          cursor: pointer;
        }
        html.denizen-desktop-identity #denizen-acct-stats .acct-stat-row.acct-browser-hide {
          display: none;
        }
        html.denizen-browser-only #denizen-acct-stats .acct-stat-row.acct-desktop-only {
          display: none;
        }
      `;
      document.head.appendChild(s);
    }

    document.addEventListener('denizen-visitor-session-ready', applyAll);
    document.addEventListener('denizen-node-status', applyAll);
    document.addEventListener('denizen-deferred-scripts-ready', applyAll);
    applyAll();
  }

  globalThis.DenizenDashboardGate = { apply: applyAll, refresh: applyAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
