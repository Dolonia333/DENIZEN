/**
 * First-time visitor onboarding — a short arrival story after the city loads.
 * The first run explains belonging, people, the phone, claiming, and City Power.
 * Detailed product capabilities stay in the Guide instead of crowding the tour.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY_PREFIX = 'denizen-onboarding-seen-v5';
  const LEGACY_STORAGE_KEY = 'denizen-onboarding-seen-v2';
  const STYLE_ID = 'denizen-visitor-onboarding-style';
  const OVERLAY_ID = 'denizen-visitor-onboarding';
  const TOUR_CHIP_ID = 'denizen-onboarding-replay-chip';

  let scene = null;
  let playerChat = null;
  let overlayEl = null;
  let stepIndex = 0;
  let stepUnbinds = [];
  let activeSteps = [];

  function isTouchUi() {
    return document.documentElement.classList.contains('denizen-touch');
  }

  function isTapMove() {
    return document.documentElement.classList.contains('denizen-tap-move');
  }

  function isDemoVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isDemo?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isDemo?.();
  }

  function isTeamVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isTeam?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isTeam?.() && !sess?.isDemo?.();
  }

  function tourTier() {
    return isTeamVisitor() ? 'team' : 'demo';
  }

  function storageScope() {
    const sess = globalThis.DenizenVisitorSession;
    const profile = sess?.getProfile?.() || {};
    const raw = profile.identityId
      || profile.email
      || profile.sessionId
      || sess?.getSessionId?.()
      || profile.displayName
      || 'anonymous';
    return String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.@-]+/g, '-')
      .slice(0, 80) || 'anonymous';
  }

  function storageKey() {
    return `${STORAGE_KEY_PREFIX}-${tourTier()}-${storageScope()}`;
  }

  function tierStorageKey() {
    return `${STORAGE_KEY_PREFIX}-${tourTier()}`;
  }

  function moveLine() {
    if (isTouchUi() && isTapMove()) {
      return 'Tap the floor to walk, then tap a resident when you want to talk.';
    }
    if (isTouchUi()) {
      return 'Use the joystick or tap the floor to move. Tap a resident to say hello.';
    }
    return 'Use the arrow keys to walk. Click a resident, or face them nearby, to start talking.';
  }

  function claimLine() {
    if (isTouchUi()) {
      return 'Meet someone you like, then tap Claim to make them your personal assistant.';
    }
    return 'Face someone and press C, or choose Claim. They become your personal assistant.';
  }

  function phoneLine() {
    return isTouchUi()
      ? 'Tap the phone button to open your city key.'
      : 'Open the phone at the lower-right. It is your city key.';
  }

  function arrivalTips() {
    return [
      'A denizen is someone who belongs to a place. Here, your AI team does not disappear into a chat box or work somewhere in the dark.',
      'They live and work in a world you can see. Walk in, meet someone, and ask for what you need.',
    ];
  }

  function cityTips() {
    return [
      moveLine(),
      'Ask a resident for something. They move to a desk, show what they are working on, and keep the job visible while it happens.',
      'If work gets stuck, you can see it. When it is finished, you can see that too. Ask, watch, know.',
    ];
  }

  function phoneTips() {
    return [
      phoneLine(),
      'Chat, your Citizen ID, the city team, and your tools all live here.',
      'Think of it as one familiar home screen instead of a wall of dashboards.',
    ];
  }

  function claimTips() {
    return [
      claimLine(),
      'Your assistant becomes your home base: one familiar person who remembers your work and helps you navigate the city.',
      'Your identity, your assistant, and the way you participate are the beginning of your Denizen citizenship.',
    ];
  }

  function powerTips() {
    return [
      'City Power is optional. When you are ready, Denizen Desktop can let your computer help keep the city running.',
      'You choose when your station contributes and can pause it at any time.',
      'Helping power shared work earns city credits. It should feel like supporting a place you belong to, not operating infrastructure.',
    ];
  }

  function readyTips() {
    if (isDemoVisitor()) {
      return [
        'Start by giving one resident a real task and watching the city respond. That is enough for day one.',
        'Your preview is a safe corner of the city. Join or create a team when you are ready to make your place permanent.',
      ];
    }
    return [
      'Start by giving one resident a useful task and watching the city respond. The rest will open up from there.',
      'Your AI team lives here now. Your phone, assistant, and Citizen ID will keep your place familiar when you return.',
    ];
  }

  /** @type {Array<{ id: string, icon: string, anchor: string, title: string, tips: string[] | (() => string[]), upgradeAction?: boolean }>} */
  const STEP_DEFS = [
    {
      id: 'arrival',
      icon: '◆',
      anchor: 'center',
      title: 'Welcome to Denizen',
      tips: arrivalTips,
    },
    {
      id: 'city',
      icon: '⌂',
      anchor: 'game',
      title: 'Ask. Watch. Know.',
      tips: cityTips,
    },
    {
      id: 'phone',
      icon: '▣',
      anchor: 'phone',
      title: 'Your city key',
      tips: phoneTips,
    },
    {
      id: 'claim',
      icon: '★',
      anchor: 'claim',
      title: 'Choose your person',
      tips: claimTips,
    },
    {
      id: 'power',
      icon: '◇',
      anchor: 'phone-power',
      title: 'Help keep the lights on',
      tips: powerTips,
    },
    {
      id: 'ready',
      icon: '✓',
      anchor: 'center',
      title: 'You are a denizen now',
      tips: readyTips,
      upgradeAction: true,
    },
  ];

  function resolveTips(step) {
    const raw = typeof step.tips === 'function' ? step.tips() : step.tips;
    return raw.map((t) => (typeof t === 'function' ? t() : t));
  }

  function buildSteps() {
    return STEP_DEFS.map((step) => ({
      ...step,
      upgradeAction: step.upgradeAction && isDemoVisitor(),
    }));
  }

  function hasSeenOnboarding() {
    try {
      if (localStorage.getItem(storageKey()) === '1') return true;
      if (storageScope() === 'anonymous' && localStorage.getItem(tierStorageKey()) === '1') return true;
      if (storageScope() === 'anonymous' && tourTier() === 'team' && localStorage.getItem(LEGACY_STORAGE_KEY) === '1') return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(storageKey(), '1');
    } catch (_) {}
  }

  function shouldShow() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
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
        z-index: 2147482000;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 38%, rgba(34, 197, 94, 0.08), transparent 34%),
          rgba(2, 6, 23, 0.68);
        pointer-events: auto;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-focus {
        position: fixed;
        border: 2px solid rgba(134, 239, 172, 0.9);
        border-radius: 18px;
        box-shadow:
          0 0 0 6px rgba(34, 197, 94, 0.12),
          0 0 34px rgba(34, 197, 94, 0.28);
        pointer-events: none;
        transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        box-sizing: border-box;
        background:
          linear-gradient(145deg, rgba(20, 83, 45, 0.2), transparent 48%),
          #07110d;
        border: 1px solid rgba(134, 239, 172, 0.32);
        border-radius: 20px;
        padding: 20px;
        width: min(420px, calc(100vw - 28px));
        max-height: min(76dvh, 560px);
        overflow-y: auto;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.68);
        pointer-events: auto;
        color: #e2e8f0;
        touch-action: manipulation;
        z-index: 1;
      }
      #${OVERLAY_ID} .onb-heading {
        display: grid;
        grid-template-columns: 44px 1fr;
        gap: 12px;
        align-items: center;
        margin-bottom: 14px;
      }
      #${OVERLAY_ID} .onb-icon {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid rgba(134, 239, 172, 0.3);
        color: #bbf7d0;
        font: 22px/1 ui-sans-serif, system-ui, sans-serif;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0 0 4px;
        font-size: 10px;
        color: #86efac;
        font-weight: bold;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .onb-tier-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        letter-spacing: 0.06em;
        vertical-align: middle;
      }
      #${OVERLAY_ID} .onb-tier-badge.demo {
        background: rgba(56, 189, 248, 0.15);
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.35);
      }
      #${OVERLAY_ID} .onb-tier-badge.team {
        background: rgba(74, 222, 128, 0.12);
        color: #86efac;
        border: 1px solid rgba(74, 222, 128, 0.35);
      }
      #${OVERLAY_ID} .onb-title {
        margin: 0;
        font-size: 20px;
        line-height: 1.2;
        color: #f8fafc;
        font-weight: bold;
      }
      #${OVERLAY_ID} .onb-copy {
        margin: 0 0 18px;
        font: 13px/1.62 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #cbd5e1;
      }
      #${OVERLAY_ID} .onb-copy p {
        margin: 0 0 9px;
      }
      #${OVERLAY_ID} .onb-copy p:last-child {
        margin-bottom: 0;
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: wrap;
        position: sticky;
        bottom: 0;
        background: #07110d;
        padding-top: 8px;
      }
      #${OVERLAY_ID} .onb-skip,
      #${OVERLAY_ID} .onb-next,
      #${OVERLAY_ID} .onb-upgrade {
        min-height: 44px;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-skip {
        background: transparent;
        border: none;
        color: #64748b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 8px 10px;
      }
      #${OVERLAY_ID} .onb-skip:hover { color: #94a3b8; }
      #${OVERLAY_ID} .onb-next {
        background: #86efac;
        color: #052e16;
        border: none;
        border-radius: 999px;
        padding: 10px 18px;
        font: inherit;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      }
      #${OVERLAY_ID} .onb-next:hover { background: #bbf7d0; }
      #${OVERLAY_ID} .onb-upgrade {
        background: transparent;
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.45);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-upgrade:hover {
        border-color: #38bdf8;
        color: #e0f2fe;
      }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 5px;
        margin-right: auto;
        flex-wrap: wrap;
        max-width: 45%;
      }
      #${OVERLAY_ID} .onb-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: #1f2937;
        flex-shrink: 0;
      }
      #${OVERLAY_ID} .onb-dot.active { background: #4ade80; }
      html[data-denizen-onboarding="open"] #game-container,
      html[data-denizen-onboarding="open"] #game-container canvas,
      html[data-denizen-onboarding="open"] #denizen-bottom-dock,
      html[data-denizen-onboarding="open"] #denizen-mobile-controls {
        pointer-events: none !important;
      }
      #${TOUR_CHIP_ID} {
        display: none;
        background: rgba(15, 23, 42, 0.96);
        color: #a5f3fc;
        border: 1px solid rgba(34, 211, 238, 0.35);
        border-radius: 999px;
        padding: 6px 11px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${TOUR_CHIP_ID}.ready { display: inline-flex; align-items: center; }
      #${TOUR_CHIP_ID}:hover { border-color: #22d3ee; color: #e0f2fe; }
      @media (max-width: 520px) {
        #${OVERLAY_ID} .onb-tooltip {
          padding: 17px;
          border-radius: 18px;
        }
        #${OVERLAY_ID} .onb-title { font-size: 18px; }
        #${OVERLAY_ID} .onb-copy { font-size: 12.5px; }
      }
    `;
    document.head.appendChild(s);
  }

  function canUseReplayChip() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return true;
  }

  function replayChipLabel() {
    return 'City tour';
  }

  function rewireReplayChip() {
    const chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) return;
    // Touch dock is icon-only — full label lives in the tooltip
    const touch = document.documentElement.classList.contains('denizen-touch');
    chip.textContent = touch ? '📖' : replayChipLabel();
    chip.title = 'Replay the Denizen city tour';
    const clone = chip.cloneNode(true);
    chip.replaceWith(clone);
    const onPress = () => {
      window.DenizenHaptics?.tap?.();
      globalThis.DenizenVisitorOnboarding?.replay?.();
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(clone, onPress);
    else clone.addEventListener('click', onPress);
  }

  function mountReplayChip() {
    if (!canUseReplayChip()) {
      document.getElementById(TOUR_CHIP_ID)?.remove();
      return;
    }
    injectStyles();
    let chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) {
      chip = document.createElement('button');
      chip.id = TOUR_CHIP_ID;
      chip.type = 'button';
      document.body.appendChild(chip);
    }
    chip.classList.add('ready');
    rewireReplayChip();
    window.DenizenBottomDock?.refresh?.();
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
    if (!el || el.getClientRects().length === 0) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;
    return r;
  }

  function getAnchorRect(anchor) {
    if (anchor === 'center') return centerRect();
    if (anchor === 'phone') {
      if (document.documentElement.classList.contains('denizen-phone-open')) {
        return rectForEl('denizen-phone-frame') || rectForEl('denizen-phone-fab') || centerRect();
      }
      return rectForEl('denizen-phone-fab') || centerRect();
    }
    if (anchor === 'phone-power') {
      const app = document.querySelector('#denizen-phone-screen .dzp-app[data-app="compute"]');
      if (app && app.offsetParent !== null) return app.getBoundingClientRect();
      return rectForEl('denizen-phone-fab') || rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'claim') {
      return rectForEl('denizen-visitor-claim-btn') || rectForEl('game-container') || centerRect();
    }
    if (anchor === 'chat-fab') {
      return rectForEl('player-chat-fab') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'voice') {
      return rectForEl('denizen-presence-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'mic') {
      return rectForEl('denizen-mic-button') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'browser') {
      return rectForEl('denizen-browser-mirror-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'briefing') {
      return rectForEl('denizen-visitor-briefing-btn')
        || rectForEl('player-chat-header')
        || centerRect();
    }
    if (anchor === 'chat-header') {
      return rectForEl('player-chat-header')
        || rectForEl('denizen-visitor-assistant-chip')
        || rectForEl('player-chat-fab')
        || centerRect();
    }
    if (anchor === 'handoff') {
      return rectForEl('denizen-visitor-handoff-btn')
        || rectForEl('player-chat-header')
        || rectForEl('player-chat-fab')
        || centerRect();
    }
    if (anchor === 'account') {
      return rectForEl('denizen-account-panel')
        || rectForEl('denizen-acct-identity')
        || centerRect();
    }
    if (anchor === 'dock') {
      return rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'guide') {
      return rectForEl('denizen-capabilities-guide-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'compute') {
      return rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'mesh') {
      return rectForEl('denizen-mesh-jobs-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    const gc = document.getElementById('game-container');
    if (anchor === 'game' && gc) return gc.getBoundingClientRect();
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
    let top = rect.bottom + margin.top;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    if (anchor === 'center') {
      top = window.innerHeight / 2 - tooltipRect.height / 2;
      left = window.innerWidth / 2 - tooltipRect.width / 2;
    } else if (top + tooltipRect.height > window.innerHeight - margin.bottom) {
      top = rect.top - tooltipRect.height - margin.top;
    }
    left = Math.max(margin.left, Math.min(left, window.innerWidth - tooltipRect.width - margin.right));
    top = Math.max(margin.top, Math.min(top, window.innerHeight - tooltipRect.height - margin.bottom));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    const focus = overlayEl?.querySelector('.onb-focus');
    if (focus) {
      const pad = anchor === 'center' ? 0 : 8;
      focus.hidden = anchor === 'center';
      focus.style.left = `${Math.max(6, rect.left - pad)}px`;
      focus.style.top = `${Math.max(6, rect.top - pad)}px`;
      focus.style.width = `${Math.max(0, Math.min(window.innerWidth - 12, rect.width + pad * 2))}px`;
      focus.style.height = `${Math.max(0, Math.min(window.innerHeight - 12, rect.height + pad * 2))}px`;
    }
  }

  function clearStepUnbinds() {
    stepUnbinds.forEach((fn) => fn());
    stepUnbinds = [];
  }

  async function startUpgradeFlow() {
    markSeen();
    dismiss({ keepOverlayState: true });
    try {
      await globalThis.DenizenVisitorSession?.logout?.();
    } catch (err) {
      console.warn('[DenizenVisitorOnboarding] upgrade logout failed:', err?.message || err);
    }
  }

  function wireStepButtons(skipBtn, nextBtn, upgradeBtn) {
    clearStepUnbinds();
    const onNext = () => {
      if (stepIndex < activeSteps.length - 1) {
        stepIndex += 1;
        renderStep();
      } else {
        dismiss();
      }
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (skipBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        dismiss();
      };
      if (bind) {
        const offSkip = bind(skipBtn, handler, { stop: true });
        if (typeof offSkip === 'function') stepUnbinds.push(offSkip);
      } else {
        skipBtn.addEventListener('click', handler);
        stepUnbinds.push(() => skipBtn.removeEventListener('click', handler));
      }
    }
    if (upgradeBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        startUpgradeFlow();
      };
      if (bind) {
        const offUp = bind(upgradeBtn, handler, { stop: true });
        if (typeof offUp === 'function') stepUnbinds.push(offUp);
      } else {
        upgradeBtn.addEventListener('click', handler);
        stepUnbinds.push(() => upgradeBtn.removeEventListener('click', handler));
      }
    }
    if (nextBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        onNext();
      };
      if (bind) {
        const offNext = bind(nextBtn, handler, { stop: true });
        if (typeof offNext === 'function') stepUnbinds.push(offNext);
      } else {
        nextBtn.addEventListener('click', handler);
        stepUnbinds.push(() => nextBtn.removeEventListener('click', handler));
      }
    }
  }

  function dismiss(opts = {}) {
    if (!opts.keepOverlayState) markSeen();
    delete document.documentElement.dataset.denizenOnboarding;
    clearStepUnbinds();
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
    }
    stepIndex = 0;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tourAriaLabel() {
    return 'Denizen city tour';
  }

  function tierBadgeHtml() {
    const team = isTeamVisitor();
    const cls = team ? 'team' : 'demo';
    const label = team ? 'Citizen' : 'Preview';
    return `<span class="onb-tier-badge ${cls}">${label}</span>`;
  }

  function renderStep() {
    if (!overlayEl) return;
    const step = activeSteps[stepIndex];
    if (!step) {
      dismiss();
      return;
    }

    const tips = resolveTips(step);
    const isLast = stepIndex >= activeSteps.length - 1;
    const tooltip = overlayEl.querySelector('.onb-tooltip');
    tooltip.innerHTML = `
      <div class="onb-heading">
        <span class="onb-icon" aria-hidden="true">${escapeHtml(step.icon || '◆')}</span>
        <div>
          <p class="onb-step">City tour · ${stepIndex + 1} of ${activeSteps.length}${tierBadgeHtml()}</p>
          <p class="onb-title">${escapeHtml(step.title)}</p>
        </div>
      </div>
      <div class="onb-copy">
        ${tips.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}
      </div>
      <div class="onb-actions">
        <div class="onb-dots">
          ${activeSteps.map((_, i) => `<span class="onb-dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
        </div>
        ${step.upgradeAction ? '<button type="button" class="onb-upgrade">Make my place permanent</button>' : ''}
        <button type="button" class="onb-skip">Skip</button>
        <button type="button" class="onb-next">${isLast ? 'Enter the city' : 'Continue'}</button>
      </div>
    `;

    wireStepButtons(
      tooltip.querySelector('.onb-skip'),
      tooltip.querySelector('.onb-next'),
      tooltip.querySelector('.onb-upgrade'),
    );

    requestAnimationFrame(() => positionTooltip(tooltip, step.anchor));
  }

  function showTour(opts = {}) {
    const force = !!opts.force;
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
      clearStepUnbinds();
      delete document.documentElement.dataset.denizenOnboarding;
    }
    if (!force && !shouldShow()) return;

    activeSteps = buildSteps();
    if (!activeSteps.length) return;

    injectStyles();
    document.documentElement.dataset.denizenOnboarding = 'open';
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `
      <div class="onb-backdrop" aria-hidden="true"></div>
      <div class="onb-focus" hidden aria-hidden="true"></div>
      <div class="onb-tooltip" role="dialog" aria-label="${escapeHtml(tourAriaLabel())}"></div>
    `;
    document.body.appendChild(overlayEl);

    stepIndex = 0;
    renderStep();

    const onResize = () => {
      const tooltip = overlayEl?.querySelector('.onb-tooltip');
      const step = activeSteps[stepIndex];
      if (tooltip && step) positionTooltip(tooltip, step.anchor);
    };
    window.addEventListener('resize', onResize);
    overlayEl._cleanup = () => window.removeEventListener('resize', onResize);
  }

  function waitForSceneReady(sc, pc, attempt = 0) {
    if (!shouldShow()) return;
    if (sc?.player && document.getElementById('game-container')) {
      setTimeout(showTour, 800);
      return;
    }
    if (attempt >= 40) {
      showTour();
      return;
    }
    setTimeout(() => waitForSceneReady(sc, pc, attempt + 1), 250);
  }

  function onSessionReady() {
    mountReplayChip();
    if (shouldShow()) {
      if (scene?.player && document.getElementById('game-container')) {
        setTimeout(showTour, 600);
      } else {
        waitForSceneReady(scene, playerChat);
      }
    }
  }

  function onLoggedOut() {
    dismiss({ keepOverlayState: true });
  }

  const DenizenVisitorOnboarding = {
    attach(sc, pc) {
      scene = sc;
      playerChat = pc;

      document.addEventListener('denizen-visitor-session-ready', onSessionReady);
      document.addEventListener('denizen-visitor-logged-out', onLoggedOut);

      const afterSession = () => onSessionReady();

      globalThis.DenizenVisitorSession?.init?.().then(afterSession).catch(afterSession);

      console.log('[DenizenVisitorOnboarding] attached');
    },

    detach() {
      document.removeEventListener('denizen-visitor-session-ready', onSessionReady);
      document.removeEventListener('denizen-visitor-logged-out', onLoggedOut);
      if (overlayEl?._cleanup) overlayEl._cleanup();
      dismiss();
      document.getElementById(TOUR_CHIP_ID)?.remove();
      scene = null;
      playerChat = null;
    },

    replay() {
      if (!canUseReplayChip()) return false;
      activeSteps = buildSteps();
      if (!activeSteps.length) return false;
      stepIndex = 0;
      showTour({ force: true });
      return true;
    },

    rewireReplayChip,

    resetForTesting() {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem('denizen-onboarding-seen');
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-demo`);
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-team`);
        localStorage.removeItem(storageKey());
      } catch (_) {}
    },
  };

  globalThis.DenizenVisitorOnboarding = DenizenVisitorOnboarding;
})();
