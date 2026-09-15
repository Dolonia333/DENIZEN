/**
 * Tabler line icons — shared helper for Denizen HUD panels.
 * Loads @tabler/icons-webfont once; use icon('trophy') → <i class="ti ti-trophy">.
 * Glyphs always have an emoji fallback so chips stay visible if the webfont fails.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-tabler-icons-style';
  const EMOJI = {
    'address-book': '📇',
    'bolt': '⚡',
    'book': '📖',
    'brand-discord': '🎮',
    'briefcase': '💼',
    'building': '🏢',
    'chart-dots': '📊',
    'chart-line': '📈',
    'clipboard-list': '📋',
    'columns': '📋',
    'compass': '🧭',
    'device-desktop': '🖥️',
    'hexagon': '⬡',
    'id-badge-2': '🪪',
    'map': '🗺️',
    'message': '💬',
    'messages': '💬',
    'microphone': '🎤',
    'news': '📰',
    'player-stop': '⏹',
    'screenshot': '✂️',
    'settings': '⚙️',
    'shield': '🛡️',
    'stethoscope': '🩺',
    'switch-horizontal': '⇄',
    'terminal-2': '⌨️',
    'tools': '🛠️',
    'trophy': '🏆',
    'user': '👤',
    'video': '🎥',
    'volume': '🔊',
    'world-www': '🌐',
    'x': '✕',
  };

  let ready = false;

  function cssHref() {
    try {
      return new URL('/vendor/tabler/tabler-icons.min.css?v=restore3', location.origin).href;
    } catch (_) {
      return './vendor/tabler/tabler-icons.min.css?v=restore3';
    }
  }

  function markReady() {
    if (ready) return;
    ready = true;
    document.documentElement.classList.add('denizen-ti-ready');
    try { window.dispatchEvent(new Event('denizen-tabler-ready')); } catch (_) {}
  }

  function probeFont() {
    const fonts = document.fonts;
    if (!fonts?.load) return;
    fonts.load('16px "tabler-icons"').then((loaded) => {
      if (loaded && loaded.length) markReady();
    }).catch(() => {});
    fonts.ready.then(() => {
      try {
        for (const f of fonts) {
          const fam = String(f.family || '').replace(/['"]/g, '');
          if (fam === 'tabler-icons' && f.status === 'loaded') markReady();
        }
      } catch (_) {}
    }).catch(() => {});
  }

  function ensureStyles() {
    if (!document.getElementById(STYLE_ID)) {
      const link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = cssHref();
      link.onload = probeFont;
      document.head.appendChild(link);
    }

    if (!document.getElementById(`${STYLE_ID}-fallback`)) {
      const s = document.createElement('style');
      s.id = `${STYLE_ID}-fallback`;
      s.textContent = `
        @font-face {
          font-family: "tabler-icons";
          font-style: normal;
          font-weight: 400;
          src: url("/vendor/tabler/fonts/tabler-icons.woff2") format("woff2"),
               url("./vendor/tabler/fonts/tabler-icons.woff2") format("woff2");
        }
        .ti, i.ti, .denizen-ti {
          font-family: "tabler-icons" !important;
          speak: none;
          font-style: normal !important;
          font-weight: 400 !important;
          font-variant: normal;
          text-transform: none;
          line-height: 1;
          -webkit-font-smoothing: antialiased;
        }
        .denizen-ti, .denizen-ti.ti {
          display: inline-block;
          vertical-align: -0.15em;
        }
        .denizen-ti-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          vertical-align: -0.15em;
        }
        .denizen-ti-fb { display: inline-block; line-height: 1; }
        html.denizen-ti-ready .denizen-ti-fb { display: none !important; }
        html:not(.denizen-ti-ready) .denizen-ti-wrap > .ti { display: none !important; }
        .denizen-ti-muted { color: #64748b; }
        .denizen-ti-gold { color: #fbbf24; }
        .denizen-ti-green { color: #4ade80; }
        .denizen-ti-red { color: #f87171; }
        .denizen-ti-blue { color: #60a5fa; }
        .denizen-chip-label {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
      `;
      document.head.appendChild(s);
    }
    probeFont();
  }

  /** @param {string} name Tabler icon name without ti- prefix (e.g. 'trophy') */
  function icon(name, opts = {}) {
    ensureStyles();
    const size = Number(opts.size) || 14;
    const tone = opts.tone ? ` denizen-ti-${opts.tone}` : '';
    const extra = opts.className ? ` ${opts.className}` : '';
    const safe = String(name || 'circle').replace(/[^a-z0-9-]/gi, '');
    const fb = opts.fallback || EMOJI[safe] || '●';
    const glyph = `<i class="ti ti-${safe} denizen-ti${tone}${extra}" style="font-size:${size}px" aria-hidden="true"></i>`;
    return `<span class="denizen-ti-wrap" style="font-size:${size}px">${glyph}<span class="denizen-ti-fb" aria-hidden="true">${fb}</span></span>`;
  }

  function chip(iconName, text, opts = {}) {
    const label = text == null ? '' : String(text);
    if (!iconName) return label;
    const wrap = opts.wrap === false ? '' : ' denizen-chip-label';
    return `<span class="${wrap.trim() || 'denizen-chip-label'}">${icon(iconName, opts)}${label ? ` ${label}` : ''}</span>`;
  }

  function withIcon(name, text, opts = {}) {
    return chip(name, text, opts);
  }

  function x(opts = {}) {
    return icon('x', { size: opts.size || 14, tone: opts.tone, fallback: '✕' });
  }

  /** Set a button/chip element to icon + optional label (uses innerHTML). */
  function setEl(el, iconName, text, opts = {}) {
    if (!el) return;
    if (iconName) el.innerHTML = chip(iconName, text, opts);
    else el.textContent = text == null ? '' : String(text);
  }

  /** Paint a dock chip — icon-only on touch, icon+label on desktop. */
  function paintChip(el, iconName, label, opts = {}) {
    if (!el) return;
    ensureStyles();
    const touch = document.documentElement.classList.contains('denizen-touch');
    const iconOnly = opts.iconOnly ?? (opts.compact ?? touch);
    const name = String(iconName || 'circle').replace(/[^a-z0-9-]/gi, '');
    const text = label == null ? '' : String(label);
    if (iconOnly) {
      el.innerHTML = icon(name, { size: opts.size || 14, fallback: opts.fallback });
      el.title = opts.title != null ? String(opts.title) : text;
    } else {
      el.innerHTML = text ? chip(name, text, { size: opts.size || 13, fallback: opts.fallback }) : icon(name, { size: opts.size || 14, fallback: opts.fallback });
      if (opts.title != null) el.title = String(opts.title);
    }
  }

  /** Paint mic / stop for voice controls. */
  function speakGlyph(listening, opts = {}) {
    return icon(listening ? 'player-stop' : 'microphone', opts);
  }

  function isReady() {
    return ready;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureStyles, { once: true });
  } else {
    ensureStyles();
  }

  globalThis.DenizenTablerIcons = {
    icon, chip, withIcon, x, setEl, paintChip, ensureStyles, speakGlyph, isReady,
  };
})();
