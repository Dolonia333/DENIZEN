/**
 * Visitor credits HUD chip — bottom-left quick credits + super-node badge.
 * Attaches to window.DenizenVisitorCreditsChip (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-visitor-credits-chip-style';
  const CHIP_ID = 'denizen-visitor-credits-chip';

  let chipEl = null;
  let initialized = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${CHIP_ID} {
        position: fixed;
        z-index: 100510;
        left: max(12px, env(safe-area-inset-left, 0px));
        bottom: calc(var(--denizen-dock-height, 56px) + 12px + env(safe-area-inset-bottom, 0px));
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid #334155;
        background: rgba(2, 6, 23, 0.94);
        color: #93c5fd;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
        pointer-events: none;
      }
      #${CHIP_ID} .super {
        color: #fde68a;
        border: 1px solid rgba(250, 204, 21, 0.6);
        border-radius: 999px;
        padding: 2px 7px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        background: rgba(250, 204, 21, 0.12);
      }
      html.denizen-touch #${CHIP_ID} {
        bottom: calc(var(--denizen-dock-height, 56px) + 16px + env(safe-area-inset-bottom, 0px));
      }
      html.denizen-mobile-drawer-mode #${CHIP_ID} {
        display: none !important;
      }
      /* The node panel already shows credits — only surface the chip when
         the panel is hidden (its "Compute" restore tab is showing) */
      body:has(#denizen-node-ui-chip:not([data-panel-hidden="1"])) #${CHIP_ID} {
        display: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureChip() {
    if (chipEl) return chipEl;
    injectStyles();
    chipEl = document.createElement('div');
    chipEl.id = CHIP_ID;
    chipEl.innerHTML = '<span class="credits">Credits: 0</span>';
    document.body.appendChild(chipEl);
    return chipEl;
  }

  function updateFromStatus(status) {
    if (!status) return;
    const el = ensureChip();
    const credits = Number.isFinite(Number(status.credits)) ? Math.round(Number(status.credits)) : 0;
    const superBadge = status.isSuperNode ? '<span class="super">Super Node</span>' : '';
    el.innerHTML = `<span class="credits">Credits: ${credits}</span>${superBadge}`;
  }

  function refreshFromNodeUi() {
    const nodeUi = globalThis.DenizenNodeUI;
    if (!nodeUi?.getState) return;
    updateFromStatus(nodeUi.getState());
  }

  function init() {
    if (initialized) return;
    initialized = true;
    ensureChip();
    window.addEventListener('denizen-node-status', (ev) => {
      updateFromStatus(ev?.detail || null);
    });
    refreshFromNodeUi();
  }

  const DenizenVisitorCreditsChip = {
    init,
    updateFromStatus,
  };

  globalThis.DenizenVisitorCreditsChip = DenizenVisitorCreditsChip;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
