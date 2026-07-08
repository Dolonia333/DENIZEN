/**
 * Tabler line icons ΓÇö shared helper for Denizen HUD panels.
 * Loads @tabler/icons-webfont once; use icon('trophy') ΓåÆ <i class="ti ti-trophy">.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-tabler-icons-style';
  const CSS_HREF = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.0/dist/tabler-icons.min.css';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);

    const s = document.createElement('style');
    s.textContent = `
      .denizen-ti, .denizen-ti.ti {
        display: inline-block;
        vertical-align: -0.15em;
        line-height: 1;
        font-style: normal;
        font-weight: normal;
      }
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

  /** @param {string} name Tabler icon name without ti- prefix (e.g. 'trophy') */
  function icon(name, opts = {}) {
    ensureStyles();
    const size = Number(opts.size) || 14;
    const tone = opts.tone ? ` denizen-ti-${opts.tone}` : '';
    const extra = opts.className ? ` ${opts.className}` : '';
    const safe = String(name || 'circle').replace(/[^a-z0-9-]/gi, '');
    return `<i class="ti ti-${safe} denizen-ti${tone}${extra}" style="font-size:${size}px" aria-hidden="true"></i>`;
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
    return icon('x', { size: opts.size || 14, tone: opts.tone });
  }

  /** Set a button/chip element to icon + optional label (uses innerHTML). */
  function setEl(el, iconName, text, opts = {}) {
    if (!el) return;
    if (iconName) el.innerHTML = chip(iconName, text, opts);
    else el.textContent = text == null ? '' : String(text);
  }

  globalThis.DenizenTablerIcons = { icon, chip, withIcon, x, setEl, ensureStyles };
})();
