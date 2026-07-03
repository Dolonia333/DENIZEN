/**
 * Reliable tap/click binding for mobile browsers (iOS Safari, Android Chrome).
 * Uses pointerup so buttons fire even when parent touch handlers use preventDefault.
 */
(function () {
  'use strict';

  const PRESS_CLASS = 'denizen-press-active';

  function bindPress(el, handler, opts = {}) {
    if (!el || typeof handler !== 'function') return () => {};
    const stop = opts.stop !== false;
    const pressClass = opts.pressClass || PRESS_CLASS;
    const pressFeedback = opts.pressFeedback !== false;
    let lastAt = 0;
    let pointerHandledAt = 0;

    const clearPress = () => {
      if (pressFeedback) el.classList.remove(pressClass);
    };

    const fire = (e) => {
      const now = Date.now();
      if (now - lastAt < 300) return;
      lastAt = now;
      if (stop) {
        try { e.stopPropagation(); } catch (_) {}
      }
      handler(e);
    };

    const onPointerDown = (e) => {
      if (!pressFeedback) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.classList.add(pressClass);
    };

    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerHandledAt = Date.now();
      clearPress();
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
      clearPress();
      fire(e);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', clearPress);
    if (opts.fallbackClick !== false) {
      el.addEventListener('click', onClick);
    }

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', clearPress);
      if (opts.fallbackClick !== false) {
        el.removeEventListener('click', onClick);
      }
      clearPress();
    };
  }

  function delegatePress(root, selector, handler, opts = {}) {
    if (!root || typeof handler !== 'function') return () => {};
    const stop = opts.stop !== false;
    const pressClass = opts.pressClass || PRESS_CLASS;
    const pressFeedback = opts.pressFeedback !== false;
    let lastKey = '';
    let lastAt = 0;
    let pressedEl = null;

    const clearPress = () => {
      if (pressedEl) {
        pressedEl.classList.remove(pressClass);
        pressedEl = null;
      }
    };

    const onPointerDown = (e) => {
      if (!pressFeedback) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = e.target?.closest?.(selector);
      if (!hit || !root.contains(hit)) return;
      clearPress();
      pressedEl = hit;
      hit.classList.add(pressClass);
    };

    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = e.target && typeof e.target.closest === 'function'
        ? e.target.closest(selector)
        : null;
      clearPress();
      if (!hit || !root.contains(hit)) return;
      // Dedupe by element identity, not action name: different buttons often
      // share data-action (both tabs are "tab", every contact is "open-dm"),
      // and a name-based key silently dropped rapid taps on distinct buttons.
      const now = Date.now();
      if (hit === lastKey && now - lastAt < 280) return;
      lastKey = hit;
      lastAt = now;
      if (stop) {
        try { e.stopPropagation(); } catch (_) {}
      }
      handler(e, hit);
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', clearPress);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', clearPress);
      clearPress();
    };
  }

  window.DenizenTouchBind = { bindPress, delegatePress };
})();
