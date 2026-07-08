'use strict';

const desktopPermissions = require('./denizen-desktop-permissions');
const stationCapabilities = require('./denizen-station-capabilities');

const VALID_LEVELS = new Set(['off', 'ask', 'trusted']);

function normalizeLevel(level) {
  const value = String(level || 'off').trim().toLowerCase();
  return VALID_LEVELS.has(value) ? value : 'off';
}

async function resolvePermissionLevelForSession(sessionId) {
  if (!sessionId) return null;
  try {
    const userIdentity = require('./denizen-user-identity');
    const desktopLink = require('./denizen-desktop-link');
    const identity = await userIdentity.getIdentityBySession(sessionId);
    const identityId = identity?.id || `session:${sessionId}`;
    const profile = await desktopLink.getProfileByIdentity(identityId);
    return normalizeLevel(profile?.agent_permission_level);
  } catch (_) {
    return 'off';
  }
}

/**
 * Enqueue a desktop approval prompt when permission level is 'ask'.
 * @returns {{ pending: boolean, approved?: boolean, requestId?: string, reason?: string }}
 */
async function resolveProfileForSession(sessionId) {
  if (!sessionId) return null;
  try {
    const userIdentity = require('./denizen-user-identity');
    const desktopLink = require('./denizen-desktop-link');
    const identity = await userIdentity.getIdentityBySession(sessionId);
    if (!identity?.id) return null;
    return desktopLink.getProfileByIdentity(identity.id);
  } catch (_) {
    return null;
  }
}

function requestDesktopApprovalIfNeeded({
  sessionId,
  npcName,
  capability = 'desktop-agent',
  detail = '',
  permissionLevel = 'off',
  profile = null,
  requiredCapability = null,
} = {}) {
  const level = normalizeLevel(permissionLevel);

  const capKey = requiredCapability
    || stationCapabilities.capabilityForSkill(capability)
    || null;
  const profileCaps = profile || null;
  if (capKey && profileCaps) {
    const capCheck = stationCapabilities.assertCapability(profileCaps, capKey);
    if (!capCheck.ok) {
      return {
        pending: false,
        approved: false,
        reason: 'capability_off',
        message: capCheck.error,
      };
    }
  }

  if (level === 'off') {
    return { pending: false, approved: false, reason: 'permission_off' };
  }
  if (level === 'trusted') {
    return { pending: false, approved: true };
  }

  // ask mode — no session means no desktop client to poll; allow legacy/local CEO path.
  if (!sessionId) {
    return { pending: false, approved: true };
  }

  const entry = desktopPermissions.requestPermission(sessionId, {
    title: `${npcName || 'Denizen'} wants to use your PC`,
    detail: String(detail || '').slice(0, 500),
    capability: String(capability || 'action'),
    npc: npcName || null,
    action: String(detail || '').slice(0, 240) || null,
  });
  if (!entry?.id) {
    return { pending: false, approved: false, reason: 'enqueue_failed' };
  }
  return { pending: true, requestId: entry.id };
}

function waitForDesktopApproval(sessionId, requestId, opts = {}) {
  return desktopPermissions.waitForResponse(sessionId, requestId, opts);
}

module.exports = {
  requestDesktopApprovalIfNeeded,
  resolvePermissionLevelForSession,
  resolveProfileForSession,
  waitForDesktopApproval,
  normalizeLevel,
};
