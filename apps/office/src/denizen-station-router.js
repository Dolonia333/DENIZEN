'use strict';

const desktopPermissionBridge = require('./desktop-permission-bridge');
const stationCapabilities = require('./denizen-station-capabilities');
const stationTaskQueue = require('./denizen-station-task-queue');
const desktopLink = require('./denizen-desktop-link');

async function resolveSessionContext(sessionId) {
  if (!sessionId) return { identity: null, profile: null };
  try {
    const userIdentity = require('./denizen-user-identity');
    const identity = await userIdentity.getIdentityBySession(sessionId);
    if (!identity?.id) return { identity: null, profile: null };
    const profile = await desktopLink.getProfileByIdentity(identity.id);
    return { identity, profile };
  } catch (_) {
    return { identity: null, profile: null };
  }
}

function shouldRouteToStation(profile) {
  return !!(
    profile?.desktop_install_id
    && profile?.setup_wizard_completed
    && profile?.client_type === 'desktop'
    && stationCapabilities.stationIsOnline(profile)
  );
}

async function routeOrRunHost({
  sessionId,
  npcName,
  kind,
  skill,
  instruction,
  payload = {},
  permissionLevel = null,
  broadcast = () => {},
  hostRunner,
  waitTimeoutMs,
} = {}) {
  const { profile } = await resolveSessionContext(sessionId);
  const stationLinked = !!(
    profile?.desktop_install_id
    && profile?.setup_wizard_completed
    && profile?.client_type === 'desktop'
  );

  let capCheck = { ok: true, capability: null };
  if (stationLinked) {
    capCheck = stationCapabilities.assertCapability(profile, null, { skill, kind });
    if (!capCheck.ok) {
      return {
        ok: false,
        denied: true,
        routed: false,
        reason: 'capability_off',
        summary: capCheck.error,
        error: capCheck.error,
      };
    }
  }

  let level = permissionLevel;
  if (!level && sessionId) {
    level = await desktopPermissionBridge.resolvePermissionLevelForSession(sessionId);
  }
  if (!level) level = 'trusted';

  const taskPreview = String(instruction || payload?.path || '').slice(0, 240);
  const approval = desktopPermissionBridge.requestDesktopApprovalIfNeeded({
    sessionId,
    npcName,
    capability: skill || kind,
    detail: taskPreview,
    permissionLevel: level,
    profile: stationLinked ? profile : null,
    requiredCapability: stationLinked ? capCheck.capability : null,
  });

  if (!approval.pending && !approval.approved) {
    const deniedMsg = approval.reason === 'permission_off' || approval.reason === 'capability_off'
      ? (approval.message || 'Desktop agent is off for this station. Enable it in the Denizen desktop app.')
      : 'Desktop action was not approved.';
    return { ok: false, denied: true, routed: false, reason: approval.reason, summary: deniedMsg, error: deniedMsg };
  }

  if (approval.pending) {
    if (typeof broadcast === 'function') {
      broadcast({
        type: 'desktop_permission_pending',
        npcName,
        requestId: approval.requestId,
        detail: taskPreview,
        ts: Date.now(),
      });
    }
    try {
      const decision = await desktopPermissionBridge.waitForDesktopApproval(
        sessionId,
        approval.requestId,
      );
      if (!decision?.approved) {
        return {
          ok: false,
          denied: true,
          routed: false,
          reason: 'rejected',
          summary: 'You declined the desktop action.',
        };
      }
    } catch (err) {
      return {
        ok: false,
        denied: true,
        routed: false,
        reason: 'timeout',
        summary: err?.message || 'Permission request timed out.',
      };
    }
  }

  if (shouldRouteToStation(profile)) {
    const enqueued = await stationTaskQueue.enqueueTask({
      sessionId,
      installId: profile.desktop_install_id,
      kind,
      skill,
      npcName,
      instruction,
      payload,
    });

    if (!enqueued?.queued) {
      const busyMsg = 'Your Denizen station is busy with another task. Try again in a moment.';
      return { ok: false, routed: true, reason: 'station_busy', summary: busyMsg, error: busyMsg };
    }

    if (typeof broadcast === 'function') {
      broadcast({
        type: 'station_task_enqueued',
        npcName,
        taskId: enqueued.task.id,
        kind,
        installId: profile.desktop_install_id,
        ts: Date.now(),
      });
    }

    try {
      const completed = await stationTaskQueue.waitForTask(enqueued.task.id, { timeoutMs: waitTimeoutMs });
      const result = completed?.result || {};
      return {
        ok: !!result.ok,
        routed: true,
        taskId: enqueued.task.id,
        summary: result.summary || result.output || result.error || 'Station task finished.',
        result,
        screenshot: result.screenshot || result.screenshotB64 || null,
        topics: result.topics || [],
        searchQuery: result.searchQuery || null,
      };
    } catch (err) {
      return {
        ok: false,
        routed: true,
        reason: 'timeout',
        summary: err?.message || 'Station task timed out.',
        error: err?.message,
      };
    }
  }

  if (stationLinked) {
    const offlineMsg = 'Your Denizen desktop app is offline. Open Denizen on this computer to run local tasks.';
    return { ok: false, routed: false, reason: 'station_offline', summary: offlineMsg, error: offlineMsg };
  }

  if (typeof hostRunner !== 'function') {
    const offlineMsg = 'Pair Denizen Desktop on this computer to run local tasks.';
    return { ok: false, routed: false, reason: 'station_offline', summary: offlineMsg, error: offlineMsg };
  }

  return hostRunner();
}

module.exports = {
  resolveSessionContext,
  shouldRouteToStation,
  routeOrRunHost,
};
