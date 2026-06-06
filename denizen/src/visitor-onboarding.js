/**
 * First-time visitor onboarding — 3-step tooltip tour after scene loads.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'denizen-onboarding-seen';
  const STYLE_ID = 'denizen-visitor-onboarding-style';
  const OVERLAY_ID = 'denizen-visitor-onboarding';

  const STEPS = [
    {
      text: 'Walk up to any NPC and face them',
      anchor: 'game',
    },
    {
      text: 'Press C or tap ⭐ Claim to make them your assistant',
      anchor: 'claim',
    },
    {
      text: 'Use ↗ Hand off to message Lucy or teammates',
      anchor: 'handoff',
    },
  ];

  let scene = null;
  let playerChat = null;
  let overlayEl = null;
  let stepIndex = 0;
  let attached = false;

  function hasSeenOnboarding() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {}
  }

  function shouldShow() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoMode?.()) return false;
    if (sess?.isDemo?.()) return false;
    return !hasSeenOnboarding();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 100480;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #${OVERLAY_ID} .onb-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(2, 6, 23, 0.55);
        pointer-events: auto;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 16px 18px;
        width: min(320px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        pointer-events: auto;
        color: #e2e8f0;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0 0 10px;
        font-size: 11px;
        color: #4ade80;
        font-weight: bold;
      }
      #${OVERLAY_ID} .onb-text {
        margin: 0 0 14px;
        font-size: 13px;
        line-height: 1.45;
        color: #e2e8f0;
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
      }
      #${OVERLAY_ID} .onb-skip {
        background: transparent;
        border: none;
        color: #64748b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 4px 6px;
      }
      #${OVERLAY_ID} .onb-skip:hover { color: #94a3b8; }
      #${OVERLAY_ID} .onb-next {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 6px;
        padding: 8px 14px;
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
      }
      #${OVERLAY_ID} .onb-next:hover { background: #22c55e; }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 6px;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: #1f2937;
      }
      #${OVERLAY_ID} .onb-dot.active { background: #4ade80; }
    `;
    document.head.appendChild(s);
  }

  function getAnchorRect(anchor) {
    if (anchor === 'claim') {
      const btn = document.getElementById('denizen-visitor-claim-btn');
      if (btn && btn.style.display !== 'none') {
        return btn.getBoundingClientRect();
      }
    }
    if (anchor === 'handoff') {
      const btn = document.getElementById('denizen-visitor-handoff-btn');
      if (btn && btn.offsetParent !== null) {
        return btn.getBoundingClientRect();
      }
      const header = document.getElementById('player-chat-header');
      if (header) return header.getBoundingClientRect();
    }
    const gc = document.getElementById('game-container');
    if (gc) return gc.getBoundingClientRect();
    return {
      left: window.innerWidth / 2 - 160,
      top: window.innerHeight / 2 - 80,
      width: 320,
      height: 160,
      bottom: window.innerHeight / 2 + 80,
      right: window.innerWidth / 2 + 160,
    };
  }

  function positionTooltip(tooltip, anchor) {
    const rect = getAnchorRect(anchor);
    const margin = 12;
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + margin;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = rect.top - tooltipRect.height - margin;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function dismiss() {
    markSeen();
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
    }
    stepIndex = 0;
  }

  function renderStep() {
    if (!overlayEl) return;
    const step = STEPS[stepIndex];
    if (!step) {
      dismiss();
      return;
    }

    const tooltip = overlayEl.querySelector('.onb-tooltip');
    tooltip.innerHTML = `
      <p class="onb-step">Tip ${stepIndex + 1} of ${STEPS.length}</p>
      <p class="onb-text">${step.text}</p>
      <div class="onb-actions">
        <div class="onb-dots">
          ${STEPS.map((_, i) => `<span class="onb-dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
        </div>
        <button type="button" class="onb-skip">Skip tour</button>
        <button type="button" class="onb-next">${stepIndex < STEPS.length - 1 ? 'Next' : 'Got it'}</button>
      </div>
    `;

    tooltip.querySelector('.onb-skip').addEventListener('click', dismiss);
    tooltip.querySelector('.onb-next').addEventListener('click', () => {
      if (stepIndex < STEPS.length - 1) {
        stepIndex += 1;
        renderStep();
      } else {
        dismiss();
      }
    });

    requestAnimationFrame(() => positionTooltip(tooltip, step.anchor));
  }

  function showTour() {
    if (overlayEl || !shouldShow()) return;

    injectStyles();
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `
      <div class="onb-backdrop" aria-hidden="true"></div>
      <div class="onb-tooltip" role="dialog" aria-label="Visitor tips"></div>
    `;
    document.body.appendChild(overlayEl);

    stepIndex = 0;
    renderStep();

    const onResize = () => {
      const tooltip = overlayEl?.querySelector('.onb-tooltip');
      const step = STEPS[stepIndex];
      if (tooltip && step) positionTooltip(tooltip, step.anchor);
    };
    window.addEventListener('resize', onResize);
    overlayEl._cleanup = () => window.removeEventListener('resize', onResize);
  }

  function waitForSceneReady(sc, pc, attempt = 0) {
    if (!shouldShow()) return;
    if (sc?.player && document.getElementById('game-container')) {
      setTimeout(showTour, 600);
      return;
    }
    if (attempt >= 40) {
      showTour();
      return;
    }
    setTimeout(() => waitForSceneReady(sc, pc, attempt + 1), 250);
  }

  const DenizenVisitorOnboarding = {
    attach(sc, pc) {
      scene = sc;
      playerChat = pc;
      attached = true;

      if (!shouldShow()) return;

      globalThis.DenizenVisitorSession?.init?.().then(() => {
        if (!shouldShow()) return;
        waitForSceneReady(scene, playerChat);
      }).catch(() => {
        waitForSceneReady(scene, playerChat);
      });

      console.log('[DenizenVisitorOnboarding] attached');
    },

    detach() {
      attached = false;
      if (overlayEl?._cleanup) overlayEl._cleanup();
      dismiss();
      scene = null;
      playerChat = null;
    },

    resetForTesting() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },
  };

  globalThis.DenizenVisitorOnboarding = DenizenVisitorOnboarding;
})();
