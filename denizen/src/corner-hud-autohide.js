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
    // Rewrite so we win over phone/voice FAB styles injected later — but only
    // when the content actually differs. scan() runs from a MutationObserver
    // that watches the whole document; unconditionally setting textContent is
    // itself a mutation, which re-triggers the observer in an infinite
    // microtask loop that freezes the page and OOMs the tab.
    const css = `
      #${HIT_PHONE_ID} {
        display: none;
        position: fixed;
        /* Below FABs so once revealed, clicks hit the real buttons */
        z-index: 2147483000;
        width: 120px;
        height: 130px;
        bottom: 0;
        background: transparent;
        pointer-events: auto;
      }
      #${HIT_PHONE_ID} { right: 0; }
      #${HIT_SPEAK_ID} { display: none !important; }

      /* Hide on laptop/desktop/tablet — not real phones */
      html:not(.denizen-phone).denizen-phone-mode #${HIT_PHONE_ID} {
        display: block;
      }
      html.denizen-phone-open #${HIT_PHONE_ID},
      html.denizen-chat-open #${HIT_PHONE_ID},
      html.denizen-buzz-ring-open #${HIT_PHONE_ID} {
        display: none !important;
      }

      /* While FABs are visible, hit zones must not steal clicks */
      html.denizen-corner-hud-open #${HIT_PHONE_ID} {
        pointer-events: none !important;
      }

      html:not(.denizen-phone).denizen-phone-mode #denizen-phone-fab {
        transition: transform 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease !important;
      }

      /* Fully gone until corner HUD is open / hovered */
      html:not(.denizen-phone).denizen-phone-mode:not(.denizen-corner-hud-open):not(.denizen-phone-open):not(.denizen-chat-open):not(.denizen-buzz-ring-open) #denizen-phone-fab:not(:hover):not(:focus-within) {
        transform: translateX(120%) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }

      html:not(.denizen-phone).denizen-corner-hud-open #denizen-phone-fab,
      html:not(.denizen-phone):not(.denizen-buzz-ring-open) #denizen-phone-fab:hover,
      html:not(.denizen-phone):not(.denizen-buzz-ring-open) #denizen-phone-fab:focus-within {
        transform: translateX(0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        visibility: visible !important;
        z-index: 2147483646 !important;
      }
      html.denizen-buzz-ring-open #denizen-phone-fab,
      html.denizen-buzz-ring-open #denizen-phone-fab:hover,
      html.denizen-buzz-ring-open #denizen-phone-fab:focus-within,
      html.denizen-buzz-ring-open #denizen-phone-fab.denizen-press-active,
      html.denizen-buzz-ring-open #denizen-phone-fab:active {
        right: 168px !important;
        bottom: 152px !important;
        transform: none !important;
        opacity: 1 !important;
        /* Must not steal taps from Buzz ring actions (FAB sits above the ring). */
        pointer-events: none !important;
        visibility: visible !important;
        z-index: 2147483590 !important;
      }
      html.denizen-phone.denizen-buzz-ring-open #denizen-phone-fab,
      html.denizen-phone.denizen-buzz-ring-open #denizen-phone-fab:hover,
      html.denizen-phone.denizen-buzz-ring-open #denizen-phone-fab:focus-within {
        right: 50% !important;
        bottom: 38% !important;
        transform: translateX(50%) !important;
        pointer-events: none !important;
        z-index: 2147483590 !important;
      }
      #denizen-speak-fab { display: none !important; }
      /* Keep slide-in transform; scale lives on inner .dzp-fab-buzz so Buzz stays crisp */
      html:not(.denizen-phone):not(.denizen-buzz-ring-open) #denizen-phone-fab:hover {
        transform: translateX(0) !important;
      }
      html:not(.denizen-phone) #denizen-phone-fab:hover .dzp-fab-buzz {
        filter: brightness(1.08);
      }
      html:not(.denizen-phone):not(.denizen-buzz-ring-open) #denizen-phone-fab.denizen-press-active,
      html:not(.denizen-phone):not(.denizen-buzz-ring-open) #denizen-phone-fab:active {
        transform: translateX(0) !important;
      }
      html:not(.denizen-phone) #denizen-phone-fab.denizen-press-active .dzp-fab-buzz,
      html:not(.denizen-phone) #denizen-phone-fab:active .dzp-fab-buzz {
        transform: scale(0.96);
      }
    `;
    if (s.textContent !== css) s.textContent = css;
  }

  function ensureHitZones() {
    if (!document.getElementById(HIT_PHONE_ID)) {
      const phoneHit = document.createElement('div');
      phoneHit.id = HIT_PHONE_ID;
      phoneHit.setAttribute('aria-hidden', 'true');
      document.body.appendChild(phoneHit);
    }
    const leftoverSpeak = document.getElementById(HIT_SPEAK_ID);
    if (leftoverSpeak) leftoverSpeak.remove();
  }

  function reveal(ms = 2400) {
    const root = document.documentElement;
    if (root.classList.contains('denizen-phone')) return;
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
    injectStyles();
    ensureHitZones();
    wireEl(document.getElementById('denizen-phone-fab'));
    wireEl(document.getElementById(HIT_PHONE_ID));
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
      const nearRight = window.innerWidth - e.clientX <= 100;
      if (nearBottom && nearRight) reveal(2800);
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
