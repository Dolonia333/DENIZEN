/**
 * Spectate routing — optional separate WebSocket origin for watch-only viewers.
 * Load before chat-bootstrap.js. Reads /api/public/runtime-config.
 *
 * Primary site (denizen.dolonia.cloud) uses same-origin /agent-ws for full chat.
 * Spectate hostnames (spectate.dolonia.cloud) or ?spectate=1 use the follower relay.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const forceSpectate = params.get('spectate') === '1' || params.get('ws') === 'spectate';
  const forcePrimary = params.get('ws') === 'primary';

  let config = null;
  let configPromise = null;

  function isSpectateHostname() {
    const host = String(window.location.hostname || '').toLowerCase();
    return host === 'spectate.dolonia.cloud'
      || host === 'spectate2.dolonia.cloud'
      || host.startsWith('spectate.');
  }

  function shouldUseSpectateRelay() {
    if (forcePrimary) return false;
    return forceSpectate || isSpectateHostname();
  }

  function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = fetch('/api/public/runtime-config', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        config = data && typeof data === 'object' ? data : {};
        return config;
      })
      .catch(() => {
        config = {};
        return config;
      });
    return configPromise;
  }

  function resolveAgentWsUrl() {
    if (forcePrimary || !shouldUseSpectateRelay()) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/agent-ws`;
    }
    const paramsSpectate = params.get('spectate_ws');
    if (paramsSpectate) return paramsSpectate;
    const publicSpectate = config?.spectateWsUrl;
    const pool = Array.isArray(config?.spectateWsUrls) ? config.spectateWsUrls.filter(Boolean) : [];
    if (pool.length > 1) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    if (publicSpectate) return publicSpectate;
    const lanSpectate = config?.spectateLanUrl;
    if (lanSpectate) return lanSpectate;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/agent-ws`;
  }

  globalThis.DenizenSpectateRouting = {
    loadConfig,
    resolveAgentWsUrl,
    isSpectateHostname,
    shouldUseSpectateRelay,
    isSpectateMode() {
      if (forcePrimary) return false;
      if (!shouldUseSpectateRelay()) return false;
      const pool = Array.isArray(config?.spectateWsUrls) ? config.spectateWsUrls.filter(Boolean) : [];
      return !!(config?.spectateWsUrl || pool.length || config?.spectateLanUrl);
    },
    getConfig() {
      return config ? { ...config } : null;
    },
  };

  loadConfig().then(() => {
    if (globalThis.DenizenSpectateRouting.isSpectateMode()) {
      document.documentElement.classList.add('denizen-spectate-routing');
    }
  }).catch(() => {});
})();
