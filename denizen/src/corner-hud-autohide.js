/**
 * Auto-hide corner HUD controls (phone FAB + speak FAB) until hover.
 * Applies on desktop/tablet (anything that is not a phone form-factor).
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
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    // Always rewrite so we win over phone/voice FAB styles injected later.
    s.textContent = `
      #${HIT_PHONE_ID},
      #${HIT_SPEAK_ID} {
        display: none;
        position: fixed;
        z-index: 2147483600;
        width: 100px;
        height: 110px;
        bottom: 0;
        background: transparent;
        pointer-events: auto;
      }
      #${HIT_PHONE_ID} { right: 0; }
      #${HIT_SPEAK_ID} { left: 0; }

      /* Hide on laptop/desktop/tablet — not real phones */
      html:not(.denizen-phone).denizen-phone-mode #${HIT_PHONE_ID},
      html:not(.denizen-phone).denizen-phone-mode #${HIT_SPEAK_ID} {
        display: block;
      }
      html.denizen-phone-open #${HIT_PHONE_ID},
      html.denizen-phone-open #${HIT_SPEAK_ID},
      html.denizen-chat-open #${HIT_PHONE_ID},
      html.denizen-chat-open #${HIT_SPEAK_ID} {
        display: none !important;
      }

      html:not(.denizen-phone).denizen-phone-mode #denizen-phone-fab,
      html:not(.denizen-phone).denizen-phone-mode #denizen-speak-fab {
        transition: transform 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease !important;
      }

      /* Fully gone until corner HUD is open / hovered / listening */
      html:not(.denizen-phone).denizen-phone-mode:not(.denizen-corner-hud-open):not(.denizen-phone-open):not(.denizen-chat-open) #denizen-phone-fab:not(:hover):not(:focus-within) {
        transform: translateX(120%) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      html:not(.denizen-phone).denizen-phone-mode:not(.denizen-corner-hud-open):not(.denizen-phone-open):not(.denizen-chat-open) #denizen-speak-fab:not(:hover):not(:focus-within):not(.listening) {
        transform: translateX(-120%) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }

      html:not(.denizen-phone).denizen-corner-hud-open #denizen-phone-fab,
      html:not(.denizen-phone).denizen-corner-hud-open #denizen-speak-fab,
      html:not(.denizen-phone) #denizen-phone-fab:hover,
      html:not(.denizen-phone) #denizen-phone-fab:focus-within,
      html:not(.denizen-phone) #denizen-speak-fab:hover,
      html:not(.denizen-phone) #denizen-speak-fab:focus-within,
      html:not(.denizen-phone) #denizen-speak-fab.listening {
        transform: translateX(0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        visibility: visible !important;
      }
      html:not(.denizen-phone) #denizen-phone-fab:hover {
        transform: translateX(0) scale(1.06) !important;
      }
      html:not(.denizen-phone) #denizen-phone-fab.denizen-press-active,
      html:not(.denizen-phone) #denizen-phone-fab:active {
        transform: translateX(0) scale(0.94) !important;
      }
    `;
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
    if (root.classList.contains('denizen-phone')) return;
    if (root.classList.contains('denizen-phone-open')) return;
    if (root.classList.contains('denizen-chat-open')) return;
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
    injectStyles();
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
      if (root.classList.contains('denizen-phone')) return;
      if (root.classList.contains('denizen-phone-open')) return;
      if (root.classList.contains('denizen-chat-open')) return;
      const nearBottom = window.innerHeight - e.clientY <= 120;
      const nearLeft = e.clientX <= 100;
      const nearRight = window.innerWidth - e.clientX <= 100;
      if (nearBottom && (nearLeft || nearRight)) reveal(2800);
    }, { passive: true });
    if (typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(scan);
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('denizen-deferred-scripts-ready', () => {
      injectStyles();
      scan();
    });
    let passes = 0;
    const poll = setInterval(() => {
      scan();
      passes += 1;
      if (passes >= 20) clearInterval(poll);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
