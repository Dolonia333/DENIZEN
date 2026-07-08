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
    globalThis.DenizenBottomDock?.refresh?.();
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
        './src/visitors/visitor-capabilities.js?v=vis4',
        './src/visitors/visitor-dashboard-gate.js?v=dgate1',
        './src/voice/proximity-audio.js?v=audio3',
        './src/voice/voice-gate.js?v=audio3',
      ]);
      await loadParallel([
        './src/voice/denizen-voice-playback.js?v=vc1',
        './src/voice/denizen-voice-session.js?v=vc1',
        './src/voice/denizen-voice-call-ui.js?v=vc1',
        './src/voice/elevenlabs-provider.js',
        './src/voice/sfx.js',
        './src/voice/voice-input.js?v=voiceicon2',
        './src/hud/panels/llm-telemetry-panel.js?v=lmfix9',
        './src/hud/panels/mesh-jobs-panel.js?v=mesh3',
        './src/hud/panels/browser-mirror-panel.js?v=lucymirror6',
        './src/hud/diag.js?v=diag3',
        './src/security/security-feed.js?v=sec2',
      ]);
      await loadParallel([
        './src/visitors/visitor-desktop-pairing.js?v=pair3',
        './src/visitors/visitor-credits-chip.js?v=node7',
        './src/tabler-icons.js?v=ti3',
        './src/office-hq/office-level-chip.js?v=lvl3',
        './src/office-hq/office-hq-panel.js?v=hq3',
        './src/visitors/visitor-handoff-ui.js?v=vis4',
        './src/visitors/visitor-projects-ui.js?v=vis3',
        './src/visitors/visitor-assistant-labels.js?v=vis3',
        './src/security/bouncer-client-init.js?v=sec3',
        './src/security/security-monitor.js?v=sec3',
        './src/security/robber-controller.js?v=sec3',
        './src/hud/work-feed.js?v=feed2',
        './src/hud/panels/content-pipeline-panel.js?v=cp3',
      ]);
      finishDeferred();
    })();

    return deferredDone;
  }

  function afterOffice() {
    const urls = [
      './src/visitors/visitor-companion-bridge.js?v=comp1',
      './src/visitors/visitor-mcp-connect-ui.js?v=mcp8bridge',
      './src/visitors/visitor-briefing-ui.js?v=vis3',
      './src/visitors/visitor-voice-walkup.js?v=vis3',
      './src/visitors/visitor-skill-gap-ui.js?v=sgap1',
      './src/visitors/visitor-agent-inbox.js?v=ainbox1',
      './src/hud/mesh-alert-toast.js?v=mtoast2',
      './src/hud/panels/proposals-panel.js?v=propfix9',
      './src/city/city-debug.js',
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
