/**
 * Safe DOM helpers — avoid Element#innerHTML assignment (XSS / Vibecore).
 * Browser: window.globalThis.DenizenSafeDom. Node: module.exports.
 */
(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeHtml(html) {
    const raw = String(html ?? '');
    if (!raw) return '';
    return raw
      .replace(/<\/(?:script|iframe|object|embed|link|meta|base)[^>]*>/gi, '')
      .replace(/<(?:script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
      .replace(/\shref\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, ' href="#"')
      .replace(/\ssrc\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, ' src=""');
  }

  function clearEl(el) {
    if (!el) return el;
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function setSafeHtml(el, html) {
    if (!el) return el;
    const sanitized = sanitizeHtml(html);
    if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
      try { el.textContent = sanitized.replace(/<[^>]+>/g, ' '); } catch (_) { /* */ }
      return el;
    }
    const parsed = new DOMParser().parseFromString(
      `<body><div id="__safe_dom_root">${sanitized}</div></body>`,
      'text/html',
    );
    const wrap = parsed.getElementById('__safe_dom_root');
    clearEl(el);
    if (wrap) {
      const doc = el.ownerDocument || document;
      while (wrap.firstChild) el.appendChild(doc.importNode(wrap.firstChild, true));
    }
    return el;
  }

  function setText(el, text) {
    if (!el) return el;
    el.textContent = text == null ? '' : String(text);
    return el;
  }

  const api = { escapeHtml, sanitizeHtml, clearEl, setSafeHtml, setText, setHtml: setSafeHtml };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DenizenSafeDom = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined));
