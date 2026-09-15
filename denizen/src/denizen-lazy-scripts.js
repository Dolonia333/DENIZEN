/**
 * denizen-lazy-scripts.js — defer heavy UI until Phaser can start.
 */
(function () {
  'use strict';

  const loaded = new Set();
  let deferredStarted = false;
  let deferredDone = null;

  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    loaded.add(src);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  async function loadParallel(urls) {
    await Promise.all(urls.map(loadScript));
  }

  async function loadAll(urls) {
    for (const u of urls) await loadScript(u);
  }

  function initDeferredSceneFeatures() {
    const scene = globalThis.__DenizenScene || globalThis.game?.scene?.scenes?.[0];
    if (!scene) return;
    if (typeof globalThis.initBouncerSecurity === 'function') {
      globalThis.initBouncerSecurity(scene);
    } else if (!scene._securityMonitor && globalThis.SecurityMonitor && globalThis.RobberController) {
      scene._securityMonitor = new globalThis.SecurityMonitor();
      scene._robberCtrl = new globalThis.RobberController(scene, scene._securityMonitor);
      scene._robberCtrl.init();
      scene._securityMonitor.connect();
      console.log('[LazyScripts] Security Monitor + Robber Controller initialized (deferred)');
    }
    if (!scene._workFeed && globalThis.WorkFeedPanel) {
      scene._workFeed = new globalThis.WorkFeedPanel(scene);
    }
  }

  function finishDeferred() {
    initDeferredSceneFeatures();
    globalThis.DenizenMobileSidebar?.relayout?.();
    globalThis.DenizenVisitorMcpConnectUI?.attach?.();
    try {
      document.dispatchEvent(new CustomEvent('denizen-deferred-scripts-ready'));
    } catch (_) {}
  }

  /** Heavy panels + audio — kicked off when office-scene.js loads (parallel with Phaser preload). */
  function loadDeferred() {
    if (deferredStarted) return deferredDone || Promise.resolve();
    deferredStarted = true;

    deferredDone = (async () => {
      await loadParallel([
        './src/visitor-capabilities.js?v=vis4',
        './src/visitor-dashboard-gate.js?v=nodock1',
        './src/proximity-audio.js?v=nodock1',
        './src/voice-gate.js?v=audio2',
      ]);
      await loadParallel([
        './src/denizen-voice-playback.js?v=vc1',
        './src/denizen-voice-session.js?v=vc1',
        './src/denizen-voice-call-ui.js?v=vc1',
        './src/elevenlabs-provider.js',
        './src/sfx.js?v=always1',
        './src/voice-input.js?v=nodock1',
        './src/llm-telemetry-panel.js?v=nodock1',
        './src/mesh-jobs-panel.js?v=nodock1',
        './src/browser-mirror-panel.js?v=nodock1',
        './src/diag.js?v=nodock1',
        './src/security-feed.js?v=nodock1',
      ]);
      await loadParallel([
        './src/tabler-icons.js?v=ti1',
        './src/office-hq/office-level-chip.js?v=lvl4',
        './src/office-hq/office-hq-panel.js?v=hq2',
        './src/visitor-desktop-pairing.js?v=pair3',
        './src/visitor-credits-chip.js?v=node7',
        './src/visitor-handoff-ui.js?v=vis3',
        './src/visitor-projects-ui.js?v=vis3',
        './src/visitor-assistant-labels.js?v=noStroke1',
        './src/bouncer-client-init.js?v=sec3',
        './src/security-monitor.js?v=sec3',
        './src/robber-controller.js?v=sec3',
        './src/work-feed.js?v=feed4dedupe',
        './src/content-pipeline-panel.js?v=nodock1',
      ]);
      finishDeferred();
    })();

    return deferredDone;
  }

  function afterOffice() {
    const urls = [
      './src/visitor-companion-bridge.js?v=comp1',
      './src/visitor-mcp-connect-ui.js?v=mcp8bridge',
      './src/visitor-briefing-ui.js?v=vis3',
      './src/visitor-voice-walkup.js?v=vis3',
      './src/visitor-skill-gap-ui.js?v=sgap1',
      './src/visitor-agent-inbox.js?v=ainbox1',
      './src/mesh-alert-toast.js?v=mtoast2',
      './src/proposals-panel.js?v=nodock1',
      './src/city-debug.js',
    ];
    try {
      if (new URL(window.location.href).searchParams.get('demo')) {
        urls.push('./src/demo-scene.js');
      }
    } catch (_) {}
    return loadDeferred()
      .then(() => loadAll(urls))
      .then(finishDeferred);
  }

  globalThis.DenizenLazyScripts = {
    load: loadAll,
    loadDeferred,
    afterOffice,
  };
})();
