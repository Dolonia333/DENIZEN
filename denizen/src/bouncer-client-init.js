(function () {
  'use strict';

  function injectGatewayThreats(scene, securityMonitor) {
    if (!scene?._gatewayBridge || scene._bouncerGatewayThreatHooked) return;
    if (typeof scene._gatewayBridge.addEventListener !== 'function') return;

    scene._gatewayBridge.addEventListener('gateway-event', (evt) => {
      const { event, payload } = evt.detail || {};
      if (event !== 'agent' || !payload) return;

      if (payload.stream === 'tool' && payload.data) {
        const toolName = (payload.data.name || '').toLowerCase();
        const dangerTools = ['bash', 'shell', 'exec', 'eval', 'rm', 'del'];
        if (dangerTools.some((t) => toolName.includes(t))) {
          securityMonitor.injectThreat({
            category: 'shell_exec',
            severity: 'high',
            source: `agent:${payload.agentId || 'unknown'}`,
            target: toolName,
            detail: `Agent executing: ${toolName}`,
          });
        }
      }
    });

    scene._bouncerGatewayThreatHooked = true;
  }

  function initBouncerSecurity(scene) {
    if (!scene) return null;
    if (scene._securityMonitor) return scene._securityMonitor;
    if (!globalThis.SecurityMonitor || !globalThis.RobberController) return null;

    const monitor = new globalThis.SecurityMonitor();
    const robberCtrl = new globalThis.RobberController(scene, monitor);

    scene._securityMonitor = monitor;
    scene._robberCtrl = robberCtrl;

    robberCtrl.init();
    monitor.connect();
    injectGatewayThreats(scene, monitor);
    console.log('[BouncerInit] Security Monitor + Robber Controller initialized');
    return monitor;
  }

  globalThis.initBouncerSecurity = initBouncerSecurity;
})();
