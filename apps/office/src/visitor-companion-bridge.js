/**
 * Bridge Denizen office → Companion browser extension.
 * Saves NPC sync credentials to sessionStorage and dispatches a DOM event.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'denizen.companion.v1';

  function saveCredentials(payload, displayName) {
    if (!payload?.token || !payload?.npc_key) return null;
    const creds = {
      baseUrl: window.location.origin,
      npcKey: payload.npc_key,
      displayName: displayName || payload.npc_key,
      token: payload.token,
      mcpUrl: payload.mcp_url || null,
      restSync: payload.rest_sync || null,
      savedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    } catch (_) { /* private mode */ }
    document.documentElement.dataset.denizenCompanion = 'ready';
    window.dispatchEvent(new CustomEvent('denizen:companion-credentials', { detail: creds }));
    return creds;
  }

  function getCredentials() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearCredentials() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    delete document.documentElement.dataset.denizenCompanion;
  }

  globalThis.DenizenCompanionBridge = {
    STORAGE_KEY,
    saveCredentials,
    getCredentials,
    clearCredentials,
  };
})();
