/**
 * Denizen Desktop pairing — browser UI to link Denizen Desktop via deep link.
 * Attaches to globalThis.DenizenDesktopPairing (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-desktop-pairing-style';
  const MODAL_ID = 'denizen-desktop-pairing-modal';
  const API_FETCH_MS = 8000;
  const STATUS_POLL_MS = 4000;

  let modalEl = null;
  let statusPollTimer = null;

  function getSessionApi() {
    return globalThis.DenizenVisitorSession || null;
  }

  function usesTunnelSafeTransport() {
    const host = String(window.location?.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return false;
    return window.location?.protocol === 'https:' || host.endsWith('.dolonia.cloud');
  }

  function isTransientError(err) {
    const msg = String(err?.message || err || '');
    return err?.name === 'AbortError'
      || /timeout|timed out|failed to fetch|network|load failed/i.test(msg);
  }

  function normalizeFetchError(err) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'AbortError' || /aborted|abort/i.test(msg)) {
      return new Error('Pairing request timed out — try again.');
    }
    if (/failed to fetch|network|load failed/i.test(msg)) {
      return new Error('Cannot reach Denizen server — is it running?');
    }
    return err instanceof Error ? err : new Error(msg || 'Request failed');
  }

  async function fetchWithTimeout(url, opts = {}, ms = API_FETCH_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (err) {
      throw normalizeFetchError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  function buildSessionHeaders() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    const token = api?.getSessionToken?.();
    const headers = typeof api?.authHeaders === 'function'
      ? api.authHeaders()
      : { 'Content-Type': 'application/json' };
    if (sid) headers['X-Session-Id'] = sid;
    if (token) headers['X-Session-Token'] = token;
    return headers;
  }

  function buildDeepLink(token, serverUrl) {
    const server = encodeURIComponent(serverUrl || window.location.origin);
    const tok = encodeURIComponent(String(token || ''));
    return `denizen://pair?token=${tok}&server=${server}`;
  }

  async function requestPairingCreate() {
    const api = getSessionApi();
    const sid = api?.getSessionId?.();
    if (!sid) throw new Error('Session not ready');

    const headers = buildSessionHeaders();

    if (usesTunnelSafeTransport()) {
      const res = await fetchWithTimeout('/api/desktop/pairing/create', {
        method: 'GET',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Pairing failed (${res.status})`);
      }
      return data;
    }

    let res;
    try {
      res = await fetchWithTimeout('/api/desktop/pairing/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sid }),
      });
    } catch (err) {
      if (!isTransientError(err)) throw err;
      res = await fetchWithTimeout('/api/desktop/pairing/create', {
        method: 'GET',
        headers,
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Pairing failed (${res.status})`);
    }
    return data;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147482900;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.92);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        pointer-events: auto;
        touch-action: manipulation;
      }
      #${MODAL_ID} .pair-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 22px 24px;
        width: min(380px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #${MODAL_ID} h2 {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 700;
        color: #e2e8f0;
      }
      #${MODAL_ID} p {
        margin: 0 0 14px;
        font-size: 12px;
        color: #94a3b8;
        line-height: 1.45;
      }
      #${MODAL_ID} .pair-expiry {
        margin: 0 0 14px;
        font-size: 10px;
        color: #fbbf24;
      }
      #${MODAL_ID} .pair-error {
        margin: 0 0 12px;
        font-size: 11px;
        color: #f87171;
      }
      #${MODAL_ID} .pair-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${MODAL_ID} .pair-btn {
        width: 100%;
        border-radius: 8px;
        padding: 12px 14px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        min-height: 44px;
        touch-action: manipulation;
      }
      #${MODAL_ID} .pair-btn.open {
        background: #4ade80;
        color: #0f172a;
        border: none;
      }
      #${MODAL_ID} .pair-btn.open:hover { background: #22c55e; }
      #${MODAL_ID} .pair-btn.copy {
        background: #1e293b;
        color: #93c5fd;
        border: 1px solid #334155;
      }
      #${MODAL_ID} .pair-btn.copy:hover { border-color: #4ade80; }
      #${MODAL_ID} .pair-btn.close {
        background: transparent;
        color: #64748b;
        border: none;
        font-size: 11px;
        font-weight: 600;
        min-height: 36px;
      }
      #${MODAL_ID} .pair-btn.close:hover { color: #94a3b8; }
      #${MODAL_ID} .pair-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      #${MODAL_ID} .pair-copied {
        margin: 0;
        font-size: 10px;
        color: #4ade80;
        text-align: center;
        min-height: 14px;
      }
      html[data-denizen-modal="open"] #${MODAL_ID} {
        z-index: 2147483000;
      }
    `;
    document.head.appendChild(s);
  }

  function stopStatusPoll() {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  function refreshNodeStatus() {
    try {
      const refresh = globalThis.DenizenNodeUI?.refresh;
      if (typeof refresh === 'function') {
        return refresh().catch(() => null);
      }
    } catch (_) {}
    return Promise.resolve(null);
  }

  function startStatusPoll() {
    stopStatusPoll();
    statusPollTimer = setInterval(() => {
      refreshNodeStatus().then((st) => {
        if (st?.desktopLinked) {
          const expiryEl = modalEl?.querySelector('.pair-expiry');
          if (expiryEl) {
            expiryEl.textContent = 'Desktop linked — you can close this dialog.';
            expiryEl.style.color = '#4ade80';
          }
        }
      }).catch(() => null);
    }, STATUS_POLL_MS);
  }

  function closeModal() {
    stopStatusPoll();
    if (!modalEl) {
      refreshNodeStatus();
      return;
    }
    modalEl.remove();
    modalEl = null;
    if (!document.getElementById('denizen-visitor-name-modal')) {
      delete document.documentElement.dataset.denizenModal;
    }
    try {
      if (window.game?.input) window.game.input.enabled = true;
    } catch (_) {}
    refreshNodeStatus();
  }

  async function copyText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function showPairingModal(pairing) {
    injectStyles();
    closeModal();

    const deepLink = pairing.deepLink || buildDeepLink(pairing.token, pairing.serverUrl);
    modalEl = document.createElement('div');
    modalEl.id = MODAL_ID;
    modalEl.innerHTML = `
      <div class="pair-card">
        <h2>Link Denizen Desktop</h2>
        <p>Open Denizen Desktop on this machine to profile hardware, approve agent access, and contribute compute.</p>
        <p class="pair-expiry">This pairing link expires in 5 minutes.</p>
        <p class="pair-error" id="denizen-pair-error" hidden></p>
        <div class="pair-actions">
          <button type="button" class="pair-btn open" id="denizen-pair-open">Open Denizen Desktop</button>
          <button type="button" class="pair-btn copy" id="denizen-pair-copy">Copy pairing link</button>
          <p class="pair-copied" id="denizen-pair-copied" aria-live="polite"></p>
          <button type="button" class="pair-btn close" id="denizen-pair-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    document.documentElement.dataset.denizenModal = 'open';
    try {
      if (window.game?.input) window.game.input.enabled = false;
    } catch (_) {}

    const openBtn = modalEl.querySelector('#denizen-pair-open');
    const copyBtn = modalEl.querySelector('#denizen-pair-copy');
    const closeBtn = modalEl.querySelector('#denizen-pair-close');
    const copiedEl = modalEl.querySelector('#denizen-pair-copied');

    const onOpen = () => {
      try {
        window.location.href = deepLink;
      } catch (err) {
        const errEl = modalEl.querySelector('#denizen-pair-error');
        if (errEl) {
          errEl.textContent = err?.message || 'Could not open Denizen Desktop';
          errEl.hidden = false;
        }
      }
    };

    const onCopy = async () => {
      const ok = await copyText(deepLink);
      if (copiedEl) {
        copiedEl.textContent = ok ? 'Link copied — paste into Denizen Desktop if the app did not open.' : 'Copy failed — select and copy manually.';
        copiedEl.style.color = ok ? '#4ade80' : '#f87171';
      }
    };

    openBtn?.addEventListener('click', onOpen);
    copyBtn?.addEventListener('click', () => { onCopy().catch(() => null); });
    closeBtn?.addEventListener('click', closeModal);

    if (globalThis.DenizenTouchBind?.bindPress) {
      if (openBtn) globalThis.DenizenTouchBind.bindPress(openBtn, onOpen, { stop: true });
      if (copyBtn) globalThis.DenizenTouchBind.bindPress(copyBtn, () => { onCopy().catch(() => null); }, { stop: true });
      if (closeBtn) globalThis.DenizenTouchBind.bindPress(closeBtn, closeModal, { stop: true });
    }

    startStatusPoll();
  }

  function showPairingError(message) {
    injectStyles();
    closeModal();

    modalEl = document.createElement('div');
    modalEl.id = MODAL_ID;
    modalEl.innerHTML = `
      <div class="pair-card">
        <h2>Link Denizen Desktop</h2>
        <p class="pair-error" id="denizen-pair-error">${String(message || 'Pairing failed').replace(/</g, '&lt;')}</p>
        <div class="pair-actions">
          <button type="button" class="pair-btn close" id="denizen-pair-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    document.documentElement.dataset.denizenModal = 'open';
    try {
      if (window.game?.input) window.game.input.enabled = false;
    } catch (_) {}

    const closeBtn = modalEl.querySelector('#denizen-pair-close');
    closeBtn?.addEventListener('click', closeModal);
    if (globalThis.DenizenTouchBind?.bindPress && closeBtn) {
      globalThis.DenizenTouchBind.bindPress(closeBtn, closeModal, { stop: true });
    }
  }

  async function createPairingLink() {
    const api = getSessionApi();
    if (api?.init) {
      await api.init().catch(() => null);
    }
    const sid = api?.getSessionId?.();
    if (!sid) {
      const err = new Error('Session not ready — finish sign-in first.');
      showPairingError(err.message);
      throw err;
    }
    try {
      const data = await requestPairingCreate();
      const token = data.token || data.pairing_token;
      if (!token) throw new Error('Pairing token missing from server response');
      const serverUrl = data.server_url || data.server || window.location.origin;
      const deepLink = data.deep_link || data.pairing_url || buildDeepLink(token, serverUrl);
      const pairing = {
        token,
        serverUrl,
        deepLink,
        expiresAt: data.expires_at || data.expires_in || null,
      };
      showPairingModal(pairing);
      return pairing;
    } catch (err) {
      const normalized = normalizeFetchError(err);
      showPairingError(normalized.message);
      throw normalized;
    }
  }

  globalThis.DenizenDesktopPairing = {
    createPairingLink,
    closeModal,
  };
})();
