/**
 * Mobile play — touch devices, portrait and landscape.
 * Sets html classes: denizen-touch | denizen-landscape | denizen-portrait | denizen-tap-move
 * Portrait shows a one-time "rotate for a wider view" toast instead of blocking play.
 * Exposes window.__DenizenTouchState for office-scene.js movement + interact.
 */
(function () {
  'use strict';

  const isTouch = (() => {
    if (typeof window.__DenizenForceTouch === 'boolean') return window.__DenizenForceTouch;
    try {
      return window.matchMedia('(pointer: coarse)').matches
        || navigator.maxTouchPoints > 0
        || ('ontouchstart' in window);
    } catch (_) {
      return false;
    }
  })();

  const state = {
    left: false,
    right: false,
    up: false,
    down: false,
    interact: false,
    // Analog stick, added alongside the four booleans rather than replacing
    // them: office-scene.js ORs the booleans with its key state and must keep
    // working untouched. vx/vy are a direction scaled by `mag` (0..1).
    vx: 0,
    vy: 0,
    mag: 0,
    active: false,
  };

  window.__DenizenTouchState = state;
  window.__DenizenIsTouch = isTouch;
  window.__DenizenMobileTuning = {
    mobileThinkMultiplier: 2.5,
    pauseThinksInCeoMode: true,
  };

  if (!isTouch) return;

  const STYLE_ID = 'denizen-mobile-play-styles';
  const CONTROLS_ID = 'denizen-mobile-controls';
  const TAP_INTERACT_ID = 'denizen-tap-interact';
  const ROTATE_ID = 'denizen-rotate-hint';
  const CEO_CHIP_ID = 'denizen-ceo-mode-chip';
  const CEO_SHELL_ID = 'denizen-ceo-shell';

  window.__DenizenCeoMode = false;

  function removeCeoUiArtifacts() {
    window.__DenizenCeoMode = false;
    document.documentElement.classList.remove('denizen-ceo-mode');
    document.getElementById(CEO_CHIP_ID)?.remove();
    document.getElementById(CEO_SHELL_ID)?.remove();
  }

  function setDir(next) {
    state.left = !!next.left;
    state.right = !!next.right;
    state.up = !!next.up;
    state.down = !!next.down;
  }

  function clearDir() {
    setDir({ left: false, right: false, up: false, down: false });
  }

  function setAnalog(vx, vy, mag) {
    state.vx = vx;
    state.vy = vy;
    state.mag = mag;
    state.active = mag > 0;
    // Mirror into the booleans for consumers that predate the analog stick.
    setDir({
      left: vx < -0.35,
      right: vx > 0.35,
      up: vy < -0.35,
      down: vy > 0.35,
    });
  }

  function clearAnalog() {
    state.vx = 0;
    state.vy = 0;
    state.mag = 0;
    state.active = false;
    clearDir();
  }

  function setInteractPulse(ms = 180) {
    state.interact = true;
    window.setTimeout(() => { state.interact = false; }, ms);
  }

  function isLandscape() {
    try {
      return window.matchMedia('(orientation: landscape)').matches;
    } catch (_) {
      return window.innerWidth > window.innerHeight;
    }
  }

  /** Small phones — not tablets/iPads (min edge ≥ 520px = tablet). */
  function isPhoneLike() {
    return Math.min(window.innerWidth, window.innerHeight) < 520;
  }

  function useTapMove() {
    return isPhoneLike();
  }

  let rotateToastShown = false;
  let rotateToastTimer = null;

  function syncRotateToast(portrait) {
    const hint = document.getElementById(ROTATE_ID);
    if (!hint) return;
    if (portrait && !rotateToastShown && isPhoneLike()) {
      rotateToastShown = true;
      hint.classList.add('show');
      window.clearTimeout(rotateToastTimer);
      rotateToastTimer = window.setTimeout(() => hint.classList.remove('show'), 5000);
    } else if (!portrait) {
      hint.classList.remove('show');
    }
  }

  function syncLayoutClasses() {
    globalThis.DenizenDeviceProfile?.sync?.();
    const root = document.documentElement;
    root.classList.toggle('denizen-tap-move', useTapMove());
    syncRotateToast(!isLandscape());
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --denizen-play-top: var(--safe-top, env(safe-area-inset-top, 0px));
        --denizen-play-gap: 2px;
        --denizen-frame-chrome: 20px; /* HQ frame pad + margin so border fits on screen */
        --denizen-keyboard-offset: 0px;
        --denizen-available-play-h: calc(
          100dvh - var(--denizen-dock-height, 48px) - var(--denizen-play-top)
                   - max(var(--denizen-play-gap), env(safe-area-inset-bottom, 0px))
                   - var(--denizen-play-gap)
                   - var(--denizen-frame-chrome)
        );
        --denizen-phone-portrait-game-height: min(
          var(--denizen-available-play-h),
          calc(100dvw * 9 / 16)
        );
      }

      /* Landscape: notch is on the sides — reclaim vertical space; keep side safe-area only once */
      html.denizen-touch.denizen-landscape {
        --denizen-play-top: max(2px, env(safe-area-inset-top, 0px));
        --denizen-play-gap: 0px;
        --denizen-frame-chrome: 12px;
      }

      html.denizen-touch body {
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        height: 100dvh;
        min-height: 100dvh;
        padding:
          var(--denizen-play-top)
          max(var(--denizen-play-gap), env(safe-area-inset-right, 0px))
          calc(var(--denizen-dock-height, 48px) + max(var(--denizen-play-gap), env(safe-area-inset-bottom, 0px)))
          max(var(--denizen-play-gap), env(safe-area-inset-left, 0px));
      }

      html.denizen-touch.denizen-landscape body {
        /* Don't double-pad: size math below already subtracts safe-area + dock */
        padding:
          var(--denizen-play-top)
          max(6px, env(safe-area-inset-right, 0px))
          calc(var(--denizen-dock-height, 40px) + env(safe-area-inset-bottom, 0px))
          max(6px, env(safe-area-inset-left, 0px));
      }

      html.denizen-touch #game-container {
        --denizen-play-w: calc(
          100dvw - max(var(--denizen-play-gap), env(safe-area-inset-left, 0px))
                  - max(var(--denizen-play-gap), env(safe-area-inset-right, 0px))
                  - var(--denizen-frame-chrome)
        );
        --denizen-play-h: var(--denizen-available-play-h);
        /* No 16:9 cap. The canvas uses Phaser.Scale.RESIZE on touch, so it
           follows this box exactly — a taller box shows MORE of the world
           instead of stretching it. Capping to 16:9 here was what squeezed a
           375x812 phone down to a 355x200 strip. */
        width: var(--denizen-play-w);
        height: var(--denizen-play-h);
        max-width: none;
        max-height: none;
        border-radius: 4px;
        border-width: 0;
        box-shadow: none;
      }

      html.denizen-touch.denizen-landscape #game-container {
        border-radius: 2px;
        /* Match the padded content box — 100dvw alone overshoots and looks off-center */
        --denizen-play-w: calc(
          100dvw
          - max(6px, env(safe-area-inset-left, 0px))
          - max(6px, env(safe-area-inset-right, 0px))
          - var(--denizen-frame-chrome)
          - 4px
        );
        --denizen-play-h: calc(
          100dvh
          - var(--denizen-play-top)
          - var(--denizen-dock-height, 40px)
          - env(safe-area-inset-bottom, 0px)
          - var(--denizen-frame-chrome)
          - 2px
        );
        width: var(--denizen-play-w);
        height: var(--denizen-play-h);
        margin: 0 auto;
        flex: 0 0 auto;
      }

      /* Portrait phones: fill the screen. The old rule reserved the space below
         for "chat / joystick letterbox", but the stick is invisible now and
         chat overlays, so that space was simply dead — 602px of it on a
         375x812 phone. */
      html.denizen-touch.denizen-phone.denizen-portrait #game-container {
        width: var(--denizen-play-w);
        height: var(--denizen-available-play-h);
        flex: 0 0 auto;
        margin: 0 auto;
      }

      /* Portrait hint — non-blocking toast, shown once per session */
      #${ROTATE_ID} {
        position: fixed;
        top: calc(var(--denizen-play-top) + max(10px, env(safe-area-inset-top, 0px)));
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        z-index: 100500;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(2, 6, 23, 0.9);
        border: 1px solid rgba(96, 165, 250, 0.45);
        color: #dbeafe;
        font: 12px/1.3 system-ui, sans-serif;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      #${ROTATE_ID}.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      #${ROTATE_ID} .icon { font-size: 16px; }

      /* Portrait: pin the office view to the top — chat and panels use the space below */
      html.denizen-touch.denizen-portrait body {
        align-items: flex-start;
      }

      #${CONTROLS_ID} {
        position: fixed;
        left: 0;
        right: 0;
        bottom: calc(var(--denizen-dock-height, 52px) + env(safe-area-inset-bottom, 0px) + 8px);
        height: 130px;
        z-index: 99990;
        pointer-events: none;
        display: none;
      }
      /* Tablets only — the container still carries the interact button. */
      html.denizen-touch:not(.denizen-tap-move) #${CONTROLS_ID} {
        display: block;
      }
      /* The fixed stick is retired: the invisible joystick works on every touch
         tier, so this one only duplicated it and sat on top of the playfield.
         Kept in the DOM (not deleted) so it can be restored by dropping this
         rule if a visible stick is ever wanted back. */
      #${CONTROLS_ID} .mc-joy-base {
        display: none !important;
      }
      html.denizen-touch.denizen-tap-move #${CONTROLS_ID} {
        display: none !important;
      }
      html.denizen-touch.denizen-chat-open #${CONTROLS_ID},
      html.denizen-touch.denizen-llm-tel-open #${CONTROLS_ID} {
        display: none !important;
      }

      /* Compact interact — top corner, phones only (replaces large E button) */
      #${TAP_INTERACT_ID} {
        display: none;
        position: fixed;
        /* Thumb zone, not the top corner: at the top it sat under the XP pill,
           and it is the one control a player presses constantly. Raised clear
           of the dock and the bottom-right mascot. */
        bottom: calc(var(--denizen-dock-height, 48px) + env(safe-area-inset-bottom, 0px) + 116px);
        right: max(10px, env(safe-area-inset-right, 0px));
        z-index: 99995;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: rgba(30, 58, 138, 0.88);
        border: 2px solid rgba(96, 165, 250, 0.7);
        color: #dbeafe;
        font: 700 17px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        padding: 0;
      }
      /* Show it on EVERY touch tier. This rule used to hide the button on
         .denizen-tap-move — which is exactly the phone tier it was built for —
         while .mc-action below is hidden on all touch. Between the two, no
         touch device had any interact control at all: the game would prompt
         "[F] Sit" on a phone with no F key and no button to press. */
      html.denizen-touch #${TAP_INTERACT_ID} {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      html.denizen-touch.denizen-chat-open #${TAP_INTERACT_ID},
      html.denizen-touch.denizen-llm-tel-open #${TAP_INTERACT_ID} {
        display: none !important;
      }
      #${TAP_INTERACT_ID}:active {
        transform: scale(0.94);
        background: rgba(29, 78, 216, 0.95);
      }

      /* Hide floating chips until bottom-dock adopts them (prevents overlap flash) */
      html.denizen-touch body:not(.denizen-dock-ready) #player-chat-fab,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-mic-button,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-onboarding-replay-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-superuser-replay-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-capabilities-guide-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-diag-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-mesh-jobs-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-security-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-llm-tel-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-audio-mode-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-presence-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-browser-mirror-chip,
      html.denizen-touch body:not(.denizen-dock-ready) #denizen-proposals-chip {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #${CONTROLS_ID} .mc-joy-base {
        position: absolute;
        left: max(14px, env(safe-area-inset-left, 0px));
        bottom: 8px;
        width: 108px;
        height: 108px;
        border-radius: 50%;
        background: rgba(15, 23, 42, 0.55);
        border: 2px solid rgba(148, 163, 184, 0.35);
        pointer-events: auto;
        touch-action: none;
      }
      #${CONTROLS_ID} .mc-joy-stick {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 46px;
        height: 46px;
        margin: -23px 0 0 -23px;
        border-radius: 50%;
        background: rgba(74, 222, 128, 0.85);
        border: 2px solid rgba(34, 197, 94, 0.9);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      }
      html.denizen-touch #${CONTROLS_ID} .mc-action {
        display: none !important;
      }
      #${CONTROLS_ID} .mc-action {
        position: absolute;
        right: max(14px, env(safe-area-inset-right, 0px));
        bottom: 18px;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: rgba(30, 58, 138, 0.82);
        border: 2px solid rgba(96, 165, 250, 0.75);
        color: #dbeafe;
        font: 700 15px/1 system-ui, sans-serif;
        pointer-events: auto;
        touch-action: manipulation;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      }
      #${CONTROLS_ID} .mc-action:active {
        background: rgba(29, 78, 216, 0.95);
        transform: scale(0.96);
      }

      html.denizen-touch:not(.denizen-phone-mode) #player-chat-panel {
        bottom: calc(
          var(--denizen-dock-height, 52px) + 10px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)
        ) !important;
        max-height: min(38dvh, 280px) !important;
      }
      html.denizen-touch.denizen-landscape:not(.denizen-phone-mode) #player-chat-panel {
        max-height: min(52dvh, 300px) !important;
      }

      html.denizen-touch.denizen-tablet #denizen-diag-panel,
      html.denizen-touch.denizen-tablet #denizen-llm-tel-panel,
      html.denizen-touch.denizen-tablet #denizen-proposals-panel,
      html.denizen-touch.denizen-tablet #denizen-browser-mirror-panel,
      html.denizen-touch.denizen-tablet #denizen-npc-team-panel,
      html.denizen-touch.denizen-tablet #denizen-mesh-jobs-panel,
      html.denizen-touch.denizen-tablet #denizen-content-pipeline-panel {
        z-index: 100200 !important;
        width: calc(100dvw - 16px) !important;
        max-width: calc(100dvw - 16px) !important;
        left: max(8px, env(safe-area-inset-left, 0px)) !important;
        right: max(8px, env(safe-area-inset-right, 0px)) !important;
        max-height: min(72dvh, 560px) !important;
        pointer-events: auto !important;
      }
      html.denizen-touch:not(.denizen-phone-mode) #player-chat-panel {
        z-index: 100200 !important;
        width: calc(100dvw - 16px) !important;
        max-width: calc(100dvw - 16px) !important;
        left: max(8px, env(safe-area-inset-left, 0px)) !important;
        right: max(8px, env(safe-area-inset-right, 0px)) !important;
        max-height: min(72dvh, 560px) !important;
        pointer-events: auto !important;
      }
      html.denizen-touch.denizen-phone #denizen-diag-panel.open,
      html.denizen-touch.denizen-phone #denizen-llm-tel-panel.open,
      html.denizen-touch.denizen-phone #denizen-proposals-panel.open,
      html.denizen-touch.denizen-phone #denizen-browser-mirror-panel.open,
      html.denizen-touch.denizen-phone #denizen-npc-team-panel.open,
      html.denizen-touch.denizen-phone #denizen-mesh-jobs-panel.open,
      html.denizen-touch.denizen-phone #denizen-content-pipeline-panel.open {
        pointer-events: auto !important;
      }
      html.denizen-touch.denizen-tablet #denizen-diag-panel {
        max-width: calc(100dvw - 16px) !important;
        white-space: pre-wrap;
        overflow-y: auto;
      }

      /* CEO mode chip — floats above dock until bottom-dock adopts it */
      html.denizen-touch body:not(.denizen-dock-ready) #${CEO_CHIP_ID} {
        position: fixed;
        bottom: calc(var(--denizen-dock-height, 52px) + env(safe-area-inset-bottom, 0px) + 8px);
        right: max(10px, env(safe-area-inset-right, 0px));
        z-index: 100002;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid #475569;
        border-radius: 999px;
        padding: 6px 12px;
        font: 11px/1.2 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${CEO_CHIP_ID}.active {
        background: #1e3a5f;
        border-color: #60a5fa;
        color: #dbeafe;
      }

      /* CEO mode — hide game/play UI, show management shell */
      html.denizen-ceo-mode #game-container,
      html.denizen-ceo-mode #${CONTROLS_ID},
      html.denizen-ceo-mode #${ROTATE_ID} {
        display: none !important;
      }

      #${CEO_SHELL_ID} {
        display: none;
        position: fixed;
        inset:
          var(--denizen-play-top)
          max(10px, env(safe-area-inset-right, 0px))
          calc(var(--denizen-dock-height, 52px) + env(safe-area-inset-bottom, 0px) + 10px)
          max(10px, env(safe-area-inset-left, 0px));
        z-index: 99980;
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        gap: 14px;
        padding: 20px;
        pointer-events: auto;
      }
      html.denizen-ceo-mode #${CEO_SHELL_ID} {
        display: flex;
      }
      #${CEO_SHELL_ID} .ceo-title {
        text-align: center;
        color: #94a3b8;
        font: 600 13px/1.3 system-ui, sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      #${CEO_SHELL_ID} .ceo-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 320px;
        width: 100%;
        margin: 0 auto;
      }
      #${CEO_SHELL_ID} .ceo-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 16px 18px;
        border-radius: 12px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.92);
        color: #e2e8f0;
        font: 600 16px/1.2 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }
      #${CEO_SHELL_ID} .ceo-btn:active {
        background: rgba(30, 58, 138, 0.85);
        border-color: #60a5fa;
        transform: scale(0.98);
      }
      #${CEO_SHELL_ID} .ceo-btn .icon { font-size: 22px; line-height: 1; }

      /* Reliable taps on all Denizen UI buttons (dock, panels, chat) */
      html.denizen-touch #denizen-bottom-dock button,
      html.denizen-touch #denizen-speak-fab,
      html.denizen-touch #player-chat-panel button,
      html.denizen-touch #denizen-proposals-panel button,
      html.denizen-touch #denizen-browser-mirror-panel button,
      html.denizen-touch #denizen-llm-tel-panel button,
      html.denizen-touch #denizen-diag-panel button,
      html.denizen-touch #denizen-npc-team-panel button,
      html.denizen-touch #denizen-npc-team-panel .nt-pick-item,
      html.denizen-touch #denizen-mesh-jobs-panel button,
      html.denizen-touch #denizen-content-pipeline-panel button,
      html.denizen-touch #denizen-node-ui-chip button,
      html.denizen-touch #denizen-account-panel button,
      html.denizen-touch #denizen-mobile-menu-btn,
      html.denizen-touch #denizen-mobile-drawer button,
      html.denizen-touch #denizen-mic-status,
      html.denizen-touch #${CEO_SHELL_ID} button,
      html.denizen-touch #${CEO_CHIP_ID} {
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.25);
        min-width: 44px;
        min-height: 44px;
      }
      html.denizen-touch.denizen-phone #denizen-bottom-dock button,
      html.denizen-touch.denizen-phone #denizen-mobile-menu-btn {
        min-width: 34px;
        min-height: 34px;
      }

      /* The invisible joystick is a drag on the canvas. Without this the browser
         claims that drag for scroll/rubber-band and fires double-tap zoom, so
         the stick would stutter or die mid-gesture. */
      html.denizen-touch #game-container,
      html.denizen-touch #game-container canvas {
        touch-action: none;
      }
    `;
    document.head.appendChild(style);
  }

  function isUiTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(
      target.closest(`#${CONTROLS_ID}`) ||
      target.closest('#player-chat-panel') ||
      target.closest('#denizen-visitor-name-modal') ||
      target.closest('#denizen-demo-account-modal') ||
      target.closest('#denizen-bottom-dock') ||
      target.closest('#denizen-diag-panel') ||
      target.closest('#denizen-llm-tel-panel') ||
      target.closest('#denizen-proposals-panel') ||
      target.closest('#denizen-browser-mirror-panel') ||
      target.closest('#denizen-mic-button') ||
      target.closest('#denizen-speak-fab') ||
      target.closest('#openclaw-ui-panel') ||
      target.closest('#editor-ui') ||
      target.closest(`#${ROTATE_ID}`) ||
      target.closest(`#${CEO_SHELL_ID}`) ||
      target.closest(`#${CEO_CHIP_ID}`) ||
      target.closest('#denizen-mobile-drawer') ||
      target.closest('#denizen-mobile-drawer-backdrop') ||
      target.closest('#denizen-mobile-menu-btn') ||
      target.closest('input, textarea, button, select, [contenteditable="true"]')
    );
  }

  function setCeoMode() {
    removeCeoUiArtifacts();
    syncLayoutClasses();
  }

  function buildRotateHint() {
    if (document.getElementById(ROTATE_ID)) return;
    const el = document.createElement('div');
    el.id = ROTATE_ID;
    el.innerHTML = `
      <span class="icon">📱↻</span>
      <span>Rotate for a wider view</span>`;
    document.body.appendChild(el);
  }

  function buildVirtualControls() {
    if (document.getElementById(CONTROLS_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = CONTROLS_ID;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = `
      <div class="mc-joy-base" data-joy>
        <div class="mc-joy-stick" data-stick></div>
      </div>
      <button type="button" class="mc-action" data-action aria-label="Interact">E</button>`;
    document.body.appendChild(wrap);

    const base = wrap.querySelector('[data-joy]');
    const stick = wrap.querySelector('[data-stick]');
    const action = wrap.querySelector('[data-action]');
    const maxRadius = 34;
    let joyId = null;

    const applyJoy = (dx, dy) => {
      const mag = Math.hypot(dx, dy);
      const clamped = Math.min(mag, maxRadius);
      const angle = Math.atan2(dy, dx);
      const cx = Math.cos(angle) * clamped;
      const cy = Math.sin(angle) * clamped;
      stick.style.transform = `translate(${cx}px, ${cy}px)`;
      if (clamped < 8) {
        clearDir();
        return;
      }
      const nx = cx / maxRadius;
      const ny = cy / maxRadius;
      setDir({
        left: nx < -0.28,
        right: nx > 0.28,
        up: ny < -0.28,
        down: ny > 0.28,
      });
    };

    const joyRect = () => base.getBoundingClientRect();

    base.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      e.preventDefault();
      joyId = t.identifier;
      const r = joyRect();
      applyJoy(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }, { passive: false });

    base.addEventListener('touchmove', (e) => {
      if (joyId == null) return;
      const t = Array.from(e.touches).find((x) => x.identifier === joyId);
      if (!t) return;
      e.preventDefault();
      const r = joyRect();
      applyJoy(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }, { passive: false });

    const endJoy = (e) => {
      if (joyId == null) return;
      const ended = Array.from(e.changedTouches || []).some((x) => x.identifier === joyId);
      if (!ended) return;
      joyId = null;
      stick.style.transform = '';
      clearDir();
    };
    base.addEventListener('touchend', endJoy);
    base.addEventListener('touchcancel', endJoy);

    const pulseAction = () => {
      window.DenizenHaptics?.impact?.();
      setInteractPulse(200);
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) {
      bind(action, pulseAction);
    } else {
      action.addEventListener('click', (e) => {
        e.preventDefault();
        pulseAction();
      });
    }
    action.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  /**
   * Invisible joystick — press anywhere on the playfield and drag to walk.
   *
   * The visible stick above sits in a fixed corner and is tablet-only, so phones
   * had no stick at all, and the city (src/full-world.js) never read touch input
   * in the first place. This one has no DOM and no fixed origin: wherever you
   * press becomes the centre and the drag vector is analog, so a small pull
   * walks slowly and a full pull runs.
   *
   * A press that never travels past DRAG_PX stays a TAP, so tap-to-move and the
   * interact button behave exactly as before.
   */
  const DRAG_PX = 10;

  /** A 320px phone cannot spare the same throw as a 1024px tablet. */
  function stickRadius() {
    const shortest = Math.min(window.innerWidth, window.innerHeight);
    if (shortest < 380) return 38;
    if (shortest < 520) return 46;
    return 54;
  }

  function installInvisibleJoystick() {
    let id = null;
    let ox = 0;
    let oy = 0;
    let dragging = false;

    const release = () => {
      id = null;
      dragging = false;
      clearAnalog();
    };

    document.addEventListener('pointerdown', (e) => {
      if (id !== null) return;                     // one stick at a time
      if (e.pointerType === 'mouse') return;       // desktop stays keyboard/click
      if (window.__DenizenGameInputBlocked) return;
      if (isUiTarget(e.target)) return;            // dock, chat, panels, buttons
      id = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      dragging = false;
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      const dist = Math.hypot(dx, dy);
      if (!dragging) {
        if (dist < DRAG_PX) return;                // still could be a tap
        dragging = true;
      }
      const r = stickRadius();
      // Subtract the tap threshold so the stick eases in from zero instead of
      // snapping to a jump the instant it engages.
      const mag = Math.max(0, Math.min(1, (Math.min(dist, r) - DRAG_PX) / (r - DRAG_PX)));
      setAnalog((dx / dist) * mag, (dy / dist) * mag, mag);
    }, { passive: true });

    const end = (e) => {
      if (e.pointerId !== id) return;
      release();
    };
    document.addEventListener('pointerup', end, { passive: true });
    document.addEventListener('pointercancel', end, { passive: true });

    // Never leave the player walking forever because a gesture was interrupted.
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) release();
    });
  }

  function buildTapMoveInteract() {
    // Built on every touch tier, not just phones: tablets lost their only
    // interact control when the large in-container "E" button was hidden.
    if (document.getElementById(TAP_INTERACT_ID)) return;

    const btn = document.createElement('button');
    btn.id = TAP_INTERACT_ID;
    btn.type = 'button';
    btn.title = 'Interact with nearby desk, chair, or object';
    btn.setAttribute('aria-label', 'Interact');
    btn.textContent = 'E';
    document.body.appendChild(btn);

    const pulse = () => {
      window.DenizenHaptics?.impact?.();
      setInteractPulse(200);
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(btn, pulse);
    else btn.addEventListener('click', (e) => { e.preventDefault(); pulse(); });
  }

  function installKeyboardViewportSync() {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--denizen-keyboard-offset', `${Math.round(offset)}px`);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    sync();
  }

  function boot() {
    injectStyles();
    buildRotateHint();
    buildVirtualControls();
    installInvisibleJoystick();
    buildTapMoveInteract();
    removeCeoUiArtifacts();
    installKeyboardViewportSync();
    syncLayoutClasses();

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        syncLayoutClasses();
        try { window.game?.scale?.refresh?.(); } catch (_) {}
      }, 120);
      setTimeout(() => {
        try { window.game?.scale?.refresh?.(); } catch (_) {}
      }, 400);
    });
    window.addEventListener('resize', () => {
      syncLayoutClasses();
      try { window.game?.scale?.refresh?.(); } catch (_) {}
    });

    console.log('[MobilePlay] touch controls ready — portrait and landscape supported');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenMobilePlay = {
    syncLayout: syncLayoutClasses,
    isTouch: () => true,
    isPhoneLike,
    useTapMove,
    requiresLandscape: () => false,
    isLandscape,
    /** Analog stick reading: {vx, vy, mag, active}. Consumed by full-world.js. */
    stick: () => ({ vx: state.vx, vy: state.vy, mag: state.mag, active: state.active }),
    setCeoMode,
    isCeoMode: () => !!globalThis.DenizenVisitorSession?.isCeoMode?.(),
  };
})();
