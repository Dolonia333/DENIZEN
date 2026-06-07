'use strict';

/**
 * Browser helper — what UI/features a visitor tier may show.
 * Attach to globalThis.DenizenVisitorCapabilities in visitor-session.js
 */
(function () {
  'use strict';

  function sess() {
    return globalThis.DenizenVisitorSession || null;
  }

  function isCeo() {
    return !!sess()?.isCeoPrincipal?.();
  }

  function isDemo() {
    return !!sess()?.isDemo?.();
  }

  function isTeam() {
    return !!sess()?.isTeam?.();
  }

  function canUseOperatorPanels() {
    return isTeam() || isCeo();
  }

  function canHandoffToCeo() {
    return isTeam() || isCeo();
  }

  function canUseRealTools() {
    return isTeam() || isCeo();
  }

  function canUseBriefingPanel() {
    return isTeam() || isCeo();
  }

  globalThis.DenizenVisitorCapabilities = {
    isDemo,
    isTeam,
    isCeo,
    canUseOperatorPanels,
    canHandoffToCeo,
    canUseRealTools,
    canUseBriefingPanel,
  };
})();
