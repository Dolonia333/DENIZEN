'use strict';

/**
 * Visitor session + personal assistant claims (Supabase / PostgREST).
 */

const denizenDb = require('./denizen-db.js');

const PROTECTED_NPC_KEYS = new Set(['abby', 'lucy', 'bouncer']);

class VisitorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VisitorError';
    this.code = code;
  }
}

function _ensureDb() {
  if (!denizenDb.enabled) {
    throw new VisitorError('DenizenDb disabled', 'DB_DISABLED');
  }
}

function getOrgContext() {
  return {
    orgId: denizenDb.orgId ?? null,
    orgSlug: denizenDb.orgSlug ?? null,
  };
}

async function listOrganizations() {
  _ensureDb();
  const rows = await denizenDb._get(
    'denizen_organizations?select=id,slug,display_name&order=display_name.asc',
  );
  return rows || [];
}

async function resolveOrgBySlug(slug) {
  _ensureDb();
  if (!slug || !String(slug).trim()) {
    throw new VisitorError('slug required', 'BAD_INPUT');
  }
  const rows = await denizenDb._getSoft(
    `denizen_organizations?select=id,slug,display_name,plan,settings&slug=eq.${encodeURIComponent(String(slug).trim())}&limit=1`,
  );
  return rows?.[0] || null;
}

function resolveNpcKey(input) {
  if (input == null || input === '') return null;
  return denizenDb.npcKey(String(input));
}

function _flattenAssistant(row) {
  if (!row) return null;
  const npc = row.denizen_npcs || {};
  return {
    npc_key: row.npc_key,
    display_name: npc.display_name ?? null,
    protected: npc.protected ?? false,
    claimable: npc.claimable ?? false,
    assistant_name: row.assistant_name ?? null,
    focus: row.focus ?? null,
    role_overlay: row.role_overlay ?? null,
    claimed_at: row.claimed_at ?? null,
  };
}

async function _mergeSessionMetadata(existing, incoming) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  return { ...base, ...next };
}

async function getSessionOrgId(sessionId) {
  if (!sessionId) return null;
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=org_id&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
  );
  return rows?.[0]?.org_id || null;
}

async function createOrUpdateSession({
  sessionId,
  displayName,
  metadata,
  orgId,
  sessionTokenHash,
  forceNewId,
} = {}) {
  _ensureDb();
  const now = new Date().toISOString();
  let session;
  const meta = metadata || {};
  let targetOrgId = orgId;
  if (!targetOrgId && meta.org_slug) {
    const org = await resolveOrgBySlug(meta.org_slug).catch(() => null);
    if (org?.id) targetOrgId = org.id;
  }

  if (sessionId && !forceNewId) {
    const existingRows = await denizenDb._get(
      `denizen_visitor_sessions?select=metadata,org_id&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
    );
    const existing = existingRows?.[0];
    const patch = { last_seen_at: now };
    if (displayName != null) patch.display_name = String(displayName).slice(0, 200);
    if (metadata != null) {
      patch.metadata = await _mergeSessionMetadata(existing?.metadata, metadata);
    }
    if (targetOrgId) patch.org_id = targetOrgId;
    if (sessionTokenHash) patch.session_token_hash = sessionTokenHash;
    const rows = await denizenDb._patch(
      `denizen_visitor_sessions?id=eq.${encodeURIComponent(sessionId)}`,
      patch,
      { prefer: 'return=representation' },
    );
    if (rows?.length) {
      session = rows[0];
    }
  }

  if (!session) {
    const row = {
      display_name: displayName != null ? String(displayName).slice(0, 200) : 'Guest',
      last_seen_at: now,
      metadata: meta,
    };
    if (targetOrgId) row.org_id = targetOrgId;
    if (sessionTokenHash) row.session_token_hash = sessionTokenHash;
    if (sessionId && !forceNewId) row.id = sessionId;
    const created = await denizenDb._post(
      'denizen_visitor_sessions',
      row,
      { prefer: 'return=representation' },
    );
    session = created?.[0] || null;
  }

  if (session?.id && targetOrgId) {
    await ensureOrgMembership(session.id, session.display_name || displayName, targetOrgId);
  }
  return session;
}

async function getOrCreateCeoBridgeSession() {
  _ensureDb();
  if (!denizenDb.orgId) {
    throw new VisitorError('Org not configured', 'DB_DISABLED');
  }
  const orgFilter = `org_id=eq.${encodeURIComponent(denizenDb.orgId)}`;
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=id&metadata->>bridge=eq.ceo&${orgFilter}&limit=1`,
  );
  if (rows?.[0]?.id) return rows[0].id;

  const now = new Date().toISOString();
  const created = await denizenDb._post(
    'denizen_visitor_sessions',
    {
      display_name: 'CEO Office',
      metadata: { bridge: 'ceo' },
      org_id: denizenDb.orgId,
      last_seen_at: now,
    },
    { prefer: 'return=representation' },
  );
  return created?.[0]?.id || null;
}

async function ensureOrgMembership(sessionId, displayName, orgId) {
  _ensureDb();
  const targetOrgId = orgId;
  if (!sessionId || !targetOrgId) return;

  await denizenDb._patch(
    `denizen_visitor_sessions?id=eq.${encodeURIComponent(sessionId)}`,
    { org_id: targetOrgId },
    { prefer: 'return=minimal' },
  );

  const existing = await denizenDb._get(
    `denizen_org_members?select=id&org_id=eq.${encodeURIComponent(targetOrgId)}&member_type=eq.visitor_session&member_id=eq.${encodeURIComponent(sessionId)}`,
  );
  if (existing?.length) return;

  await denizenDb._post(
    'denizen_org_members',
    {
      org_id: targetOrgId,
      member_type: 'visitor_session',
      member_id: sessionId,
      role: 'member',
    },
    { prefer: 'return=minimal' },
  );
}

async function listProjects(sessionId) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }
  const rows = await denizenDb._get(
    `denizen_user_projects?select=*&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.desc`,
  );
  return rows || [];
}

