'use strict';

/**
 * Per-office NPC think context — each identity owns an office; NPCs serve that CEO only.
 */
const npcRoster = require('./npc-roster');
const {
  CEO_OFFICE_ID,
  lucyRoleForOffice,
  isLucyCeoInOffice,
} = require('./visitor-office-registry');

const TEAM_CACHE_MS = 45_000;
const _teamCache = new Map();

function npcKeyToDisplay(npcKey) {
  const key = String(npcKey || '').trim().toLowerCase();
  const entry = (npcRoster.entries || []).find((e) => e.folder === key);
  return entry?.display || key;
}

function displayToNpcKey(displayName) {
  const name = String(displayName || '').trim();
  const entry = (npcRoster.entries || []).find(
    (e) => e.display.toLowerCase() === name.toLowerCase() || e.folder === name.toLowerCase(),
  );
  return entry?.folder || name.toLowerCase();
}

async function loadTeamBundle(identityId, deps) {
  if (!identityId || !deps?.userIdentity?.getNpcTeam) return null;
  const cached = _teamCache.get(identityId);
  if (cached && Date.now() - cached.at < TEAM_CACHE_MS) return cached.team;
  try {
    const team = await deps.userIdentity.getNpcTeam(identityId);
    _teamCache.set(identityId, { at: Date.now(), team });
    return team;
  } catch (_) {
    return null;
  }
}

function buildMemberOverlay(member, visitorDisplayName) {
  if (!member) return '';
  const lines = [];
  if (visitorDisplayName) {
    lines.push(`${visitorDisplayName} is the CEO of this office — serve their priorities first.`);
  }
  if (member.display_name) lines.push(`This teammate calls you ${member.display_name}.`);
  if (member.role) lines.push(`Your role for them: ${member.role}.`);
  if (member.job) lines.push(`Current job assignment: ${member.job}.`);
  if (member.focus) lines.push(`Focus area: ${member.focus}`);
  if (member.instructions) {
    lines.push('Follow these teammate instructions (seed for your SOUL/MEMORY growth):');
    lines.push(member.instructions);
  }
  return lines.length
    ? `\n\n## Teammate NPC profile\n${lines.join('\n')}`
    : '';
}

function buildPurposeOverlay(team, visitorDisplayName, isOperatorOffice) {
  if (!team) return '';
  const lines = [];
  if (isOperatorOffice) {
    lines.push('Operator office — company host principal.');
  } else if (visitorDisplayName) {
    lines.push(`CEO: ${visitorDisplayName} (this is their virtual company office).`);
  }
  if (team.name) lines.push(`Team: ${team.name}`);
  if (team.purpose) lines.push(`Mission: ${team.purpose}`);
  const roster = (team.members || [])
    .filter((m) => m.active !== false)
    .map((m) => m.display_name || m.npc_key)
    .slice(0, 10);
  if (roster.length) lines.push(`Roster: ${roster.join(', ')}`);
  return lines.length
    ? `\n\n## Office mission\n${lines.join('\n')}`
    : '';
}

function buildLucyOfficeOverlay(npcKey, isOperatorOffice) {
  if (npcKey !== 'lucy') return '';
  return `\n\n## Lucy role in this office\n${lucyRoleForOffice(isOperatorOffice)}`;
}

/**
 * Load think context for one office only (no cross-office winner picking).
 */
