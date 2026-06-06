/**
 * Mobile play — landscape-first touch controls, layout sync, on-screen joystick.
 * Sets html classes: denizen-touch | denizen-landscape | denizen-portrait
 * Exposes window.__DenizenTouchState for office-scene.js movement + interact.
 */
(function () {
  'use strict';

  const isTouch = (() => {
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
  const ROTATE_ID = 'denizen-rotate-hint';
  const CEO_CHIP_ID = 'denizen-ceo-mode-chip';
  const CEO_SHELL_ID = 'denizen-ceo-shell';

  let ceoMode = false;
  window.__DenizenCeoMode = false;

  function setDir(next) {
    state.left = !!next.left;
    state.right = !!next.right;
    state.up = !!next.up;
    state.down = !!next.down;
  }

  function clearDir() {
    setDir({ left: false, right: false, up: false, down: false });
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

  function isPhoneLike() {
    return Math.min(window.innerWidth, window.innerHeight) < 520;
  }

  function syncLayoutClasses() {
    const landscape = isLandscape();
    const root = document.documentElement;
    root.classList.add('denizen-touch');
    root.classList.toggle('denizen-landscape', landscape);
    root.classList.toggle('denizen-portrait', !landscape);
    root.classList.toggle('denizen-phone', isPhoneLike());

    const hint = document.getElementById(ROTATE_ID);
    if (hint) {
      const showHint = isPhoneLike() && !landscape;
      hint.classList.toggle('show', showHint);
      document.body.classList.toggle('denizen-rotate-blocking', showHint);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --denizen-play-top: var(--safe-top, env(safe-area-inset-top, 0px));
        --denizen-keyboard-offset: 0px;
      }

      html.denizen-touch body {
        align-items: center;
        justify-content: center;
        padding:
          var(--denizen-play-top)
          var(--safe-right, env(safe-area-inset-right, 0px))
          calc(var(--denizen-dock-height, 52px) + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))
          var(--safe-left, env(safe-area-inset-left, 0px));
      }

      html.denizen-touch #game-container {
        width: min(
          calc(100dvw - var(--safe-left, 0px) - var(--safe-right, 0px) - 8px),
          calc((100dvh - var(--denizen-dock-height, 52px) - var(--denizen-play-top) - var(--safe-bottom, env(safe-area-inset-bottom, 0px)) - 6px) * 16 / 9)
        );
        height: min(
          calc(100dvh - var(--denizen-dock-height, 52px) - var(--denizen-play-top) - var(--safe-bottom, env(safe-area-inset-bottom, 0px)) - 6px),
          calc((100dvw - var(--safe-left, 0px) - var(--safe-right, 0px) - 8px) * 9 / 16)
        );
        max-width: none;
        max-height: none;
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
      }

      html.denizen-touch.denizen-landscape.denizen-phone #game-container {
        width: min(
          calc(100dvw - var(--safe-left, 0px) - var(--safe-right, 0px) - 12px),
          calc((100dvh - var(--denizen-dock-height, 48px) - var(--denizen-play-top) - var(--safe-bottom, env(safe-area-inset-bottom, 0px)) - 4px) * 16 / 9)
        );
        height: min(
          calc(100dvh - var(--denizen-dock-height, 48px) - var(--denizen-play-top) - var(--safe-bottom, env(safe-area-inset-bottom, 0px)) - 4px),
          calc((100dvw - var(--safe-left, 0px) - var(--safe-right, 0px) - 12px) * 9 / 16)
        );
      }

      html.denizen-touch.denizen-portrait.denizen-phone #game-container {
        width: min(calc(100dvw - 10px), calc((100dvh - var(--denizen-dock-height, 52px) - 120px) * 16 / 9));
        height: min(calc(100dvh - var(--denizen-dock-height, 52px) - 120px), calc((100dvw - 10px) * 9 / 16));
      }

      #${ROTATE_ID} {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 100050;
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 24px;
        text-align: center;
        font: 14px/1.5 system-ui, sans-serif;
        pointer-events: none;
      }
      #${ROTATE_ID}.show { display: flex; }
      #${ROTATE_ID} .icon,
      #${ROTATE_ID} div,
      #${ROTATE_ID} button {
        pointer-events: auto;
      }
      #${ROTATE_ID} .icon { font-size: 42px; }
      #${ROTATE_ID} button {
        margin-top: 8px;
        background: #1e293b;
        color: #cbd5e1;
        border: 1px solid #475569;
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 13px;
        cursor: pointer;
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
      html.denizen-touch.denizen-landscape #${CONTROLS_ID},
      html.denizen-touch.denizen-phone #${CONTROLS_ID} {
        display: block;
      }
      html.denizen-touch.denizen-portrait.denizen-phone #${CONTROLS_ID} {
        display: none;
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

      html.denizen-touch #player-chat-panel {
        bottom: calc(
          var(--denizen-dock-height, 52px) + 10px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)
        ) !important;
        max-height: min(38dvh, 280px) !important;
      }
      html.denizen-touch.denizen-landscape #player-chat-panel {
        max-height: min(52dvh, 300px) !important;
      }

      html.denizen-touch #denizen-diag-panel,
      html.denizen-touch #denizen-llm-tel-panel,
      html.denizen-touch #denizen-proposals-panel,
      html.denizen-touch #denizen-browser-mirror-panel,
      html.denizen-touch #player-chat-panel {
        z-index: 100200 !important;
        width: calc(100dvw - 16px) !important;
        max-width: calc(100dvw - 16px) !important;
        left: max(8px, env(safe-area-inset-left, 0px)) !important;
        right: max(8px, env(safe-area-inset-right, 0px)) !important;
        max-height: min(72dvh, 560px) !important;
        pointer-events: auto !important;
      }
      html.denizen-touch #denizen-diag-panel {
        max-width: calc(100dvw - 16px) !important;
        white-space: pre-wrap;
        overflow-y: auto;
      }
      html.denizen-touch.denizen-landscape #denizen-llm-tel-panel .body {
        max-height: calc(52dvh - 100px) !important;
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
      html.denizen-touch #player-chat-panel button,
      html.denizen-touch #denizen-proposals-panel button,
      html.denizen-touch #denizen-browser-mirror-panel button,
      html.denizen-touch #denizen-llm-tel-panel button,
      html.denizen-touch #denizen-diag-panel button,
      html.denizen-touch #denizen-mic-status,
      html.denizen-touch #${CEO_SHELL_ID} button,
      html.denizen-touch #${CEO_CHIP_ID} {
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(96, 165, 250, 0.25);
        min-width: 44px;
        min-height: 44px;
      }
    `;
    document.head.appendChild(style);
  }

  function isUiTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(
      target.closest(`#${CONTROLS_ID}`) ||
      target.closest('#player-chat-panel') ||
      target.closest('#denizen-bottom-dock') ||
      target.closest('#denizen-diag-panel') ||
      target.closest('#denizen-llm-tel-panel') ||
      target.closest('#denizen-proposals-panel') ||
      target.closest('#denizen-browser-mirror-panel') ||
      target.closest('#denizen-mic-button') ||
      target.closest('#openclaw-ui-panel') ||
      target.closest('#editor-ui') ||
      target.closest(`#${ROTATE_ID}`) ||
      target.closest(`#${CEO_SHELL_ID}`) ||
      target.closest(`#${CEO_CHIP_ID}`) ||
      target.closest('input, textarea, button, select, [contenteditable="true"]')
    );
  }

  function canUseCeoModeChip() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isDemo?.()) return false;
    return true;
  }

  function setCeoMode(on) {
    if (on && !canUseCeoModeChip()) return;
    ceoMode = !!on;
    window.__DenizenCeoMode = ceoMode;
    document.documentElement.classList.toggle('denizen-ceo-mode', ceoMode);
    const chip = document.getElementById(CEO_CHIP_ID);
    if (chip) {
      chip.classList.toggle('active', ceoMode);
      chip.setAttribute('aria-pressed', ceoMode ? 'true' : 'false');
      chip.title = ceoMode ? 'Exit CEO mode (walk office)' : 'CEO mode (manage without walking)';
    }
    if (ceoMode) {
      document.body.classList.remove('denizen-rotate-blocking');
      const hint = document.getElementById(ROTATE_ID);
      if (hint) hint.classList.remove('show');
    } else {
      syncLayoutClasses();
    }
  }

  function toggleCeoMode() {
    setCeoMode(!ceoMode);
    window.DenizenHaptics?.impact?.();
  }

  function buildCeoModeChip() {
    if (!canUseCeoModeChip()) return;
    if (document.getElementById(CEO_CHIP_ID)) return;
    const chip = document.createElement('button');
    chip.id = CEO_CHIP_ID;
    chip.type = 'button';
    chip.className = 'denizen-dock-chip';
    chip.setAttribute('aria-pressed', 'false');
    chip.title = 'CEO mode (manage without walking)';
    chip.textContent = '👔 CEO';
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) {
      bind(chip, () => toggleCeoMode());
    } else {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        toggleCeoMode();
      });
    }
    document.body.appendChild(chip);
  }

  function buildCeoShell() {
    if (document.getElementById(CEO_SHELL_ID)) return;

    const shell = document.createElement('div');
    shell.id = CEO_SHELL_ID;
    shell.setAttribute('aria-label', 'CEO quick actions');
    shell.innerHTML = `
      <div class="ceo-title">CEO mode</div>
      <div class="ceo-actions">
        <button type="button" class="ceo-btn" data-ceo-chat>
          <span class="icon">💬</span><span>Chat</span>
        </button>
        <button type="button" class="ceo-btn" data-ceo-browser>
          <span class="icon">🌐</span><span>Browser mirror</span>
        </button>
        <button type="button" class="ceo-btn" data-ceo-proposals>
          <span class="icon">📋</span><span>Proposals</span>
        </button>
      </div>`;
    document.body.appendChild(shell);

    const bind = window.DenizenTouchBind?.bindPress;
    const wireCeoBtn = (sel, fn) => {
      const el = shell.querySelector(sel);
      if (!el) return;
      if (bind) bind(el, fn);
      else el.addEventListener('click', fn);
    };
    wireCeoBtn('[data-ceo-chat]', () => {
      window.DenizenHaptics?.tap?.();
      const pc = window.__DenizenPlayerChat;
      if (pc && typeof pc.toggle === 'function') pc.toggle();
    });
    wireCeoBtn('[data-ceo-browser]', () => {
      window.DenizenHaptics?.tap?.();
      if (typeof window.DenizenBrowserMirror?.show === 'function') {
        window.DenizenBrowserMirror.show();
      } else {
        window.DenizenBrowserMirror?.toggle?.();
      }
    });
    wireCeoBtn('[data-ceo-proposals]', () => {
      window.DenizenHaptics?.tap?.();
      if (typeof window.DenizenProposals?.show === 'function') {
        window.DenizenProposals.show();
      } else {
        window.DenizenProposals?.toggle?.();
      }
    });
  }

  function buildRotateHint() {
    if (document.getElementById(ROTATE_ID)) return;
    const el = document.createElement('div');
    el.id = ROTATE_ID;
    el.innerHTML = `
      <div class="icon">📱↻</div>
      <div><strong>Turn your phone sideways</strong> to walk the office.<br>Use the joystick + Action button to move and interact.</div>
      <button type="button" data-dismiss>Play in portrait anyway</button>`;
    el.querySelector('[data-dismiss]')?.addEventListener('click', () => {
      el.classList.remove('show');
      document.body.classList.remove('denizen-rotate-blocking');
      sessionStorage.setItem('denizen-portrait-ok', '1');
    });
    if (sessionStorage.getItem('denizen-portrait-ok') === '1') {
      document.body.classList.remove('denizen-rotate-blocking');
    }
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

  /** Canvas drag fallback when virtual controls hidden (portrait). Scoped to game only. */
  function installCanvasSwipeFallback() {
    const gameEl = document.getElementById('game-container');
    if (!gameEl) return;

    let moveId = null;
    let startX = 0;
    let startY = 0;

    const moveZoneThreshold = () => Math.round(gameEl.getBoundingClientRect().width * 0.68);

    const onTouchStart = (e) => {
      if (isLandscape() && isPhoneLike()) return;
      if (!e.touches || e.touches.length === 0) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      if (t.clientX > moveZoneThreshold()) {
        setInteractPulse(160);
        e.preventDefault();
        return;
      }

      moveId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      clearDir();
      e.preventDefault();
    };

    const onTouchMove = (e) => {
      if (moveId == null) return;
      const t = Array.from(e.touches || []).find((x) => x.identifier === moveId);
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const mag = Math.hypot(dx, dy) || 1;
      if (mag < 10) { clearDir(); return; }
      const nx = dx / mag;
      const ny = dy / mag;
      setDir({
        left: nx < -0.32,
        right: nx > 0.32,
        up: ny < -0.32,
        down: ny > 0.32,
      });
      e.preventDefault();
    };

    const endTouch = (e) => {
      if (moveId == null) return;
      if (Array.from(e.changedTouches || []).some((x) => x.identifier === moveId)) {
        moveId = null;
        clearDir();
      }
    };

    gameEl.addEventListener('touchstart', onTouchStart, { passive: false });
    gameEl.addEventListener('touchmove', onTouchMove, { passive: false });
    gameEl.addEventListener('touchend', endTouch, { passive: true });
    gameEl.addEventListener('touchcancel', endTouch, { passive: true });
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
    buildCeoModeChip();
    buildCeoShell();
    installCanvasSwipeFallback();
    installKeyboardViewportSync();
    syncLayoutClasses();

    window.addEventListener('orientationchange', () => setTimeout(syncLayoutClasses, 100));
    window.addEventListener('resize', syncLayoutClasses);

    if (sessionStorage.getItem('denizen-portrait-ok') === '1') {
      const hint = document.getElementById(ROTATE_ID);
      if (hint) hint.classList.remove('show');
    }

    console.log('[MobilePlay] touch controls ready — rotate landscape to play');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenMobilePlay = {
    syncLayout: syncLayoutClasses,
    isTouch: () => true,
    toggleCeoMode,
    setCeoMode,
    isCeoMode: () => ceoMode,
  };
})();
