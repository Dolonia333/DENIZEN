/**
 * After demo visitors play awhile, prompt them to create username + password.
 */
(function () {
  'use strict';

  const DISMISS_KEY = 'denizen-demo-account-dismissed';
  const PROMPTED_KEY = 'denizen-demo-account-prompted';
  const DEFAULT_DELAY_MS = 3 * 60 * 1000;
  const ENGAGED_DELAY_MS = 90 * 1000;

  let timer = null;
  let engaged = false;

  function sessionApi() {
    return globalThis.DenizenVisitorSession;
  }

  function shouldPrompt() {
    const api = sessionApi();
    if (!api?.isDemo?.()) return false;
    if (api?.hasDemoAccount?.()) return false;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return false;
      if (localStorage.getItem(PROMPTED_KEY) === '1') return false;
    } catch (_) {}
    if (document.documentElement.dataset.denizenModal === 'open') return false;
    return true;
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function maybePrompt() {
    if (!shouldPrompt()) return;
    const api = sessionApi();
    if (!api?.showDemoAccountModal) return;

    try {
      const sid = api.getSessionId?.();
      if (sid) {
        const res = await fetch(
          `/api/visitor/settings?session_id=${encodeURIComponent(sid)}`,
          { headers: api.authHeaders?.() || {} },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.has_demo_account || data.settings?.demo_username) return;
        }
      }
    } catch (_) {}

    if (!shouldPrompt()) return;

    try { localStorage.setItem(PROMPTED_KEY, '1'); } catch (_) {}
    const result = await api.showDemoAccountModal();
    if (!result?.ok) {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
    }
  }

  function schedulePrompt(delayMs) {
    clearTimer();
    if (!shouldPrompt()) return;
    timer = setTimeout(() => {
      timer = null;
      maybePrompt().catch((err) => {
        console.warn('[DenizenDemoAccountPrompt]', err?.message || err);
      });
    }, delayMs);
  }

  function onEngaged() {
    if (!sessionApi()?.isDemo?.()) return;
    if (engaged) return;
    engaged = true;
    schedulePrompt(ENGAGED_DELAY_MS);
  }

  document.addEventListener('denizen-visitor-session-ready', (e) => {
    if (e.detail?.tier !== 'demo') return;
    engaged = false;
    schedulePrompt(DEFAULT_DELAY_MS);
  });

  document.addEventListener('denizen-demo-engaged', onEngaged);
  document.addEventListener('denizen-demo-account-created', clearTimer);

  globalThis.DenizenDemoAccountPrompt = {
    schedulePrompt,
    maybePrompt,
  };
})();
