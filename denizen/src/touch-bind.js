/**
 * Reliable tap/click binding for mobile browsers (iOS Safari, Android Chrome).
 * Uses pointerup so buttons fire even when parent touch handlers use preventDefault.
 */
(function () {
  'use strict';

  function bindPress(el, handler, opts = {}) {
    if (!el || typeof handler !== 'function') return () => {};
    const stop = opts.stop !== false;
    let lastAt = 0;
    let pointerHandledAt = 0;

    const fire = (e) => {
      const now = Date.now();
      if (now - lastAt < 400) return;
      lastAt = now;
      if (stop) {
        try { e.stopPropagation(); } catch (_) {}
      }
      handler(e);
    };

    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerHandledAt = Date.now();
      fire(e);
    };

    const onClick = (e) => {
      if (Date.now() - pointerHandledAt < 500) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        return;
      }
      fire(e);
    };

    el.addEventListener('pointerup', onPointerUp);
    if (opts.fallbackClick !== false) {
      el.addEventListener('click', onClick);
    }

    return () => {
      el.removeEventListener('pointerup', onPointerUp);
      if (opts.fallbackClick !== false) {
        el.removeEventListener('click', onClick);
      }
    };
  }

  function delegatePress(root, selector, handler, opts = {}) {
    if (!root || typeof handler !== 'function') return () => {};
    const stop = opts.stop !== false;
    let lastKey = '';
    let lastAt = 0;

    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = e.target && typeof e.target.closest === 'function'
        ? e.target.closest(selector)
        : null;
      if (!hit || !root.contains(hit)) return;
      const key = hit.id || hit.className || selector;
      const now = Date.now();
      if (key === lastKey && now - lastAt < 280) return;
      lastKey = key;
      lastAt = now;
      if (stop) {
        try { e.stopPropagation(); } catch (_) {}
      }
      handler(e, hit);
    };

    root.addEventListener('pointerup', onPointerUp);
    return () => root.removeEventListener('pointerup', onPointerUp);
  }

  window.DenizenTouchBind = { bindPress, delegatePress };
})();
