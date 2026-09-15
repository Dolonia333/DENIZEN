/**
 * First-time visitor onboarding — a short arrival story after the office loads.
 * The first run explains belonging, people, the phone, claiming, and City Power.
 * Detailed product capabilities stay in the Guide instead of crowding the tour.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY_PREFIX = 'denizen-onboarding-seen-v7';
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
      'Denizen starts as an AI office you can actually see — give the residents real work and stay close to what happens next.',
      moveLine(),
      'Ask a resident for help. They move to a desk and keep the work visible while it happens.',
    ];
  }

  function phoneTips() {
    return [
      "I'm Buzz — your office key. Open me anytime for chat, Citizen ID, team, and station tools.",
      phoneLine(),
      'I carry your assistant, credits, and next steps from office to city.',
    ];
  }

  /** Last step — also carries the old "ready" wrap-up. */
  function claimTips() {
    return [
      claimLine(),
      'Your assistant remembers your work, and your Citizen ID keeps that relationship connected when you return.',
      isDemoVisitor()
        ? 'This preview is yours to explore. Make your place permanent whenever you are ready.'
        : 'Start with one useful office task and watch Denizen respond.',
    ];
  }

  /** @type {Array<{ id: string, icon: string, anchor: string, title: string, tips: string[] | (() => string[]), upgradeAction?: boolean }>} */
  // Three stops, first run only. City Power moved out: team members get the
  // Power Tour (visitor-superuser-onboarding.js) once Desktop is linked, and
  // everyone has the City Power app on the phone.
  const STEP_DEFS = [
    {
      id: 'arrival',
      icon: '◆',
      anchor: 'center',
      title: 'Welcome home.',
      tips: arrivalTips,
    },
    {
      id: 'phone',
      icon: '▣',
      anchor: 'phone',
      title: 'Hey — I work here too.',
      tips: phoneTips,
    },
    {
      id: 'claim',
      icon: '★',
      anchor: 'claim',
      title: 'Choose your assistant.',
      tips: claimTips,
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
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    if (!document.getElementById('denizen-visitor-session-fonts')
      && !document.getElementById('denizen-onboarding-fonts')) {
      const fontLink = document.createElement('link');
      fontLink.id = 'denizen-onboarding-fonts';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&display=swap';
      document.head.appendChild(fontLink);
    }
    s.textContent = `
      @keyframes denizen-onb-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      @keyframes denizen-onb-blink {
        0%, 46%, 54%, 100% { transform: scaleY(1); }
        50% { transform: scaleY(0.12); }
      }
      @keyframes denizen-onb-corner-in {
        from { opacity: 0; transform: translate(28px, 18px) rotate(6deg) scale(0.92); }
        to { opacity: 1; transform: translate(0, 0) rotate(3deg) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${OVERLAY_ID} .onb-buzz-phone,
        #${OVERLAY_ID} .onb-buzz-eye { animation: none !important; }
        #${OVERLAY_ID} .onb-buzz--corner { animation: none !important; }
      }
      #${OVERLAY_ID} {
        --onb-ink: #e2e8f0;
        --onb-muted: #94a3b8;
        --onb-accent: #7dd3fc;
        --onb-amber: #f59e0b;
        --onb-display: "Syne", "Avenir Next", "Segoe UI", system-ui, sans-serif;
        --onb-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        position: fixed;
        inset: 0;
        z-index: 2147482000;
        pointer-events: none;
        font-family: var(--onb-mono);
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 70% 50% at 50% 40%, rgba(56, 189, 248, 0.12), transparent 58%),
          rgba(2, 6, 23, 0.55);
        pointer-events: none;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-focus {
        position: fixed;
        border: 2px solid color-mix(in srgb, var(--onb-accent) 70%, #020617);
        border-radius: 6px;
        box-shadow:
          0 0 0 2px rgba(245, 158, 11, 0.35),
          0 0 28px rgba(56, 189, 248, 0.2);
        pointer-events: none;
        transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 18px;
        width: min(440px, calc(100vw - 28px));
        max-height: none;
        overflow: visible;
        padding-top: 4px;
        pointer-events: auto;
        touch-action: manipulation;
        z-index: 1;
      }
      #${OVERLAY_ID} .onb-buzz {
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 10px;
        transform: rotate(-4deg);
        filter: drop-shadow(3px 4px 0 rgba(0, 0, 0, 0.45));
        flex-shrink: 0;
        margin: 0 0 2px 4px;
        /* Keep antenna + bob inside the layout box so viewport clamp can't clip Buzz. */
        padding-top: 16px;
        padding-right: 12px;
        padding-bottom: 2px;
        box-sizing: border-box;
      }
      #${OVERLAY_ID} .onb-corner-host {
        position: fixed;
        z-index: 3;
        pointer-events: auto;
        touch-action: manipulation;
        filter: drop-shadow(3px 4px 0 rgba(0, 0, 0, 0.45));
      }
      #${OVERLAY_ID} .onb-buzz--corner {
        margin: 0;
        padding-top: 16px;
        padding-right: 0;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        transform: rotate(3deg);
        cursor: pointer;
        animation: denizen-onb-corner-in 420ms cubic-bezier(0.22, 1.2, 0.36, 1) both;
      }
      #${OVERLAY_ID} .onb-buzz--corner .onb-buzz-bubble {
        order: 0;
        margin: 0 2px 0 0;
        max-width: min(168px, 46vw);
        border-radius: 10px 10px 3px 10px;
        text-align: right;
      }
      #${OVERLAY_ID} .onb-buzz--corner .onb-buzz-bubble::after {
        left: auto;
        right: 18px;
      }
      #${OVERLAY_ID} .onb-buzz--corner .onb-buzz-bubble::before {
        left: auto;
        right: 20px;
      }
      #${OVERLAY_ID} .onb-buzz--corner .onb-buzz-phone {
        order: 1;
        width: 54px;
        height: 66px;
      }
      #${OVERLAY_ID} .onb-buzz--corner .onb-buzz-tag {
        left: auto;
        right: -6px;
        bottom: 12px;
      }
      #${OVERLAY_ID} .onb-buzz-bubble {
        position: relative;
        order: 2;
        max-width: min(200px, 54vw);
        margin-bottom: 16px;
        padding: 8px 11px;
        border-radius: 10px 10px 10px 3px;
        background: #fef3c7;
        color: #422006;
        font-family: var(--onb-display);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.01em;
        line-height: 1.3;
        border: 2px solid #020617;
        box-shadow: 2px 3px 0 #020617;
      }
      #${OVERLAY_ID} .onb-buzz-bubble::after {
        content: "";
        position: absolute;
        left: 16px;
        bottom: -8px;
        border: 6px solid transparent;
        border-top-color: #020617;
        border-bottom: 0;
      }
      #${OVERLAY_ID} .onb-buzz-bubble::before {
        content: "";
        position: absolute;
        left: 18px;
        bottom: -5px;
        border: 5px solid transparent;
        border-top-color: #fef3c7;
        border-bottom: 0;
        z-index: 1;
      }
      #${OVERLAY_ID} .onb-buzz-phone {
        order: 1;
        position: relative;
        width: 52px;
        height: 66px;
        border-radius: 12px 12px 16px 16px;
        background: #1e293b;
        border: 3px solid #020617;
        box-shadow: inset 0 2px 0 rgba(255,255,255,0.1), 3px 4px 0 #020617;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 8px;
        gap: 5px;
        animation: denizen-onb-bob 2.2s ease-in-out infinite;
        flex-shrink: 0;
      }
      #${OVERLAY_ID} .onb-buzz-antenna {
        position: absolute;
        top: -10px;
        right: 12px;
        width: 3px;
        height: 11px;
        background: #94a3b8;
        border-radius: 2px;
      }
      #${OVERLAY_ID} .onb-buzz-antenna::after {
        content: "";
        position: absolute;
        top: -4px;
        left: -3px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #f87171;
        border: 2px solid #020617;
      }
      #${OVERLAY_ID} .onb-buzz-screen {
        width: 32px;
        height: 22px;
        border-radius: 4px;
        background: #38bdf8;
        border: 2px solid #020617;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
      }
      #${OVERLAY_ID} .onb-buzz-eye {
        width: 5px;
        height: 7px;
        border-radius: 2px;
        background: #0b1220;
        transform-origin: center;
        animation: denizen-onb-blink 3.6s ease-in-out infinite;
      }
      #${OVERLAY_ID} .onb-buzz-eye:nth-child(2) { animation-delay: 0.12s; }
      #${OVERLAY_ID} .onb-buzz-pad {
        display: grid;
        grid-template-columns: repeat(3, 5px);
        gap: 2px;
      }
      #${OVERLAY_ID} .onb-buzz-pad span {
        width: 5px;
        height: 5px;
        border-radius: 1px;
        background: #475569;
        border: 1px solid #020617;
      }
      #${OVERLAY_ID} .onb-buzz-tag {
        position: absolute;
        left: 38px;
        bottom: 14px;
        font-family: var(--onb-display);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #fde68a;
        background: #0b1220;
        border: 2px solid var(--onb-amber);
        border-radius: 4px;
        padding: 1px 5px;
        box-shadow: 2px 2px 0 #020617;
        z-index: 2;
      }
      #${OVERLAY_ID} .onb-card {
        position: relative;
        z-index: 1;
        width: 100%;
        max-height: min(68dvh, 520px);
        overflow: visible;
        box-sizing: border-box;
        padding: 30px 20px 18px;
        color: var(--onb-ink);
        background:
          repeating-linear-gradient(
            -12deg,
            transparent,
            transparent 11px,
            rgba(148, 163, 184, 0.03) 11px,
            rgba(148, 163, 184, 0.03) 12px
          ),
          #111827;
        border: 3px solid #020617;
        border-radius: 4px;
        box-shadow:
          inset 0 0 0 2px #334155,
          0 0 0 2px var(--onb-amber),
          5px 7px 0 #020617;
        scrollbar-color: rgba(125, 211, 252, 0.35) transparent;
      }
      #${OVERLAY_ID} .onb-card::before {
        content: "HQ TOUR";
        position: absolute;
        top: -12px;
        left: 72px;
        padding: 3px 8px;
        font-family: var(--onb-display);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        line-height: 1.2;
        color: #0b1220;
        background: var(--onb-amber);
        border: 2px solid #020617;
        border-radius: 3px;
        box-shadow: 2px 2px 0 #020617;
        z-index: 2;
        white-space: nowrap;
      }
      /* Corner HUD peeks both FABs; suppress during tour so left-edge hover
         does not pop the speak/phone icons while Buzz guides. */
      html[data-denizen-onboarding="open"].denizen-desktop #denizen-corner-hit-phone,
      html[data-denizen-onboarding="open"].denizen-desktop #denizen-corner-hit-speak {
        display: none !important;
        pointer-events: none !important;
      }
      html[data-denizen-onboarding="open"].denizen-desktop #denizen-speak-fab {
        transform: translateX(-110%) !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      /* Phone step: Buzz stands in for the FAB in the lower-right corner. */
      html[data-denizen-onboarding="open"][data-denizen-onboarding-anchor="phone"] #denizen-phone-fab {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transform: none !important;
      }
      html[data-denizen-onboarding="open"][data-denizen-onboarding-anchor="phone-power"].denizen-desktop #denizen-phone-fab {
        transform: translateX(0) !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
      #${OVERLAY_ID} .onb-heading {
        display: grid;
        grid-template-columns: 1fr;
        gap: 4px;
        margin: 4px 0 14px;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0;
        color: var(--onb-accent);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .onb-tier-badge {
        display: inline-block;
        margin-left: 8px;
        padding: 2px 7px;
        border-radius: 3px;
        font-size: 9px;
        letter-spacing: 0.08em;
        vertical-align: middle;
        border: 2px solid #020617;
        box-shadow: 1px 1px 0 #020617;
      }
      #${OVERLAY_ID} .onb-tier-badge.demo {
        background: rgba(245, 158, 11, 0.15);
        color: #fde68a;
      }
      #${OVERLAY_ID} .onb-tier-badge.team {
        background: rgba(56, 189, 248, 0.15);
        color: #bae6fd;
      }
      #${OVERLAY_ID} .onb-title {
        margin: 0;
        color: #f8fafc;
        font-family: var(--onb-display);
        font-size: clamp(20px, 5vw, 26px);
        line-height: 1.1;
        letter-spacing: 0.02em;
        font-weight: 800;
      }
      #${OVERLAY_ID} .onb-copy {
        display: grid;
        gap: 8px;
        margin: 0 0 18px;
        max-height: min(42dvh, 280px);
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        color: var(--onb-muted);
        font-size: 13px;
        line-height: 1.5;
      }
      #${OVERLAY_ID} .onb-copy p {
        margin: 0;
        padding: 10px 12px;
        border: 2px solid #020617;
        border-radius: 6px;
        background: rgba(2, 6, 23, 0.55);
        box-shadow: inset 0 0 0 1px #334155;
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: wrap;
        position: sticky;
        bottom: 0;
        margin: 0 -2px -2px;
        padding: 12px 2px 2px;
        background: linear-gradient(180deg, rgba(17, 24, 39, 0), #111827 30%);
      }
      #${OVERLAY_ID} .onb-skip,
      #${OVERLAY_ID} .onb-next,
      #${OVERLAY_ID} .onb-upgrade {
        min-height: 44px;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-skip {
        background: transparent;
        border: 2px solid transparent;
        border-radius: 8px;
        color: #64748b;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        padding: 10px 12px;
      }
      #${OVERLAY_ID} .onb-skip:hover {
        color: #cbd5e1;
        border-color: #334155;
        background: rgba(15, 23, 42, 0.6);
      }
      #${OVERLAY_ID} .onb-next {
        background: linear-gradient(180deg, #bae6fd 0%, #7dd3fc 100%);
        color: #0b1220;
        border: 2px solid #020617;
        border-radius: 8px;
        padding: 10px 16px;
        font-family: var(--onb-display);
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--onb-accent) 45%, transparent), 3px 4px 0 #020617;
      }
      #${OVERLAY_ID} .onb-next:hover { filter: brightness(1.05); }
      #${OVERLAY_ID} .onb-upgrade {
        background: transparent;
        color: #fde68a;
        border: 2px solid #020617;
        border-radius: 8px;
        padding: 10px 14px;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        margin-right: auto;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45), 2px 3px 0 #020617;
      }
      #${OVERLAY_ID} .onb-upgrade:hover {
        background: rgba(245, 158, 11, 0.1);
        color: #fef3c7;
      }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 5px;
        width: 108px;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-dot {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: #334155;
        border: 1px solid #020617;
      }
      #${OVERLAY_ID} .onb-dot.done,
      #${OVERLAY_ID} .onb-dot.active { background: var(--onb-accent); }
      #${OVERLAY_ID} .onb-dot.active { box-shadow: 0 0 8px rgba(125, 211, 252, 0.45); }
      #${TOUR_CHIP_ID} {
        display: none;
        background: rgba(11, 18, 32, 0.96);
        color: #7dd3fc;
        border: 2px solid #020617;
        border-radius: 6px;
        padding: 6px 11px;
        font: 11px/1.2 var(--onb-mono);
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
        box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.4);
      }
      #${TOUR_CHIP_ID}.ready { display: inline-flex; align-items: center; }
      #${TOUR_CHIP_ID}:hover { color: #e0f2fe; border-color: #7dd3fc; }
      html.denizen-touch #${OVERLAY_ID} .onb-tooltip {
        width: min(100%, calc(100vw - 24px));
        max-height: calc(100dvh - 24px - env(safe-area-inset-bottom, 0px));
      }
      html.denizen-touch #${OVERLAY_ID} .onb-card {
        max-height: min(62dvh, calc(100dvh - 140px));
        padding: 26px 16px 16px;
        overflow: visible;
      }
      html.denizen-touch #${OVERLAY_ID} .onb-copy {
        max-height: min(36dvh, 240px);
      }
      @media (max-width: 520px) {
        #${OVERLAY_ID} .onb-title { font-size: 20px; }
        #${OVERLAY_ID} .onb-copy { font-size: 12px; }
        #${OVERLAY_ID} .onb-actions { gap: 6px; }
        #${OVERLAY_ID} .onb-dots { width: 84px; }
        #${OVERLAY_ID} .onb-upgrade {
          order: -1;
          width: 100%;
          margin-right: 0;
        }
      }
    `;
  }

  function canUseReplayChip() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return true;
  }

  function replayChipLabel() {
    return "Buzz's tour";
  }

  function rewireReplayChip() {
    const chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) return;
    // Touch dock is icon-only — full label lives in the tooltip
    const touch = document.documentElement.classList.contains('denizen-touch');
    globalThis.DenizenBottomDock?.renderChip?.(TOUR_CHIP_ID, touch ? '' : replayChipLabel(), { iconOnly: touch, title: "Replay Buzz's Denizen office tour" });
    if (!globalThis.DenizenBottomDock?.renderChip) chip.textContent = touch ? '📖' : replayChipLabel();
    chip.title = "Replay Buzz's Denizen office tour";
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

  function phoneFabRestRect() {
    const fab = document.getElementById('denizen-phone-fab');
    if (fab) {
      // Measure layout box ignoring auto-hide transform by reading CSS pixels.
      const w = fab.offsetWidth || 54;
      const h = fab.offsetHeight || 64;
      const cs = getComputedStyle(fab);
      const right = parseFloat(cs.right) || 14;
      const bottom = parseFloat(cs.bottom) || 14;
      const left = window.innerWidth - right - w;
      const top = window.innerHeight - bottom - h;
      return {
        left,
        top,
        width: w,
        height: h,
        right: left + w,
        bottom: top + h,
      };
    }
    const w = 54;
    const h = 64;
    const left = window.innerWidth - 14 - w;
    const top = window.innerHeight - 14 - h;
    return { left, top, width: w, height: h, right: left + w, bottom: top + h };
  }

  function getAnchorRect(anchor) {
    if (anchor === 'center') return centerRect();
    if (anchor === 'phone') {
      if (document.documentElement.classList.contains('denizen-phone-open')) {
        return rectForEl('denizen-phone-frame') || phoneFabRestRect();
      }
      const buzzBody = overlayEl?.querySelector('.onb-corner-host .onb-buzz-phone');
      if (buzzBody) {
        const r = buzzBody.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) return r;
      }
      return phoneFabRestRect();
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

  function safeMargins(opts = {}) {
    const root = getComputedStyle(document.documentElement);
    const num = (v) => parseFloat(v) || 0;
    const dockH = num(root.getPropertyValue('--denizen-dock-height')) || 48;
    // Extra top room when Buzz rides above the card (antenna + bob).
    const buzzPad = opts.withBuzz ? 22 : 0;
    return {
      top: Math.max(12 + buzzPad, num(root.getPropertyValue('--safe-top')) + 8 + buzzPad),
      right: Math.max(12, num(root.getPropertyValue('--safe-right')) + 8),
      bottom: Math.max(12, num(root.getPropertyValue('--safe-bottom')) + dockH + 12),
      left: Math.max(12, num(root.getPropertyValue('--safe-left')) + 8),
    };
  }

  function positionTooltip(tooltip, anchor) {
    const rect = getAnchorRect(anchor);
    const hasTopBuzz = !!tooltip.querySelector('.onb-buzz:not(.onb-buzz--corner)');
    const margin = safeMargins({ withBuzz: hasTopBuzz });
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 12;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    if (anchor === 'center') {
      top = window.innerHeight / 2 - tooltipRect.height / 2;
      left = window.innerWidth / 2 - tooltipRect.width / 2;
    } else if (anchor === 'phone') {
      // Card sits left of Buzz-in-the-corner; leave room for the mascot + bubble.
      const cornerW = 190;
      left = Math.min(
        rect.left - tooltipRect.width - 20,
        window.innerWidth - tooltipRect.width - cornerW - margin.right,
      );
      top = Math.min(
        Math.max(margin.top, rect.bottom - tooltipRect.height - 8),
        window.innerHeight - tooltipRect.height - margin.bottom,
      );
      if (left < margin.left) {
        left = margin.left;
        top = Math.max(margin.top, Math.min(top, window.innerHeight / 2 - tooltipRect.height / 2));
      }
    } else if (anchor === 'phone-power') {
      left = rect.left - tooltipRect.width - 16;
      top = Math.min(
        Math.max(margin.top, rect.bottom - tooltipRect.height),
        window.innerHeight - tooltipRect.height - margin.bottom,
      );
      if (left < margin.left) {
        left = margin.left;
        top = Math.max(margin.top, rect.top - tooltipRect.height - 12);
      }
    } else if (top + tooltipRect.height > window.innerHeight - margin.bottom) {
      top = rect.top - tooltipRect.height - 12;
    }
    left = Math.max(margin.left, Math.min(left, window.innerWidth - tooltipRect.width - margin.right));
    top = Math.max(margin.top, Math.min(top, window.innerHeight - tooltipRect.height - margin.bottom));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    const focus = overlayEl?.querySelector('.onb-focus');
    if (focus) {
      const pad = anchor === 'center' ? 0 : 10;
      focus.hidden = anchor === 'center';
      focus.style.left = `${Math.max(6, rect.left - pad)}px`;
      focus.style.top = `${Math.max(6, rect.top - pad)}px`;
      focus.style.width = `${Math.max(0, Math.min(window.innerWidth - 12, rect.width + pad * 2))}px`;
      focus.style.height = `${Math.max(0, Math.min(window.innerHeight - 12, rect.height + pad * 2))}px`;
    }
  }

  function buzzMascotHtml(bubbleText, { corner = false } = {}) {
    const bubble = bubbleText
      ? `<div class="onb-buzz-bubble">${escapeHtml(bubbleText)}</div>`
      : '';
    return `
      <aside class="onb-buzz${corner ? ' onb-buzz--corner' : ''}" aria-hidden="true">
        ${bubble}
        <div class="onb-buzz-phone">
          <span class="onb-buzz-antenna"></span>
          <div class="onb-buzz-screen">
            <span class="onb-buzz-eye"></span>
            <span class="onb-buzz-eye"></span>
          </div>
          <div class="onb-buzz-pad">
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
          </div>
        </div>
        <span class="onb-buzz-tag">Buzz</span>
      </aside>
    `;
  }

  function clearCornerBuzz() {
    const host = overlayEl?.querySelector('.onb-corner-host');
    if (!host) return;
    if (host._cleanup) host._cleanup();
    host._cleanup = null;
    host.hidden = true;
    host.innerHTML = '';
  }

  function placeCornerBuzz() {
    const host = overlayEl?.querySelector('.onb-corner-host');
    if (!host || host.hidden) return null;
    const rest = phoneFabRestRect();
    const hr = host.getBoundingClientRect();
    const left = Math.max(8, rest.right - Math.max(hr.width, 54));
    const top = Math.max(8, rest.bottom - Math.max(hr.height, 66));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    return host.getBoundingClientRect();
  }

  function syncCornerBuzz(step) {
    if (!overlayEl) return;
    let host = overlayEl.querySelector('.onb-corner-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'onb-corner-host';
      host.hidden = true;
      overlayEl.appendChild(host);
    }
    if (step?.id !== 'phone') {
      if (host._cleanup) host._cleanup();
      host._cleanup = null;
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    const needsMount = host.hidden || !host.querySelector('.onb-buzz--corner');
    if (needsMount) {
      if (host._cleanup) host._cleanup();
      host._cleanup = null;
      host.hidden = false;
      host.innerHTML = buzzMascotHtml(buzzGuideLine(step), { corner: true });

      const openPhone = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const fab = document.getElementById('denizen-phone-fab');
        if (fab) {
          fab.style.pointerEvents = 'auto';
          fab.click();
          fab.style.pointerEvents = '';
        }
      };
      const buzz = host.querySelector('.onb-buzz--corner');
      const bind = window.DenizenTouchBind?.bindPress;
      if (buzz && bind) {
        const off = bind(buzz, openPhone, { stop: true });
        host._cleanup = typeof off === 'function' ? off : null;
      } else if (buzz) {
        buzz.addEventListener('click', openPhone);
        host._cleanup = () => buzz.removeEventListener('click', openPhone);
      }
    }
    placeCornerBuzz();
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
    delete document.documentElement.dataset.denizenOnboardingAnchor;
    clearStepUnbinds();
    clearCornerBuzz();
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

  function buzzGuideLine(step) {
    const lines = {
      arrival: 'Hey — I work here too.',
      office: 'First stop: the live floor.',
      phone: 'Hey — I work here too. Use me.',
      claim: 'Pick a buddy on the floor.',
      power: 'Optional juice for the city.',
      ready: "You're cleared. Go walk.",
    };
    return lines[step?.id] || 'Hey — I work here too.';
  }

  function tourAriaLabel() {
    return "Buzz's Denizen office tour";
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
    const phoneCorner = step.id === 'phone';
    const guide = buzzGuideLine(step);
    tooltip.style.visibility = 'hidden';
    tooltip.innerHTML = `
      ${phoneCorner ? '' : buzzMascotHtml(guide)}
      <div class="onb-card">
        <div class="onb-heading">
          <p class="onb-step">Buzz's tour · ${stepIndex + 1} of ${activeSteps.length}${tierBadgeHtml()}</p>
          <p class="onb-title">${escapeHtml(step.title)}</p>
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
          <button type="button" class="onb-next">${isLast ? 'Enter the office' : 'Next stop'}</button>
        </div>
      </div>
    `;

    wireStepButtons(
      tooltip.querySelector('.onb-skip'),
      tooltip.querySelector('.onb-next'),
      tooltip.querySelector('.onb-upgrade'),
    );

    document.documentElement.dataset.denizenOnboardingAnchor = step.anchor || '';
    syncCornerBuzz(step);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (phoneCorner) placeCornerBuzz();
        positionTooltip(tooltip, step.anchor);
        tooltip.style.visibility = '';
      });
    });
  }

  function showTour(opts = {}) {
    const force = !!opts.force;
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
      clearStepUnbinds();
      delete document.documentElement.dataset.denizenOnboarding;
      delete document.documentElement.dataset.denizenOnboardingAnchor;
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
      <div class="onb-corner-host" hidden aria-hidden="true"></div>
    `;
    document.body.appendChild(overlayEl);

    stepIndex = 0;
    renderStep();

    const onResize = () => {
      const tooltip = overlayEl?.querySelector('.onb-tooltip');
      const step = activeSteps[stepIndex];
      if (!tooltip || !step) return;
      if (step.id === 'phone') syncCornerBuzz(step);
      positionTooltip(tooltip, step.anchor);
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
