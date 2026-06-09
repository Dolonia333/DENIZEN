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

  function nodeState() {
    return globalThis.DenizenNodeUI?.getState?.() || {};
  }

  function isHostNode() {
    return !!nodeState().isHostNode;
  }

  function isDesktopLinked() {
    const s = nodeState();
    if (s.desktopLinked) return true;
    const st = String(s.contributorState || '');
    return st === 'desktop_linked' || st === 'host' || st === 'desktop_setup_pending';
  }

  /** Account has paired Denizen Desktop (or is host/CEO) — full dashboard even on web. */
  function hasDesktopIdentity() {
    if (isCeo()) return true;
    if (isHostNode()) return true;
    return isDesktopLinked();
  }

  /** Team user browsing without Desktop paired — compact dashboard + upgrade prompts. */
  function isBrowserOnlyWeb() {
    if (isDemo()) return true;
    if (!isTeam() && !isCeo()) return true;
    return !hasDesktopIdentity();
  }

  function canSeeMeshDashboard() {
    return hasDesktopIdentity();
  }

  function canSeeOperatorTelemetry() {
    return hasDesktopIdentity();
  }

  function canSeeFullComputePanel() {
    return hasDesktopIdentity();
  }

  function shouldPromptDesktopUpgrade() {
    return isTeam() && !isDemo() && isBrowserOnlyWeb();
  }

  function canUseOperatorPanels() {
    return canSeeOperatorTelemetry();
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

  function canApproveSkills() {
    if (isCeo()) return true;
    const profile = sess()?.getProfile?.() || {};
    return profile.canApproveSkills === true || profile.teamRole === 'admin' || profile.teamRole === 'owner';
  }

  function isContributor() {
    const s = nodeState();
    if (s.optedIn || s.contributing) return true;
    return String(s.contributionLevel || 'off') !== 'off' && isDesktopLinked();
  }

  function isMeshSuperNode() {
    return !!nodeState().isSuperNode;
  }

  function canContributeToMesh() {
    const s = nodeState();
    return !!s.canContribute || isDesktopLinked();
  }

  function clientModeLabel() {
    if (isCeo()) return 'CEO / host';
    if (hasDesktopIdentity()) return 'Desktop linked';
    if (isTeam()) return 'Browser';
    return 'Demo';
  }

  globalThis.DenizenVisitorCapabilities = {
    isDemo,
    isTeam,
    isCeo,
    hasDesktopIdentity,
    isBrowserOnlyWeb,
    canSeeMeshDashboard,
    canSeeOperatorTelemetry,
    canSeeFullComputePanel,
    shouldPromptDesktopUpgrade,
    clientModeLabel,
    canUseOperatorPanels,
    canHandoffToCeo,
    canUseRealTools,
    canUseBriefingPanel,
    canApproveSkills,
    nodeState,
    isDesktopLinked,
    isHostNode,
    isContributor,
    isMeshSuperNode,
    canContributeToMesh,
  };
})();
