/**
 * denizen-lazy-scripts.js — load non-critical UI after the office scene is interactive.
 * Keeps initial HTML parse / download smaller so Phaser can start sooner.
 */
(function () {
  'use strict';

  const loaded = new Set();

  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    loaded.add(src);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  async function loadAll(urls) {
    for (const u of urls) await loadScript(u);
  }

  function afterOffice() {
    const urls = [
      './src/visitor-mcp-connect-ui.js?v=mcp1',
      './src/visitor-briefing-ui.js?v=vis3',
      './src/visitor-voice-walkup.js?v=vis3',
      './src/proposals-panel.js?v=mobbtn1',
      './src/city-debug.js',
    ];
    try {
      if (new URL(window.location.href).searchParams.get('demo')) {
        urls.push('./src/demo-scene.js');
      }
    } catch (_) {}
    return loadAll(urls).then(() => {
      globalThis.DenizenVisitorMcpConnectUI?.attach?.();
    });
  }

  window.DenizenLazyScripts = {
    load: loadAll,
    afterOffice,
  };
})();
