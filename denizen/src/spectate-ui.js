/**
 * Spectate UX — watch-only banner, capacity (1013), readonly errors, reconnect hint.
 * Load after spectate-routing.js.
 */
(function () {
  'use strict';

  const STYLES = `
    #denizen-spectate-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100004;
      background: linear-gradient(90deg, rgba(30, 58, 138, 0.96), rgba(15, 118, 110, 0.96));
      color: #e0f2fe; text-align: center; padding: 7px 12px;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      border-bottom: 1px solid rgba(125, 211, 252, 0.35);
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    }
    #denizen-spectate-banner strong { color: #fef08a; }
    #denizen-spectate-toast {
      position: fixed; bottom: 88px; left: 50%; transform: translateX(-50%);
      z-index: 100005; max-width: min(92vw, 420px);
      background: rgba(15, 23, 42, 0.94); color: #fecaca;
      border: 1px solid #7f1d1d; border-radius: 10px; padding: 10px 14px;
      font: 12px/1.4 ui-monospace, monospace; display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    }
    #denizen-ws-reconnect-banner {
      position: fixed; top: 36px; left: 0; right: 0; z-index: 100003;
      background: rgba(120, 53, 15, 0.95); color: #fed7aa;
      text-align: center; padding: 6px 10px;
      font: 11px/1.35 ui-monospace, monospace; display: none;
    }
    html.denizen-spectate-routing #denizen-load-banner { top: 32px; }
    html.denizen-spectate-routing #denizen-ws-banner { top: 32px; }
  `;

  let spectateBanner = null;
  let toastEl = null;
  let reconnectBanner = null;
  let toastTimer = null;

  function injectStyles() {
    if (document.getElementById('denizen-spectate-ui-style')) return;
    const s = document.createElement('style');
    s.id = 'denizen-spectate-ui-style';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function ensureSpectateBanner() {
    if (spectateBanner) return spectateBanner;
    spectateBanner = document.createElement('div');
    spectateBanner.id = 'denizen-spectate-banner';
    globalThis.DenizenSafeDom.setSafeHtml(spectateBanner, '<strong>Spectator mode</strong> — live office relay; chat &amp; edits happen on the main site');
    document.body.prepend(spectateBanner);
    return spectateBanner;
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.id = 'denizen-spectate-toast';
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function ensureReconnectBanner() {
    if (reconnectBanner) return reconnectBanner;
    reconnectBanner = document.createElement('div');
    reconnectBanner.id = 'denizen-ws-reconnect-banner';
    reconnectBanner.textContent = 'Reconnecting to live relay…';
    document.body.appendChild(reconnectBanner);
    return reconnectBanner;
  }

  function showToast(message, ms = 5000) {
    const el = ensureToast();
    el.textContent = message;
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
  }

  function isSpectate() {
    return document.documentElement.classList.contains('denizen-spectate-routing')
      || !!globalThis.DenizenSpectateRouting?.isSpectateMode?.();
  }

  function initBanner() {
    injectStyles();
    const routing = globalThis.DenizenSpectateRouting;
    const show = () => {
      if (routing?.isSpectateMode?.()) ensureSpectateBanner().style.display = 'block';
    };
    if (routing?.loadConfig) routing.loadConfig().then(show).catch(show);
    else show();
  }

  function handleWsOpen() {
    if (reconnectBanner) reconnectBanner.style.display = 'none';
  }

  function handleWsClose(event) {
    const code = event && typeof event.code === 'number' ? event.code : 0;
    const reason = (event && event.reason) || '';
    if (code === 1013 || /capacity/i.test(reason)) {
      showToast('This relay node is at viewer capacity — try again in a minute or refresh.');
      return;
    }
    if (isSpectate() && code !== 1000) {
      ensureReconnectBanner().style.display = 'block';
    }
  }

  function handleServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'spectate_readonly') {
      showToast(msg.message || 'Spectator node is read-only — use the main site to chat.');
    }
  }

  function attachWs(ws) {
    if (!ws || ws._denizenSpectateUiAttached) return;
    ws._denizenSpectateUiAttached = true;
    ws.addEventListener('open', handleWsOpen);
    ws.addEventListener('close', handleWsClose);
    ws.addEventListener('message', (evt) => {
      try {
        handleServerMessage(JSON.parse(evt.data));
      } catch (_) {}
    });
  }

  function patchWebSocket() {
    if (globalThis.__denizenSpectateUiPatched) return;
    globalThis.__denizenSpectateUiPatched = true;
    const Orig = globalThis.WebSocket;
    if (!Orig) return;
    globalThis.WebSocket = function DenizenWebSocket(url, protocols) {
      const ws = protocols !== undefined ? new Orig(url, protocols) : new Orig(url);
      attachWs(ws);
      return ws;
    };
    globalThis.WebSocket.prototype = Orig.prototype;
    globalThis.WebSocket.CONNECTING = Orig.CONNECTING;
    globalThis.WebSocket.OPEN = Orig.OPEN;
    globalThis.WebSocket.CLOSING = Orig.CLOSING;
    globalThis.WebSocket.CLOSED = Orig.CLOSED;
  }

  globalThis.DenizenSpectateUI = {
    initBanner,
    attachWs,
    handleWsOpen,
    handleWsClose,
    handleServerMessage,
    showToast,
  };

  patchWebSocket();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBanner);
  } else {
    initBanner();
  }
})();
