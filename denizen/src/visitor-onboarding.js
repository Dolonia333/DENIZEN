/**
 * First-time visitor onboarding — guided tour after the office scene loads.
 * Team members get a longer walkthrough of day-to-day workflows.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'denizen-onboarding-seen-v2';
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

  function isTeamVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isTeam?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isTeam?.() && !sess?.isDemo?.();
  }

  function moveLine() {
    if (isTouchUi() && isTapMove()) {
      return 'Tap anywhere on the floor to walk. Tap an NPC to start a conversation. Use E (top-right) near desks and chairs.';
    }
    if (isTouchUi()) {
      return 'Use the joystick to move, or tap a spot on the floor. Tap an NPC to talk.';
    }
    return 'Use arrow keys to walk. Walk up to an NPC and face them, or click their sprite to open chat.';
  }

  function claimLine() {
    if (isTouchUi()) {
      return 'Walk up to someone useful (Lucy, Alex, Roki…) and tap ⭐ Claim above the office.';
    }
    return 'Face an NPC and press C, or tap ⭐ Claim — they become your persistent assistant.';
  }

  /** @type {Array<{ id: string, anchor: string, title: string, tips: string[], teamOnly?: boolean }>} */
  const STEP_DEFS = [
    {
      id: 'welcome',
      anchor: 'center',
      title: 'Welcome to your AI office',
      tips: [
        'Denizen is a live pixel office where every character is an AI agent doing real work.',
        'Use it day-to-day to delegate tasks, watch progress, and stay aligned with your team.',
        'This short tour shows the controls that matter most.',
      ],
    },
    {
      id: 'move',
      anchor: 'game',
      title: 'Walk the office',
      tips: [
        moveLine,
        'The office runs 24/7 — NPCs keep thinking, talking, and producing work while you are away.',
      ],
    },
    {
      id: 'chat',
      anchor: 'chat-fab',
      title: 'Talk to any NPC',
      tips: [
        'Tap 💬 in the dock (or press Enter / T on desktop) to open chat.',
        'Ask Lucy about email, calendar, or job applications.',
        'Ask engineers (Alex, Josh, Edward) about code. Ask Bob or Lucy to research a topic.',
        'Try: “What can you do?” to see each NPC’s capabilities.',
      ],
    },
    {
      id: 'claim',
      anchor: 'claim',
      title: 'Claim your personal assistant',
      tips: [
        claimLine,
        'Your assistant remembers context across sessions and can be wired into Cursor, Claude, or ChatGPT.',
        'Good picks: Lucy (ops/admin), Alex (engineering lead), Roki (intern + quick tasks).',
      ],
    },
    {
      id: 'voice',
      anchor: 'voice',
      title: 'Hear NPC replies',
      tips: [
        'Tap 👤 in the dock to turn voice ON (green = on).',
        'When voice is on, NPCs speak aloud — useful when you are mobile or multitasking.',
        'Tap 👤 again to mute if you need a quiet session.',
      ],
    },
    {
      id: 'mic',
      anchor: 'mic',
      title: 'Speak instead of typing',
      tips: [
        'Tap 🎤 in the dock, speak your message, tap 🎤 again when done.',
        'Your words go into chat — great for quick asks while walking the office.',
        'Works best after you have opened 💬 chat at least once.',
      ],
    },
    {
      id: 'browser',
      anchor: 'browser',
      title: 'Watch live browser work',
      tips: [
        'Tap 🌐 in the dock when Lucy (or another NPC) is searching the web.',
        'You see their browser live — useful for research, competitor checks, and demos.',
        'Ask in chat: “open a browser” or “search for …” then open 🌐 to follow along.',
      ],
    },
    {
      id: 'handoff',
      anchor: 'chat-fab',
      title: 'Hand off to teammates',
      teamOnly: true,
      tips: [
        'Open 💬 chat, then tap ↗ Hand off in the chat header.',
        'Send context, a question, or a task to Lucy, a teammate, or leadership.',
        'When someone hands off to you, a toast appears — tap Reply to continue in chat.',
        'Use this instead of Slack for “can you take this?” moments inside Denizen.',
      ],
    },
    {
      id: 'connect',
      anchor: 'chat-header',
      title: 'Connect your own AI',
      teamOnly: true,
      tips: [
        'After you claim an NPC, tap Connect AI next to your assistant chip in chat.',
        'Link Cursor, Claude Desktop, or a ChatGPT Custom GPT to your in-world assistant.',
        'Your external AI can log activity, update memory, and read status — same brain, two interfaces.',
        'Day-to-day: keep coding in Cursor while your Denizen NPC stays in sync with the team.',
      ],
    },
    {
      id: 'briefing',
      anchor: 'briefing',
      title: 'Morning briefing',
      teamOnly: true,
      tips: [
        'After you claim an assistant, a Briefing button appears in the chat header.',
        'Open it for the morning digest — open commitments, pipeline notes, and forecasts.',
        'Check it at the start of your day instead of digging through separate dashboards.',
      ],
    },
    {
      id: 'daily',
      anchor: 'dock',
      title: 'Your day-to-day cheat sheet',
      tips: [
        'Start of day: Briefing → scan what the team promised overnight.',
        'Need something done: walk to the right NPC → 💬 chat → be specific.',
        'Blocked on a teammate: ↗ Hand off with context, not just a ping.',
        'Deep work in your IDE: Connect AI on your claimed assistant.',
        'Press Tab (desktop) for the live work feed — see what every NPC is doing right now.',
      ],
    },
  ];

  function resolveTips(step) {
    return step.tips.map((t) => (typeof t === 'function' ? t() : t));
  }

  function buildSteps() {
    const team = isTeamVisitor();
    return STEP_DEFS.filter((s) => !s.teamOnly || team);
  }

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
        background: rgba(2, 6, 23, 0.55);
        pointer-events: auto;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 16px 18px;
        width: min(380px, calc(100vw - 28px));
        max-height: min(72dvh, 520px);
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        pointer-events: auto;
        color: #e2e8f0;
        touch-action: manipulation;
        z-index: 1;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0 0 6px;
        font-size: 10px;
        color: #4ade80;
        font-weight: bold;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .onb-title {
        margin: 0 0 10px;
        font-size: 15px;
        line-height: 1.3;
        color: #f8fafc;
        font-weight: bold;
      }
      #${OVERLAY_ID} .onb-tips {
        margin: 0 0 14px;
        padding-left: 18px;
        font-size: 12px;
        line-height: 1.5;
        color: #cbd5e1;
      }
      #${OVERLAY_ID} .onb-tips li {
        margin-bottom: 6px;
      }
      #${OVERLAY_ID} .onb-tips li:last-child {
        margin-bottom: 0;
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
        position: sticky;
        bottom: 0;
        background: #020617;
        padding-top: 8px;
      }
      #${OVERLAY_ID} .onb-skip,
      #${OVERLAY_ID} .onb-next {
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
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 6px;
        padding: 10px 16px;
        font: inherit;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      }
      #${OVERLAY_ID} .onb-next:hover { background: #22c55e; }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 5px;
        margin-right: auto;
        flex-wrap: wrap;
        max-width: 55%;
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
    `;
    document.head.appendChild(s);
  }

  function canUseReplayChip() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return true;
  }

  function rewireReplayChip() {
    const chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) return;
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
      chip.textContent = 'Tour';
      chip.title = 'Replay the team onboarding tour';
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
    if (!el || el.offsetParent === null && id !== 'denizen-bottom-dock') return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;
    return r;
  }

  function getAnchorRect(anchor) {
    if (anchor === 'center') return centerRect();
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
    if (anchor === 'dock') {
      return rectForEl('denizen-bottom-dock') || centerRect();
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
  }

  function clearStepUnbinds() {
    stepUnbinds.forEach((fn) => fn());
    stepUnbinds = [];
  }

  function wireStepButtons(skipBtn, nextBtn) {
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

  function dismiss() {
    markSeen();
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

  function renderStep() {
    if (!overlayEl) return;
    const step = activeSteps[stepIndex];
    if (!step) {
      dismiss();
      return;
    }

    const tips = resolveTips(step);
    const tooltip = overlayEl.querySelector('.onb-tooltip');
    tooltip.innerHTML = `
      <p class="onb-step">Step ${stepIndex + 1} of ${activeSteps.length}</p>
      <p class="onb-title">${escapeHtml(step.title)}</p>
      <ul class="onb-tips">
        ${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
      <div class="onb-actions">
        <div class="onb-dots">
          ${activeSteps.map((_, i) => `<span class="onb-dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
        </div>
        <button type="button" class="onb-skip">Skip tour</button>
        <button type="button" class="onb-next">${stepIndex < activeSteps.length - 1 ? 'Next' : 'Start working'}</button>
      </div>
    `;

    wireStepButtons(
      tooltip.querySelector('.onb-skip'),
      tooltip.querySelector('.onb-next'),
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
      <div class="onb-tooltip" role="dialog" aria-label="Team onboarding"></div>
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

  const DenizenVisitorOnboarding = {
    attach(sc, pc) {
      scene = sc;
      playerChat = pc;

      const afterSession = () => {
        mountReplayChip();
        if (shouldShow()) waitForSceneReady(scene, playerChat);
      };

      globalThis.DenizenVisitorSession?.init?.().then(afterSession).catch(afterSession);

      console.log('[DenizenVisitorOnboarding] attached');
    },

    detach() {
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
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('denizen-onboarding-seen');
      } catch (_) {}
    },
  };

  globalThis.DenizenVisitorOnboarding = DenizenVisitorOnboarding;
})();
