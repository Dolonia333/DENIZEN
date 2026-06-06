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
    return !!globalThis.__DenizenCeoMode;
  }

  function isDemo() {
    if (isCeo()) return false;
    return !!sess()?.isDemo?.();
  }

  function isTeam() {
    if (isCeo()) return true;
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