async function resolveOfficeThinkContext(officeId, npcNameOrKey, deps, base = {}) {
  const npcKey = displayToNpcKey(npcNameOrKey);
  if (!officeId || officeId === CEO_OFFICE_ID) {
    const isOperator = base.isOperatorOffice !== false;
    return {
      ...base,
      officeId: CEO_OFFICE_ID,
      visitorScoped: false,
      isOperatorOffice: isOperator,
      lucyIsCeo: isLucyCeoInOffice(isOperator),
      teamMemberOverlay: buildLucyOfficeOverlay(npcKey, isOperator),
      teamPurposeOverlay: isOperator
        ? '\n\n## Office mission\nHost operator company HQ — Lucy leads operations.'
        : '',
    };
  }

  const identityId = officeId.startsWith('session:') ? null : officeId;
  let session = null;
  let access = null;

  if (base.visitorSessionId && deps?.denizenVisitor?.getSession) {
    try {
      session = await deps.denizenVisitor.getSession(base.visitorSessionId);
      access = await deps.visitorAccess.resolveSessionAccess(base.visitorSessionId);
    } catch (_) {}
  }

  if (!session && identityId && deps?.listOnlineSessionIds) {
    for (const sid of deps.listOnlineSessionIds()) {
      try {
        const s = await deps.denizenVisitor.getSession(sid);
        if (s?.identity_id === identityId) {
          session = s;
          access = await deps.visitorAccess.resolveSessionAccess(sid);
          break;
        }
      } catch (_) {}
    }
  }

  const isOperatorOffice = !!(
    base.isOperatorOffice
    || session?.metadata?.is_ceo_principal
  );

  const team = identityId ? await loadTeamBundle(identityId, deps) : null;
  const member = (team?.members || []).find(
    (m) => String(m.npc_key).toLowerCase() === npcKey && m.active !== false,
  );

  const canUseRealWork = session && deps?.visitorAccess?.canUseRealWork
    ? deps.visitorAccess.canUseRealWork(
      access?.session?.metadata || { tier: access?.tier },
      access?.org?.settings || {},
    )
    : base.canUseRealWork;

  const displayName = session?.display_name || base.visitorDisplayName || 'Guest';
  const onTeam = !!member || npcKey === 'lucy';

  return {
    ...base,
    officeId,
    identityId: identityId || session?.identity_id || null,
    visitorSessionId: session?.id || base.visitorSessionId || null,
    visitorDisplayName: displayName,
    sessionTier: access?.tier || base.sessionTier,
    canUseRealWork,
    visitorScoped: onTeam && npcKey !== 'lucy' || (npcKey === 'lucy' && !isOperatorOffice),
    priorityVisitor: !!session,
    isOperatorOffice,
    lucyIsCeo: isLucyCeoInOffice(isOperatorOffice),
    teamMemberOverlay: buildMemberOverlay(member, displayName) + buildLucyOfficeOverlay(npcKey, isOperatorOffice),
    teamPurposeOverlay: buildPurposeOverlay(team, displayName, isOperatorOffice),
  };
}

async function enrichThinkContext(npcNameOrKey, baseContext = {}, deps) {
  const officeId = baseContext.officeId || baseContext.identityId || null;
  if (!officeId) {
    return { ...baseContext, visitorScoped: false, officeId: CEO_OFFICE_ID };
  }
  return resolveOfficeThinkContext(officeId, npcNameOrKey, deps, baseContext);
}

async function wakeVisitorTeam(sessionId, deps) {
  if (!sessionId || !deps?.npcThinkRunner?.wake) return;

  let session = null;
  try {
    session = await deps.denizenVisitor.getSession(sessionId);
  } catch (_) {
    return;
  }
  const officeId = session?.identity_id || `session:${sessionId}`;
  if (!session?.identity_id) return;

  const team = await loadTeamBundle(session.identity_id, deps);
  const members = (team?.members || []).filter((m) => m.active !== false);
  if (!members.length) return;

  let delay = 500;
  for (const member of members) {
    const npcName = npcKeyToDisplay(member.npc_key);
    if (!npcName) continue;
    deps.npcThinkRunner.wake(npcName, 'visitor_online', {
      delayMs: delay,
      officeId,
      visitorSessionId: sessionId,
      identityId: session.identity_id,
      isOperatorOffice: !!session.metadata?.is_ceo_principal,
    });
    delay += 1400;
  }
}

function clearTeamCache(identityId) {
  if (identityId) _teamCache.delete(identityId);
  else _teamCache.clear();
}

module.exports = {
  enrichThinkContext,
  resolveOfficeThinkContext,
  wakeVisitorTeam,
  clearTeamCache,
  npcKeyToDisplay,
  displayToNpcKey,
  buildMemberOverlay,
  buildPurposeOverlay,
};
