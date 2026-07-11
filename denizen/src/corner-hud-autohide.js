/**
 * Auto-hide corner HUD controls (phone FAB + speak FAB) on desktop until hover.
 * Buttons are fully invisible until the cursor enters that corner.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-corner-hud-autohide-style';
  const HIT_PHONE_ID = 'denizen-corner-hit-phone';
  const HIT_SPEAK_ID = 'denizen-corner-hit-speak';
  const wired = new WeakSet();
  let revealTimer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${HIT_PHONE_ID},
      #${HIT_SPEAK_ID} {
        display: none;
        position: fixed;
        z-index: 2147483485;
        width: 88px;
        height: 96px;
        bottom: 0;
        background: transparent;
        pointer-events: auto;
      }
      #${HIT_PHONE_ID} { right: 0; }
      #${HIT_SPEAK_ID} { left: 0; }

      html.denizen-desktop.denizen-phone-mode #${HIT_PHONE_ID},
      html.denizen-desktop.denizen-phone-mode #${HIT_SPEAK_ID} {
        display: block;
      }
      html.denizen-desktop.denizen-phone-open #${HIT_PHONE_ID},
      html.denizen-desktop.denizen-phone-open #${HIT_SPEAK_ID},
      html.denizen-desktop.denizen-chat-open #${HIT_PHONE_ID},
      html.denizen-desktop.denizen-chat-open #${HIT_SPEAK_ID} {
        display: none !important;
      }

      html.denizen-desktop.denizen-phone-mode #denizen-phone-fab,
      html.denizen-desktop.denizen-phone-mode #denizen-speak-fab {
        transition: transform 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }

      /* Fully gone until corner HUD is open / hovered / listening */
      html.denizen-desktop.denizen-phone-mode:not(.denizen-corner-hud-open):not(.denizen-phone-open):not(.denizen-chat-open) #denizen-phone-fab:not(:hover):not(:focus-within) {
        transform: translateX(110%);
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden;
      }
      html.denizen-desktop.denizen-phone-mode:not(.denizen-corner-hud-open):not(.denizen-phone-open):not(.denizen-chat-open) #denizen-speak-fab:not(:hover):not(:focus-within):not(.listening) {
        transform: translateX(-110%);
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden;
      }

      html.denizen-desktop.denizen-corner-hud-open #denizen-phone-fab,
      html.denizen-desktop.denizen-corner-hud-open #denizen-speak-fab,
      html.denizen-desktop #denizen-phone-fab:hover,
      html.denizen-desktop #denizen-phone-fab:focus-within,
      html.denizen-desktop #denizen-speak-fab:hover,
      html.denizen-desktop #denizen-speak-fab:focus-within,
      html.denizen-desktop #denizen-speak-fab.listening {
        transform: translateX(0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        visibility: visible !important;
      }
      html.denizen-desktop #denizen-phone-fab:hover {
        transform: translateX(0) scale(1.06) !important;
      }
      html.denizen-desktop #denizen-phone-fab.denizen-press-active,
      html.denizen-desktop #denizen-phone-fab:active {
        transform: translateX(0) scale(0.94) !important;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureHitZones() {
    if (!document.getElementById(HIT_PHONE_ID)) {
      const phoneHit = document.createElement('div');
      phoneHit.id = HIT_PHONE_ID;
      phoneHit.setAttribute('aria-hidden', 'true');
      document.body.appendChild(phoneHit);
    }
    if (!document.getElementById(HIT_SPEAK_ID)) {
      const speakHit = document.createElement('div');
      speakHit.id = HIT_SPEAK_ID;
      speakHit.setAttribute('aria-hidden', 'true');
      document.body.appendChild(speakHit);
    }
  }

  function reveal(ms = 2400) {
    const root = document.documentElement;
    if (!root.classList.contains('denizen-desktop')) return;
    if (root.classList.contains('denizen-phone-open')) return;
    if (root.classList.contains('denizen-chat-open')) return;
    // Tour owns phone highlighting; left/right corner peeks fight the guide.
    if (root.dataset.denizenOnboarding === 'open') return;
    root.classList.add('denizen-corner-hud-open');
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      root.classList.remove('denizen-corner-hud-open');
      revealTimer = null;
    }, ms);
  }

  function wireEl(el) {
    if (!el || wired.has(el)) return;
    wired.add(el);
    el.addEventListener('pointerenter', () => reveal(5200));
    el.addEventListener('pointerdown', () => reveal(5200));
    el.addEventListener('focusin', () => reveal(5200));
    el.addEventListener('pointerleave', () => reveal(900));
  }

  function scan() {
    ensureHitZones();
    wireEl(document.getElementById('denizen-phone-fab'));
    wireEl(document.getElementById('denizen-speak-fab'));
    wireEl(document.getElementById(HIT_PHONE_ID));
    wireEl(document.getElementById(HIT_SPEAK_ID));
  }

  function boot() {
    injectStyles();
    scan();
    window.addEventListener('mousemove', (e) => {
      const root = document.documentElement;
      if (!root.classList.contains('denizen-desktop')) return;
      if (root.classList.contains('denizen-phone-open')) return;
      if (root.classList.contains('denizen-chat-open')) return;
      const nearBottom = window.innerHeight - e.clientY <= 110;
      const nearLeft = e.clientX <= 90;
      const nearRight = window.innerWidth - e.clientX <= 90;
      if (nearBottom && (nearLeft || nearRight)) reveal(2800);
    }, { passive: true });
    if (typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(scan);
      obs.observe(document.body, { childList: true });
    }
    document.addEventListener('denizen-deferred-scripts-ready', scan);
    let passes = 0;
    const poll = setInterval(() => {
      scan();
      passes += 1;
      if (passes >= 8) clearInterval(poll);
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
