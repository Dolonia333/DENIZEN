/**
 * First-time visitor onboarding — a short arrival story after the office loads.
 * The first run explains belonging, people, the phone, claiming, and City Power.
 * Detailed product capabilities stay in the Guide instead of crowding the tour.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY_PREFIX = 'denizen-onboarding-seen-v6';
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
  let badgeIssueInFlight = false;

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

  function isCitizenTierVisitor() {
    const sess = globalThis.DenizenVisitorSession;
    const rawTier = String(sess?.getTier?.() || '').toLowerCase();
    return rawTier === 'team' || rawTier === 'ceo' || isTeamVisitor();
  }

  function hasCitizenBadge() {
    const sess = globalThis.DenizenVisitorSession;
    const profile = sess?.getProfile?.() || {};
    return (
      globalThis.denizenBadgeIssued === true
      || sess?.hasCitizenBadge?.() === true
      || profile.badgeIssued === true
      || profile.badge_issued === true
      || profile.metadata?.badgeIssued === true
      || profile.metadata?.badge_issued === true
    );
  }

  async function issueCitizenBadgeIfNeeded() {
    if (!isCitizenTierVisitor()) return;
    if (hasCitizenBadge() || badgeIssueInFlight) return;
    badgeIssueInFlight = true;
    const sess = globalThis.DenizenVisitorSession;
    let issued = false;
    try {
      if (typeof sess?.markBadgeIssued === 'function') {
        await sess.markBadgeIssued({ badgeIssued: true });
        issued = true;
      } else if (typeof sess?.setSessionFlag === 'function') {
        await sess.setSessionFlag('badgeIssued', true);
        issued = true;
      } else if (typeof sess?.setFlag === 'function') {
        await sess.setFlag('badgeIssued', true);
        issued = true;
      } else if (sess?.getSessionId?.() && typeof fetch === 'function') {
        const body = {
          session_id: sess.getSessionId(),
          display_name: sess.getDisplayName?.() || 'Citizen',
          metadata: { badgeIssued: true, badge_issued: true },
        };
        const res = await fetch('/api/visitor/session', {
          method: 'POST',
          headers: sess.authHeaders?.({ 'Content-Type': 'application/json' }) || { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res?.ok) throw new Error('badge sync failed');
        issued = true;
      }
    } catch (_) {
      issued = false;
    }
    if (!issued) {
      // Fallback for clients without a badge session API.
      globalThis.denizenBadgeIssued = true;
      return;
    }
    globalThis.denizenBadgeIssued = true;
    try {
      document.dispatchEvent(new CustomEvent('denizen-citizen-badge-issued'));
    } catch (_) {}
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
      ? 'Tap the phone button to open your office key.'
      : 'Open the phone at the lower-right. It is your office key.';
  }

  function arrivalTips() {
    return [
      'Denizen starts as an AI office you can actually see.',
      'Meet the residents, give them real work, and stay close to what happens next.',
    ];
  }

  function officeTips() {
    return [
      moveLine(),
      'Ask a resident for help. They move to a desk and keep the work visible while it happens.',
      'Blocked or finished, the office shows you the state of the job.',
    ];
  }

  function phoneTips() {
    return [
      phoneLine(),
      'Chat, your Citizen ID, your team, and station tools all live here.',
      'The phone is the key that carries your assistant, credits, and next steps from office to city.',
    ];
  }

  function claimTips() {
    return [
      claimLine(),
      'Your assistant becomes a familiar home base who remembers your work and helps you navigate the office.',
      'Your Citizen ID keeps that relationship connected when you return.',
    ];
  }

  function powerTips() {
    return [
      'City Power is optional. Denizen Desktop turns your office machine into a station for background city work while it is idle.',
      'Your everyday use always comes first, and you can pause City Power anytime.',
      'Contributing available capacity earns credits for your office.',
    ];
  }

  function readyTips() {
    if (isDemoVisitor()) {
      return [
        'Start with one useful office task and watch Denizen respond.',
        'This preview is yours to explore. The city is the next level when you are ready to make your place permanent.',
      ];
    }
    return [
      'Start with one useful office task and watch Denizen respond.',
      'Your phone, assistant, and Citizen ID will keep your place familiar as your office grows toward the city.',
    ];
  }

  /** @type {Array<{ id: string, icon: string, anchor: string, title: string, tips: string[] | (() => string[]), upgradeAction?: boolean }>} */
  const STEP_DEFS = [
    {
      id: 'arrival',
      icon: '◆',
      anchor: 'center',
      title: 'Welcome home.',
      tips: arrivalTips,
    },
    {
      id: 'office',
      icon: '⌂',
      anchor: 'game',
      title: 'See the work happen.',
      tips: officeTips,
    },
    {
      id: 'phone',
      icon: '▣',
      anchor: 'phone',
      title: 'Your office key',
      tips: phoneTips,
    },
    {
      id: 'claim',
      icon: '★',
      anchor: 'claim',
      title: 'Choose your assistant.',
      tips: claimTips,
    },
    {
      id: 'power',
      icon: '◇',
      anchor: 'phone-power',
      title: 'Power the city from your office.',
      tips: powerTips,
    },
    {
      id: 'ready',
      icon: '✓',
      anchor: 'center',
      title: 'Your place is ready.',
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
        --onb-ink: #f4f7f5;
        --onb-muted: #9eaaa5;
        --onb-panel: #0b1518;
        --onb-panel-soft: #101e21;
        --onb-line: rgba(180, 210, 201, 0.16);
        --onb-mint: #7ee3bd;
        --onb-mint-strong: #46c996;
        --onb-amber: #f6c768;
        position: fixed;
        inset: 0;
        z-index: 2147482000;
        pointer-events: none;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 18% 10%, rgba(70, 201, 150, 0.14), transparent 30%),
          linear-gradient(rgba(126, 227, 189, 0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(126, 227, 189, 0.025) 1px, transparent 1px),
          rgba(3, 10, 12, 0.76);
        background-size: auto, 28px 28px, 28px 28px, auto;
        backdrop-filter: blur(2px);
        pointer-events: none;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-focus {
        position: fixed;
        border: 1px solid rgba(126, 227, 189, 0.72);
        border-radius: 16px;
        box-shadow:
          0 0 0 5px rgba(70, 201, 150, 0.1),
          0 0 30px rgba(70, 201, 150, 0.24);
        pointer-events: none;
        transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        box-sizing: border-box;
        isolation: isolate;
        background:
          radial-gradient(circle at 12% 0%, rgba(70, 201, 150, 0.11), transparent 34%),
          linear-gradient(180deg, rgba(12, 24, 27, 0.99), rgba(8, 17, 19, 0.99));
        border: 1px solid var(--onb-line);
        border-radius: 24px;
        padding: 26px;
        width: min(460px, calc(100vw - 28px));
        max-height: min(78dvh, 590px);
        overflow-y: auto;
        box-shadow: 0 30px 90px rgba(0, 0, 0, 0.52);
        pointer-events: auto;
        color: var(--onb-ink);
        touch-action: manipulation;
        z-index: 1;
        scrollbar-color: rgba(126, 227, 189, 0.28) transparent;
      }
      #${OVERLAY_ID} .onb-tooltip::before {
        content: "";
        position: absolute;
        z-index: -1;
        inset: 0 0 auto;
        height: 3px;
        border-radius: 24px 24px 0 0;
        background: linear-gradient(90deg, var(--onb-mint-strong), rgba(70, 201, 150, 0.08) 72%, transparent);
      }
      #${OVERLAY_ID} .onb-heading {
        display: grid;
        grid-template-columns: 46px 1fr;
        gap: 14px;
        align-items: center;
        margin-bottom: 18px;
      }
      #${OVERLAY_ID} .onb-icon {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 11px;
        background: rgba(126, 227, 189, 0.08);
        border: 1px solid rgba(126, 227, 189, 0.45);
        color: var(--onb-mint);
        box-shadow: inset 0 0 18px rgba(126, 227, 189, 0.07);
        font: 20px/1 ui-sans-serif, system-ui, sans-serif;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0 0 6px;
        color: var(--onb-mint);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .onb-tier-badge {
        display: inline-block;
        margin-left: 8px;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 9px;
        letter-spacing: 0.08em;
        vertical-align: middle;
      }
      #${OVERLAY_ID} .onb-tier-badge.demo {
        background: rgba(246, 199, 104, 0.09);
        color: var(--onb-amber);
        border: 1px solid rgba(246, 199, 104, 0.3);
      }
      #${OVERLAY_ID} .onb-tier-badge.team {
        background: rgba(126, 227, 189, 0.08);
        color: var(--onb-mint);
        border: 1px solid rgba(126, 227, 189, 0.28);
      }
      #${OVERLAY_ID} .onb-title {
        margin: 0;
        color: var(--onb-ink);
        font-size: 26px;
        line-height: 1.08;
        letter-spacing: -0.035em;
        font-weight: 800;
      }
      #${OVERLAY_ID} .onb-copy {
        display: grid;
        gap: 9px;
        margin: 0 0 22px;
        color: var(--onb-muted);
        font-size: 14px;
        line-height: 1.55;
      }
      #${OVERLAY_ID} .onb-copy p {
        margin: 0;
        padding: 11px 12px;
        border: 1px solid var(--onb-line);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.025);
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 9px;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: wrap;
        position: sticky;
        bottom: 0;
        margin: 0 -2px -2px;
        padding: 12px 2px 2px;
        background: linear-gradient(180deg, rgba(8, 17, 19, 0), rgba(8, 17, 19, 0.98) 28%);
      }
      #${OVERLAY_ID} .onb-skip,
      #${OVERLAY_ID} .onb-next,
      #${OVERLAY_ID} .onb-upgrade {
        min-height: 44px;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-skip {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 10px;
        color: #82908b;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        padding: 10px 12px;
      }
      #${OVERLAY_ID} .onb-skip:hover {
        color: #cad5d1;
        border-color: var(--onb-line);
        background: rgba(255, 255, 255, 0.025);
      }
      #${OVERLAY_ID} .onb-next {
        background: var(--onb-mint-strong);
        color: #061411;
        border: 1px solid rgba(126, 227, 189, 0.62);
        border-radius: 10px;
        padding: 10px 17px;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(70, 201, 150, 0.16);
      }
      #${OVERLAY_ID} .onb-next:hover { background: var(--onb-mint); }
      #${OVERLAY_ID} .onb-upgrade {
        background: transparent;
        color: var(--onb-amber);
        border: 1px solid rgba(246, 199, 104, 0.34);
        border-radius: 10px;
        padding: 10px 14px;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-upgrade:hover {
        border-color: rgba(246, 199, 104, 0.65);
        background: rgba(246, 199, 104, 0.06);
        color: #ffe2a0;
      }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 6px;
        width: 112px;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-dot {
        flex: 1;
        height: 4px;
        border-radius: 999px;
        background: #213033;
      }
      #${OVERLAY_ID} .onb-dot.done,
      #${OVERLAY_ID} .onb-dot.active { background: var(--onb-mint-strong); }
      #${OVERLAY_ID} .onb-dot.active { box-shadow: 0 0 10px rgba(70, 201, 150, 0.42); }
      /* Keep the game playable during the tour — only the tooltip captures clicks. */
      #${TOUR_CHIP_ID} {
        display: none;
        background: rgba(11, 21, 24, 0.96);
        color: #7ee3bd;
        border: 1px solid rgba(126, 227, 189, 0.3);
        border-radius: 999px;
        padding: 6px 11px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${TOUR_CHIP_ID}.ready { display: inline-flex; align-items: center; }
      #${TOUR_CHIP_ID}:hover { border-color: #7ee3bd; color: #d8fff0; }
      @media (max-width: 520px) {
        #${OVERLAY_ID} .onb-tooltip {
          padding: 20px;
          border-radius: 20px;
        }
        #${OVERLAY_ID} .onb-title { font-size: 22px; }
        #${OVERLAY_ID} .onb-copy { font-size: 13px; }
        #${OVERLAY_ID} .onb-actions { gap: 6px; }
        #${OVERLAY_ID} .onb-dots { width: 84px; }
        #${OVERLAY_ID} .onb-upgrade {
          order: -1;
          width: 100%;
          margin-right: 0;
        }
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
    return 'Office tour';
  }

  function rewireReplayChip() {
    const chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) return;
    // Touch dock is icon-only — full label lives in the tooltip
    const touch = document.documentElement.classList.contains('denizen-touch');
    const T = globalThis.DenizenTablerIcons;
    if (T) {
      chip.innerHTML = touch ? T.icon('book', { size: 14 }) : T.chip('book', replayChipLabel(), { size: 13 });
    } else {
      chip.textContent = touch ? 'Tour' : replayChipLabel();
    }
    chip.title = 'Replay the Denizen office tour';
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
    return 'Denizen office tour';
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
          <p class="onb-step">Office tour · ${stepIndex + 1} of ${activeSteps.length}${tierBadgeHtml()}</p>
          <p class="onb-title">${escapeHtml(step.title)}</p>
        </div>
      </div>
      <div class="onb-copy">
        ${tips.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}
      </div>
      <div class="onb-actions">
        <div class="onb-dots">
          ${activeSteps.map((_, i) => `<span class="onb-dot${i < stepIndex ? ' done' : i === stepIndex ? ' active' : ''}"></span>`).join('')}
        </div>
        ${step.upgradeAction ? '<button type="button" class="onb-upgrade">Make my place permanent</button>' : ''}
        <button type="button" class="onb-skip">Skip</button>
        <button type="button" class="onb-next">${isLast ? 'Enter the office' : 'Continue'}</button>
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
    try {
      window.__DenizenGameInputBlocked = false;
      if (window.game?.input) window.game.input.enabled = true;
      window.game?.input?.keyboard?.enableGlobalCapture?.();
      window.DenizenMovementGuard?.unlock?.();
    } catch (_) {}
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
    issueCitizenBadgeIfNeeded();
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
    badgeIssueInFlight = false;
    delete globalThis.denizenBadgeIssued;
  }

  function onProfileUpdated() {
    issueCitizenBadgeIfNeeded();
  }

  const DenizenVisitorOnboarding = {
    attach(sc, pc) {
      scene = sc;
      playerChat = pc;

      document.addEventListener('denizen-visitor-session-ready', onSessionReady);
      document.addEventListener('denizen-visitor-logged-out', onLoggedOut);
      document.addEventListener('denizen-visitor-profile-updated', onProfileUpdated);

      const afterSession = () => onSessionReady();

      globalThis.DenizenVisitorSession?.init?.().then(afterSession).catch(afterSession);

      console.log('[DenizenVisitorOnboarding] attached');
    },

    detach() {
      document.removeEventListener('denizen-visitor-session-ready', onSessionReady);
      document.removeEventListener('denizen-visitor-logged-out', onLoggedOut);
      document.removeEventListener('denizen-visitor-profile-updated', onProfileUpdated);
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
