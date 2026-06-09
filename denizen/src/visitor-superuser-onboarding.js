/**
 * Super-user mesh onboarding — team members who install Denizen Desktop
 * and contribute hardware to the compute mesh.
 * Attaches to globalThis.DenizenSuperuserOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'denizen-superuser-onboarding-v1';
  const STYLE_ID = 'denizen-superuser-onboarding-style';
  const OVERLAY_ID = 'denizen-superuser-onboarding';
  const CHIP_ID = 'denizen-superuser-replay-chip';

  let overlayEl = null;
  let stepIndex = 0;
  let stepUnbinds = [];

  const STEPS = [
    {
      id: 'compute',
      anchor: 'compute',
      title: 'Your compute panel',
      tips: [
        'Top-right: credits, node state, and whether you are browser-only or linked to Desktop.',
        'Browser play is enough for delegating work — the mesh runs NPC brains in the cloud.',
        'Super-users link real hardware here so the team gets more GPU/CPU capacity.',
      ],
    },
    {
      id: 'browser-vs-desktop',
      anchor: 'center',
      title: 'Browser vs Denizen Desktop',
      tips: [
        'Browser: walk the office, chat, hand off, Connect AI — no local file or screen access.',
        'Desktop: profiles your CPU/RAM/GPU, pairs to this session, and can run coworker-class automation.',
        'You choose permission mode in the Desktop wizard — ask before each sensitive action, or trusted for power users.',
      ],
    },
    {
      id: 'download',
      anchor: 'compute-download',
      title: 'Download & pair',
      tips: [
        'Compute panel → Download Denizen Desktop for Windows/Mac/Linux.',
        'Run the setup wizard, then click Pair this computer in the browser.',
        'Pairing opens denizen://pair — your browser session and Desktop app share one identity.',
      ],
    },
    {
      id: 'optin',
      anchor: 'compute-optin',
      title: 'Opt in to contribute',
      tips: [
        'Toggle Contribute when you want this machine on the mesh.',
        'You earn credits for completed jobs; spend credits to boost priority on your own tasks.',
        'Turn off anytime — your assistant still works; you just stop lending cycles.',
      ],
    },
    {
      id: 'levels',
      anchor: 'compute-level',
      title: 'Contribution levels',
      tips: [
        'Off — advisory only, no mesh jobs on your hardware.',
        'Light — background capacity when you are idle.',
        'Standard — balanced share for team inference and codegen.',
        'Max — prioritize mesh work (best for dedicated workstations).',
      ],
    },
    {
      id: 'super-node',
      anchor: 'compute',
      title: 'Super Node badge',
      tips: [
        'Hardware score 75+ unlocks Super Node — priority worker on the mesh.',
        'Live CPU/RAM/GPU stats appear after Desktop pairing (browser cannot profile your machine).',
        'Fleet view lists other contributors — CEOs and hosts often run local LM Studio too.',
      ],
    },
    {
      id: 'mesh-jobs',
      anchor: 'mesh',
      title: 'Mesh jobs chip (⬡)',
      tips: [
        'Dock chip ⬡ shows queued and running jobs across the fleet.',
        'When the queue is deep, save optional API keys in Account so chat stays fast while mesh catches up.',
        'Operators watch this during heavy codegen or research bursts.',
      ],
    },
    {
      id: 'permissions',
      anchor: 'center',
      title: 'Desktop permissions',
      tips: [
        'Desktop wizard sets off / ask / trusted for file, screen, and shell access.',
        'Ask mode (recommended): every sensitive action shows a permission prompt on your PC.',
        'Your claimed assistant requests access — not a separate siloed coworker app.',
      ],
    },
    {
      id: 'coworker',
      anchor: 'guide',
      title: 'Coworker-class work — and more',
      tips: [
        'With Desktop + permission: screen observe, browser automation, coding-agent worktrees, approved custom skills.',
        'Same brain as in-world chat and Connect AI (Cursor, Companion, Claude Desktop).',
        'Open Guide → Desktop power for the full matrix; replay this tour anytime from Guide.',
      ],
    },
  ];

  function isTeamVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isTeam?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isTeam?.() && !sess?.isDemo?.();
  }

  function hasSeen() {
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

  function shouldAutoShow() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    if (!isTeamVisitor()) return false;
    return !hasSeen();
  }

  function canShowChip() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return isTeamVisitor();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147481800;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .su-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(2, 6, 23, 0.55);
        pointer-events: auto;
      }
      #${OVERLAY_ID} .su-tooltip {
        position: fixed;
        background: #020617;
        border: 1px solid #4c1d95;
        border-radius: 10px;
        padding: 16px 18px;
        width: min(380px, calc(100vw - 28px));
        max-height: min(72dvh, 520px);
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        pointer-events: auto;
        color: #e2e8f0;
        z-index: 1;
      }
      #${OVERLAY_ID} .su-step {
        margin: 0 0 6px;
        font-size: 10px;
        color: #c4b5fd;
        font-weight: bold;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .su-title {
        margin: 0 0 10px;
        font-size: 15px;
        color: #f8fafc;
        font-weight: bold;
      }
      #${OVERLAY_ID} .su-tips {
        margin: 0 0 14px;
        padding-left: 18px;
        font-size: 12px;
        line-height: 1.5;
        color: #cbd5e1;
      }
      #${OVERLAY_ID} .su-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      #${OVERLAY_ID} .su-skip, #${OVERLAY_ID} .su-next, #${OVERLAY_ID} .su-guide {
        font: inherit;
        font-size: 11px;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        min-height: 40px;
      }
      #${OVERLAY_ID} .su-skip {
        background: transparent;
        border: 1px solid #475569;
        color: #94a3b8;
      }
      #${OVERLAY_ID} .su-next, #${OVERLAY_ID} .su-guide {
        background: rgba(167, 139, 250, 0.15);
        border: 1px solid rgba(167, 139, 250, 0.45);
        color: #ede9fe;
        font-weight: bold;
      }
      #${CHIP_ID} {
        display: none;
        background: rgba(15, 23, 42, 0.96);
        color: #c4b5fd;
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 999px;
        padding: 6px 11px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
      }
      #${CHIP_ID}.ready { display: inline-flex; align-items: center; }
      html[data-denizen-superuser-onboarding="open"] #denizen-bottom-dock,
      html[data-denizen-superuser-onboarding="open"] #denizen-node-ui-chip {
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  function centerRect() {
    return {
      left: window.innerWidth / 2 - 160,
      top: window.innerHeight / 2 - 100,
      width: 320,
      height: 200,
      bottom: window.innerHeight / 2 + 100,
      right: window.innerWidth / 2 + 160,
    };
  }

  function rectForEl(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;
    return r;
  }

  function getAnchorRect(anchor) {
    if (anchor === 'center') return centerRect();
    if (anchor === 'compute') {
      return rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'compute-download') {
      return rectForEl('denizen-node-download') || rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'compute-optin') {
      const optin = document.getElementById('denizen-node-optin-toggle');
      if (optin) return optin.getBoundingClientRect();
      return rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'compute-level') {
      return rectForEl('denizen-node-level') || rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'mesh') {
      return rectForEl('denizen-mesh-jobs-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'guide') {
      return rectForEl('denizen-capabilities-guide-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    return centerRect();
  }

  function safeMargins() {
    const root = getComputedStyle(document.documentElement);
    const num = (v) => parseFloat(v) || 0;
    const dockH = num(root.getPropertyValue('--denizen-dock-height')) || 48;
    return {
      top: Math.max(12, num(root.getPropertyValue('--safe-top')) + 8),
      right: Math.max(12, num(root.getPropertyValue('--safe-right')) + 8),
      bottom: Math.max(12, num(root.getPropertyValue('--safe-bottom')) + dockH + 12),
      left: Math.max(12, num(root.getPropertyValue('--safe-left')) + 8),
    };
  }

  function positionTooltip(tooltip, anchor) {
    const rect = getAnchorRect(anchor);
    const margin = safeMargins();
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 12;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    if (anchor === 'center') {
      top = window.innerHeight / 2 - tooltipRect.height / 2;
      left = window.innerWidth / 2 - tooltipRect.width / 2;
    } else if (top + tooltipRect.height > window.innerHeight - margin.bottom) {
      top = rect.top - tooltipRect.height - 12;
    }
    left = Math.max(margin.left, Math.min(left, window.innerWidth - tooltipRect.width - margin.right));
    top = Math.max(margin.top, Math.min(top, window.innerHeight - tooltipRect.height - margin.bottom));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function clearStepUnbinds() {
    stepUnbinds.forEach((fn) => fn());
    stepUnbinds = [];
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function dismiss() {
    markSeen();
    delete document.documentElement.dataset.denizenSuperuserOnboarding;
    clearStepUnbinds();
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
    }
    stepIndex = 0;
  }

  function wireButtons(skipBtn, nextBtn, guideBtn) {
    clearStepUnbinds();
    const onNext = () => {
      if (stepIndex < STEPS.length - 1) {
        stepIndex += 1;
        renderStep();
      } else {
        dismiss();
      }
    };
    const bind = window.DenizenTouchBind?.bindPress;
    const attach = (btn, handler) => {
      if (!btn) return;
      const wrapped = (e) => {
        e?.preventDefault?.();
        handler();
      };
      if (bind) {
        const off = bind(btn, wrapped, { stop: true });
        if (typeof off === 'function') stepUnbinds.push(off);
      } else {
        btn.addEventListener('click', wrapped);
        stepUnbinds.push(() => btn.removeEventListener('click', wrapped));
      }
    };
    attach(skipBtn, dismiss);
    attach(nextBtn, onNext);
    attach(guideBtn, () => {
      dismiss();
      globalThis.DenizenCapabilitiesGuide?.open?.({ tab: 'desktop-power' });
    });
  }

  function renderStep() {
    if (!overlayEl) return;
    const step = STEPS[stepIndex];
    if (!step) {
      dismiss();
      return;
    }
    const isLast = stepIndex >= STEPS.length - 1;
    const tooltip = overlayEl.querySelector('.su-tooltip');
    tooltip.innerHTML = `
      <p class="su-step">Mesh tour · Step ${stepIndex + 1} of ${STEPS.length}</p>
      <p class="su-title">${escapeHtml(step.title)}</p>
      <ul class="su-tips">
        ${step.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
      <div class="su-actions">
        <button type="button" class="su-skip">Skip</button>
        ${step.id === 'coworker' ? '<button type="button" class="su-guide">Open Guide</button>' : ''}
        <button type="button" class="su-next">${isLast ? 'Done' : 'Next'}</button>
      </div>
    `;
    wireButtons(
      tooltip.querySelector('.su-skip'),
      tooltip.querySelector('.su-next'),
      tooltip.querySelector('.su-guide'),
    );
    requestAnimationFrame(() => positionTooltip(tooltip, step.anchor));
  }

  function showTour(opts = {}) {
    if (!opts.force && !shouldAutoShow()) return;
    if (!isTeamVisitor()) return;

    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
      clearStepUnbinds();
    }

    injectStyles();
    document.documentElement.dataset.denizenSuperuserOnboarding = 'open';
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `
      <div class="su-backdrop" aria-hidden="true"></div>
      <div class="su-tooltip" role="dialog" aria-label="Super-user mesh onboarding"></div>
    `;
    document.body.appendChild(overlayEl);
    stepIndex = 0;
    renderStep();

    const onResize = () => {
      const tooltip = overlayEl?.querySelector('.su-tooltip');
      const step = STEPS[stepIndex];
      if (tooltip && step) positionTooltip(tooltip, step.anchor);
    };
    window.addEventListener('resize', onResize);
    overlayEl._cleanup = () => window.removeEventListener('resize', onResize);
  }

  function waitForMainTourThenShow() {
    if (!shouldAutoShow()) return;
    const poll = (attempt = 0) => {
      if (document.documentElement.dataset.denizenOnboarding === 'open') {
        if (attempt < 120) setTimeout(() => poll(attempt + 1), 500);
        return;
      }
      showTour();
    };
    setTimeout(() => poll(0), 2500);
  }

  function mountReplayChip() {
    if (!canShowChip()) {
      document.getElementById(CHIP_ID)?.remove();
      return;
    }
    injectStyles();
    let chip = document.getElementById(CHIP_ID);
    if (!chip) {
      chip = document.createElement('button');
      chip.id = CHIP_ID;
      chip.type = 'button';
      chip.textContent = 'Mesh tour';
      chip.title = 'Super-user mesh onboarding — Desktop, pairing, contribution';
      document.body.appendChild(chip);
    }
    chip.classList.add('ready');
    const clone = chip.cloneNode(true);
    chip.replaceWith(clone);
    const onPress = () => {
      window.DenizenHaptics?.tap?.();
      showTour({ force: true });
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(clone, onPress);
    else clone.addEventListener('click', onPress);
    window.DenizenBottomDock?.refresh?.();
  }

  function onSessionReady() {
    mountReplayChip();
    waitForMainTourThenShow();
  }

  function init() {
    document.addEventListener('denizen-visitor-session-ready', onSessionReady);
    document.addEventListener('denizen-deferred-scripts-ready', mountReplayChip);
    document.addEventListener('denizen-node-status', (e) => {
      if (e.detail?.desktopLinked && shouldAutoShow()) {
        waitForMainTourThenShow();
      }
    });
    mountReplayChip();
    if (globalThis.DenizenVisitorSession?.isTeam?.()) {
      waitForMainTourThenShow();
    }
  }

  globalThis.DenizenSuperuserOnboarding = {
    show: showTour,
    replay() {
      if (!canShowChip()) return false;
      showTour({ force: true });
      return true;
    },
    dismiss,
    mountReplayChip,
    resetForTesting() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
