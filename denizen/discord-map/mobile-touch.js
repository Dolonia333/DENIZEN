/**
 * Discord map — mobile touch controls (D-pad + enter/exit).
 * Exposes window.__DiscordMapTouch for game.js.
 */
(() => {
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

  const touch = {
    left: false,
    right: false,
    enter: false,
    exit: false,
    consumeEnter() {
      const v = this.enter;
      this.enter = false;
      return v;
    },
    consumeExit() {
      const v = this.exit;
      this.exit = false;
      return v;
    },
  };
  window.__DiscordMapTouch = touch;
  window.__DiscordMapIsTouch = isTouch;

  if (!isTouch) return;

  const ROOT_ID = 'dm-mobile-controls';
  const STYLE_ID = 'dm-mobile-styles';

  function isLandscape() {
    try {
      return window.matchMedia('(orientation: landscape)').matches;
    } catch (_) {
      return window.innerWidth > window.innerHeight;
    }
  }

  function syncClasses() {
    const root = document.documentElement;
    root.classList.add('dm-touch');
    root.classList.toggle('dm-portrait', !isLandscape());
    root.classList.toggle('dm-landscape', isLandscape());
    root.classList.toggle('dm-phone', Math.min(window.innerWidth, window.innerHeight) < 520);
  }

  function bindHold(btn, key) {
    const on = () => { touch[key] = true; };
    const off = () => { touch[key] = false; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      on();
    });
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  }

  function bindPulse(btn, key) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      touch[key] = true;
      btn.classList.add('pressed');
    });
    btn.addEventListener('pointerup', () => btn.classList.remove('pressed'));
    btn.addEventListener('pointercancel', () => btn.classList.remove('pressed'));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.dm-touch body { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      html.dm-touch #game-host { touch-action: none; }
      html.dm-touch #enter-hint { display: none; }
      #${ROOT_ID} {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 50;
        pointer-events: none;
        padding:
          0
          max(10px, env(safe-area-inset-right, 0px))
          max(10px, env(safe-area-inset-bottom, 0px))
          max(10px, env(safe-area-inset-left, 0px));
      }
      #${ROOT_ID} .dm-pad {
        pointer-events: auto;
        display: grid;
        grid-template-columns: 56px 56px 56px;
        grid-template-rows: 52px 52px;
        gap: 6px;
        width: fit-content;
      }
      #${ROOT_ID} .dm-btn {
        appearance: none;
        border: 2px solid rgba(255,255,255,0.22);
        background: rgba(16, 24, 44, 0.72);
        color: #e8eef7;
        border-radius: 14px;
        font: 700 20px/1 system-ui, sans-serif;
        min-width: 52px;
        min-height: 48px;
        touch-action: manipulation;
        user-select: none;
        backdrop-filter: blur(6px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.28);
      }
      #${ROOT_ID} .dm-btn:active,
      #${ROOT_ID} .dm-btn.pressed {
        background: rgba(88, 101, 242, 0.85);
        border-color: rgba(201, 212, 255, 0.65);
        transform: scale(0.96);
      }
      #${ROOT_ID} .dm-btn.empty {
        visibility: hidden;
        pointer-events: none;
      }
      #${ROOT_ID} .dm-up { grid-column: 2; grid-row: 1; }
      #${ROOT_ID} .dm-left { grid-column: 1; grid-row: 2; }
      #${ROOT_ID} .dm-right { grid-column: 3; grid-row: 2; }
      #${ROOT_ID} .dm-down { grid-column: 2; grid-row: 2; }
      html.dm-touch header {
        padding-top: max(8px, env(safe-area-inset-top, 0px));
        padding-left: max(10px, env(safe-area-inset-left, 0px));
        padding-right: max(10px, env(safe-area-inset-right, 0px));
      }
      html.dm-touch #hud {
        width: 100%;
        margin-left: 0;
        margin-top: 4px;
        font-size: 0.72rem;
      }
      html.dm-touch header h1 {
        font-size: 0.85rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 42vw;
      }
      html.dm-touch #presence-status { font-size: 0.68rem; }
      html.dm-touch.dm-portrait #wrap {
        padding-bottom: calc(118px + env(safe-area-inset-bottom, 0px));
      }
      html.dm-touch.dm-landscape #${ROOT_ID} {
        bottom: max(6px, env(safe-area-inset-bottom, 0px));
        padding-bottom: 0;
      }
      html.dm-touch.dm-landscape #wrap {
        padding-bottom: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function mountControls() {
    if (document.getElementById(ROOT_ID)) return;
    const bar = document.createElement('div');
    bar.id = ROOT_ID;
    bar.innerHTML = `
      <div class="dm-pad" aria-label="Movement controls">
        <button type="button" class="dm-btn dm-up" data-act="enter" aria-label="Enter or go up">▲</button>
        <button type="button" class="dm-btn dm-left" data-act="left" aria-label="Move left">◀</button>
        <button type="button" class="dm-btn dm-down" data-act="exit" aria-label="Exit or go down">▼</button>
        <button type="button" class="dm-btn dm-right" data-act="right" aria-label="Move right">▶</button>
      </div>
    `;
    document.body.appendChild(bar);
    bindHold(bar.querySelector('.dm-left'), 'left');
    bindHold(bar.querySelector('.dm-right'), 'right');
    bindPulse(bar.querySelector('.dm-up'), 'enter');
    bindPulse(bar.querySelector('.dm-down'), 'exit');
  }

  injectStyles();
  mountControls();
  syncClasses();
  window.addEventListener('resize', syncClasses);
  window.addEventListener('orientationchange', () => window.setTimeout(syncClasses, 120));
})();