async function addProject(sessionId, { name, status, priority, notes } = {}) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }
  if (!name || !String(name).trim()) {
    throw new VisitorError('Project name required', 'BAD_INPUT');
  }
  const now = new Date().toISOString();
  const rows = await denizenDb._post(
    'denizen_user_projects',
    {
      session_id: sessionId,
      name: String(name).slice(0, 200),
      status: status ?? 'active',
      priority: priority ?? 'medium',
      notes: notes ?? null,
      updated_at: now,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function updateProject(projectId, sessionId, patch) {
  _ensureDb();
  if (!projectId || !sessionId) {
    throw new VisitorError('projectId and sessionId required', 'BAD_INPUT');
  }
  const body = { updated_at: new Date().toISOString() };
  if (patch?.name !== undefined) body.name = String(patch.name).slice(0, 200);
  if (patch?.status !== undefined) body.status = patch.status;
  if (patch?.priority !== undefined) body.priority = patch.priority;
  if (patch?.notes !== undefined) body.notes = patch.notes;

  const rows = await denizenDb._patch(
    `denizen_user_projects?id=eq.${encodeURIComponent(projectId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    body,
    { prefer: 'return=representation' },
  );
  if (!rows?.length) {
    throw new VisitorError('Project not found', 'NOT_FOUND');
  }
  return rows[0];
}

async function deleteProject(projectId, sessionId) {
  _ensureDb();
  if (!projectId || !sessionId) {
    throw new VisitorError('projectId and sessionId required', 'BAD_INPUT');
  }
  const path = `denizen_user_projects?id=eq.${encodeURIComponent(projectId)}&session_id=eq.${encodeURIComponent(sessionId)}`;
  const res = await fetch(`${denizenDb.url}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: denizenDb._headers({ prefer: 'return=minimal' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new VisitorError('Project not found', 'NOT_FOUND');
  }
}

async function listTeammates(sessionId, onlineSet) {
  const teammates = await _listTeammatesRaw(sessionId);
  if (onlineSet == null) return teammates;
  const online = onlineSet instanceof Set ? onlineSet : new Set(onlineSet || []);
  return teammates.map((tm) => ({
    ...tm,
    online: online.has(tm.session_id),
  }));
}

async function listTeammatesWithPresence(sessionId, onlineSet) {
  return listTeammates(sessionId, onlineSet);
}

async function _listTeammatesRaw(sessionId) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }
  const orgId = await getSessionOrgId(sessionId);
  if (!orgId) return [];

  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=id,display_name,denizen_user_assistants!inner(npc_key,assistant_name,denizen_npcs(display_name))&org_id=eq.${encodeURIComponent(orgId)}&id=neq.${encodeURIComponent(sessionId)}`,
  );

  return (rows || []).map((row) => {
    const raw = row.denizen_user_assistants;
    const asst = Array.isArray(raw) ? raw[0] : raw;
    return {
      session_id: row.id,
      display_name: row.display_name,
      npc_key: asst?.npc_key ?? null,
      assistant_name: asst?.assistant_name ?? null,
    };
  });
}

async function sendHandoff({ fromSessionId, toSessionId, fromNpc, toNpc, message, metadata } = {}) {
  _ensureDb();
  if (!fromSessionId || !toSessionId || !message) {
    throw new VisitorError('fromSessionId, toSessionId, and message required', 'BAD_INPUT');
  }

  const rows = await denizenDb._post(
    'denizen_assistant_messages',
    {
      from_session_id: fromSessionId,
      to_session_id: toSessionId,
      from_npc: fromNpc || 'assistant',
      to_npc: toNpc || 'assistant',
      message: String(message).slice(0, 4000),
      status: 'pending',
      metadata: metadata || {},
    },
    { prefer: 'return=representation' },
  );

  if (typeof denizenDb.recordFact === 'function') {
    try {
      await denizenDb.recordFact({
        factType: 'visitor.handoff.sent',
        actorType: 'human',
        actorId: fromSessionId,
        entityType: 'visitor_session',
        entityId: toSessionId,
        payload: {
          from_session_id: fromSessionId,
          to_session_id: toSessionId,
          from_npc: fromNpc || 'assistant',
          to_npc: toNpc || 'assistant',
          message_id: rows?.[0]?.id || null,
          message_preview: String(message).slice(0, 200),
          metadata: metadata || {},
        },
        tags: ['visitor', 'handoff'],
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  return rows?.[0] || null;
}

async function getPendingHandoffs(sessionId) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }
  const rows = await denizenDb._get(
    `denizen_assistant_messages?select=*&status=eq.pending&to_session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.desc&limit=20`,
  );
  const enriched = [];
  for (const row of rows || []) {
    let fromDisplayName = null;
    if (row.from_session_id) {
      try {
        const fromSession = await getSession(row.from_session_id);
        fromDisplayName = fromSession?.display_name ?? null;
      } catch (_) {
        /* optional enrichment */
      }
    }
    enriched.push({ ...row, from_display_name: fromDisplayName });
  }
  return enriched;
}

async function markHandoffDelivered(messageId, sessionId) {
  _ensureDb();
  if (!messageId || !sessionId) {
    throw new VisitorError('messageId and sessionId required', 'BAD_INPUT');
  }
  const rows = await denizenDb._patch(
    `denizen_assistant_messages?id=eq.${encodeURIComponent(messageId)}&to_session_id=eq.${encodeURIComponent(sessionId)}`,
    { status: 'delivered' },
    { prefer: 'return=representation' },
  );
  if (!rows?.length) {
    throw new VisitorError('Handoff not found', 'NOT_FOUND');
  }
  return rows[0];
}

async function resolveHandoffTarget({ toSessionId, toCeo, toDisplayName } = {}) {
  _ensureDb();

  if (toSessionId) {
    const session = await getSession(toSessionId);
    if (!session) {
      throw new VisitorError('Target session not found', 'NOT_FOUND');
    }
    return { session_id: session.id, display_name: session.display_name };
  }

  if (toCeo) {
    const bridgeId = await getOrCreateCeoBridgeSession();
    if (!bridgeId) {
      throw new VisitorError('CEO bridge session unavailable', 'NOT_FOUND');
    }
    return { session_id: bridgeId, display_name: 'CEO Office', is_ceo_bridge: true };
  }

  if (toDisplayName) {
    if (!denizenDb.orgId) {
      throw new VisitorError('Org not configured', 'DB_DISABLED');
    }
    const pattern = encodeURIComponent(`*${String(toDisplayName).trim()}*`);
    const rows = await denizenDb._get(
      `denizen_visitor_sessions?select=id,display_name&org_id=eq.${encodeURIComponent(denizenDb.orgId)}&display_name=ilike.${pattern}&limit=1`,
    );
    if (!rows?.[0]) {
      throw new VisitorError(`No teammate matching "${toDisplayName}"`, 'NOT_FOUND');
    }
    return { session_id: rows[0].id, display_name: rows[0].display_name };
  }

  throw new VisitorError('Handoff target required (to_session_id, to_ceo, or to_display_name)', 'BAD_INPUT');
}

async function getSession(sessionId) {
  _ensureDb();
  if (!sessionId) return null;
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=*&id=eq.${encodeURIComponent(sessionId)}`,
  );
  return rows?.[0] || null;
}

async function getNpcRow(npcKey) {
  const rows = await denizenDb._get(
    `denizen_npcs?select=npc_key,display_name,protected,claimable&npc_key=eq.${encodeURIComponent(npcKey)}`,
  );
  return rows?.[0] || null;
}

async function isNpcClaimable(npcKey) {
  _ensureDb();
  const key = resolveNpcKey(npcKey);
  if (!key) {
    return { claimable: false, reason: 'invalid_npc_key', npc_key: null };
  }
  if (PROTECTED_NPC_KEYS.has(key)) {
    return { claimable: false, reason: 'protected', npc_key: key };
  }
  const npc = await getNpcRow(key);
  if (!npc) {
    return { claimable: false, reason: 'not_found', npc_key: key };
  }
  if (npc.protected) {
    return { claimable: false, reason: 'protected', npc_key: key };
  }
  if (!npc.claimable) {
    return { claimable: false, reason: 'not_claimable', npc_key: key };
  }
  return { claimable: true, npc_key: key, npc };
}

async function getAssistant(sessionId) {
  _ensureDb();
  if (!sessionId) return null;
  const rows = await denizenDb._get(
    `denizen_user_assistants?select=npc_key,assistant_name,focus,role_overlay,claimed_at,denizen_npcs(display_name,protected,claimable)&session_id=eq.${encodeURIComponent(sessionId)}`,
  );
  return _flattenAssistant(rows?.[0]);
}

async function claimAssistant({ sessionId, npcKey, assistantName, focus, roleOverlay } = {}) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }
  if (!npcKey) {
    throw new VisitorError('npcKey required', 'BAD_INPUT');
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new VisitorError('Session not found', 'NOT_FOUND');
  }

  const key = resolveNpcKey(npcKey);
  const claimCheck = await isNpcClaimable(key);
  if (!claimCheck.claimable) {
    if (claimCheck.reason === 'protected') {
      throw new VisitorError(`NPC "${key}" is protected and cannot be claimed`, 'PROTECTED');
    }
    if (claimCheck.reason === 'not_found') {
      throw new VisitorError(`NPC "${key}" not found`, 'NOT_FOUND');
    }
    throw new VisitorError(`NPC "${key}" is not claimable`, 'NOT_CLAIMABLE');
  }

  const now = new Date().toISOString();
  const existing = await denizenDb._get(
    `denizen_user_assistants?select=id&session_id=eq.${encodeURIComponent(sessionId)}`,
  );

  let rows;
  if (existing?.length) {
    rows = await denizenDb._patch(
      `denizen_user_assistants?session_id=eq.${encodeURIComponent(sessionId)}`,
      {
        npc_key: key,
        assistant_name: assistantName ?? null,
        focus: focus ?? null,
        role_overlay: roleOverlay ?? null,
        claimed_at: now,
      },
      { prefer: 'return=representation' },
    );
  } else {
    rows = await denizenDb._post(
      'denizen_user_assistants',
      {
        session_id: sessionId,
        npc_key: key,
        assistant_name: assistantName ?? null,
        focus: focus ?? null,
        role_overlay: roleOverlay ?? null,
        claimed_at: now,
      },
      { prefer: 'return=representation' },
    );
  }

  if (typeof denizenDb.recordFact === 'function') {
    try {
      await denizenDb.recordFact({
        factType: 'visitor.assistant.claimed',
        actorType: 'human',
        actorId: sessionId,
        entityType: 'npc',
        entityId: null,
        payload: {
          session_id: sessionId,
          npc_key: key,
          assistant_name: assistantName ?? null,
          focus: focus ?? null,
          role_overlay: roleOverlay ?? null,
          assistant_id: rows?.[0]?.id || null,
        },
        tags: ['visitor', 'assistant', 'claim'],
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  return getAssistant(sessionId);
}

async function updateAssistant({ sessionId, assistantName, focus, roleOverlay } = {}) {
  _ensureDb();
  if (!sessionId) {
    throw new VisitorError('sessionId required', 'BAD_INPUT');
  }

  const existing = await denizenDb._get(
    `denizen_user_assistants?select=id&session_id=eq.${encodeURIComponent(sessionId)}`,
  );
  if (!existing?.length) {
    throw new VisitorError('No assistant claim for this session', 'NOT_FOUND');
  }

  const patch = {};
  if (assistantName !== undefined) patch.assistant_name = assistantName;
  if (focus !== undefined) patch.focus = focus;
  if (roleOverlay !== undefined) patch.role_overlay = roleOverlay;
  if (!Object.keys(patch).length) {
    return getAssistant(sessionId);
  }

  await denizenDb._patch(
    `denizen_user_assistants?session_id=eq.${encodeURIComponent(sessionId)}`,
    patch,
    { prefer: 'return=representation' },
  );

  return getAssistant(sessionId);
}

/** WS payload for Lucy proactive handoff alert (CEO bridge). */
function buildLucyHandoffAlertBroadcast(handoff, ts = Date.now()) {
  return { type: 'lucy_handoff_alert', handoff, ts };
}

function maskProviderKeys(keys) {
  if (!keys || typeof keys !== 'object') return {};
  const out = {};
  for (const [name, value] of Object.entries(keys)) {
    const s = String(value || '').trim();
    if (!s) {
      out[name] = '';
      continue;
    }
    out[name] = s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : '••••';
  }
  return out;
}

async function getSessionProviderKeys(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return {};
  const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const keys = meta.provider_keys && typeof meta.provider_keys === 'object' ? meta.provider_keys : {};
  const out = {};
  for (const [name, value] of Object.entries(keys)) {
    const s = String(value || '').trim();
    if (s) out[name] = s;
  }
  return out;
}

async function getSessionSettings(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const keys = meta.provider_keys && typeof meta.provider_keys === 'object' ? meta.provider_keys : {};
  let canApproveSkills = false;
  let teamRole = null;
  try {
    const teamAuth = require('./denizen-team-auth.js');
    const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
      isCeoPrincipal: meta.is_ceo_principal === true || meta.access_method === 'ceo_code',
    });
    canApproveSkills = !!approval.allowed;
    teamRole = approval.role || null;
  } catch (_) { /* optional */ }
  return {
    email: meta.email || session.email || null,
    notify_email: meta.notify_email !== false,
    provider_keys: maskProviderKeys(keys),
    provider_keys_set: Object.keys(keys).filter((k) => String(keys[k] || '').trim()),
    can_approve_skills: canApproveSkills,
    team_role: teamRole,
  };
}

async function updateSessionSettings(sessionId, { providerKeys, notifyEmail, email } = {}) {
  const metadata = {};
  if (providerKeys && typeof providerKeys === 'object') {
    metadata.provider_keys = providerKeys;
  }
  if (notifyEmail != null) metadata.notify_email = !!notifyEmail;
  if (email != null) metadata.email = String(email).slice(0, 320);
  return createOrUpdateSession({ sessionId, metadata });
}

function visitorErrorStatus(err) {
  if (!(err instanceof VisitorError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT':
    case 'NOT_CLAIMABLE':
      return 400;
    case 'PROTECTED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'DB_DISABLED':
      return 503;
    default:
      return 500;
  }
}

module.exports = {
  VisitorError,
  visitorErrorStatus,
  getOrgContext,
  listOrganizations,
  resolveOrgBySlug,
  createOrUpdateSession,
  getSession,
  getAssistant,
  claimAssistant,
  updateAssistant,
  isNpcClaimable,
  resolveNpcKey,
  getOrCreateCeoBridgeSession,
  ensureOrgMembership,
  listProjects,
  addProject,
  updateProject,
  deleteProject,
  listTeammates,
  listTeammatesWithPresence,
  sendHandoff,
  getPendingHandoffs,
  markHandoffDelivered,
  resolveHandoffTarget,
  buildLucyHandoffAlertBroadcast,
  getSessionSettings,
  getSessionProviderKeys,
  updateSessionSettings,
  maskProviderKeys,
};
