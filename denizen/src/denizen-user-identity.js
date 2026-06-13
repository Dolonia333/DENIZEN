'use strict';

/**
 * Persistent platform users keyed by email — survives session/browser changes.
 * Powers demo capture, team re-login, per-user NPC chat memory, and notifications.
 */

const denizenDb = require('./denizen-db.js');
const npcTeamSoul = require('./npc-team-soul');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEnabled() {
  return Boolean(denizenDb.enabled);
}

async function getIdentityById(id) {
  if (!isEnabled() || !id) return null;
  const rows = await denizenDb._getSoft(
    `denizen_user_identities?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function getIdentityByEmail(email) {
  if (!isEnabled()) return null;
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return null;
  const rows = await denizenDb._getSoft(
    `denizen_user_identities?select=*&email_normalized=eq.${encodeURIComponent(emailNormalized)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function getIdentityBySession(sessionId) {
  if (!isEnabled() || !sessionId) return null;
  const rows = await denizenDb._getSoft(
    `denizen_visitor_sessions?select=identity_id&limit=1&id=eq.${encodeURIComponent(sessionId)}`,
  );
  const identityId = rows?.[0]?.identity_id;
  if (!identityId) return null;
  return getIdentityById(identityId);
}

async function upsertIdentity({
  email,
  displayName,
  tier = 'demo',
  orgId = null,
  orgSlug = null,
  source = null,
  teamAccountId = null,
  notifyEmail = true,
  updateDisplayName = true,
} = {}) {
  if (!isEnabled()) return null;
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return null;

  const name = String(displayName || emailNormalized.split('@')[0]).slice(0, 200);
  const now = new Date().toISOString();
  const existing = await getIdentityByEmail(emailNormalized);

  if (existing) {
    const patch = {
      last_login_at: now,
      login_count: (existing.login_count || 0) + 1,
    };
    if (displayName && updateDisplayName) patch.display_name = name;
    if (tier) patch.tier = tier;
    if (orgId) patch.org_id = orgId;
    if (teamAccountId) patch.team_account_id = teamAccountId;
    if (source) patch.source = source;
    const rows = await denizenDb._patchSoft(
      `denizen_user_identities?id=eq.${encodeURIComponent(existing.id)}`,
      patch,
      { prefer: 'return=representation' },
    );
    return rows?.[0] || { ...existing, ...patch };
  }

  const meta = {};
  if (orgSlug) meta.org_slug = orgSlug;

  const rows = await denizenDb._postSoft(
    'denizen_user_identities',
    {
      email: emailNormalized,
      email_normalized: emailNormalized,
      display_name: name,
      tier,
      org_id: orgId,
      team_account_id: teamAccountId,
      notify_email: notifyEmail,
      source: source || tier,
      last_login_at: now,
      login_count: 1,
      metadata: meta,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function updateIdentityProfile(identityId, { displayName, email, notifyEmail } = {}) {
  if (!isEnabled() || !identityId) return null;
  const patch = { updated_at: new Date().toISOString() };
  if (displayName != null) {
    patch.display_name = String(displayName || 'Guest').slice(0, 200);
  }
  if (email != null) {
    const emailNormalized = normalizeEmail(email);
    if (!emailNormalized) throw new Error('valid email required');
    patch.email = emailNormalized;
    patch.email_normalized = emailNormalized;
  }
  if (notifyEmail != null) patch.notify_email = !!notifyEmail;
  const rows = await denizenDb._patchSoft(
    `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
    patch,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function changeIdentityPassword(identityId, { currentPassword, newPassword } = {}) {
  if (!isEnabled() || !identityId) {
    throw new Error('identity required');
  }
  const { hashPassword, verifyPassword, assertPasswordMinLength } = require('./denizen-team-password.js');
  const next = String(newPassword || '');
  assertPasswordMinLength(next);
  const identity = await getIdentityById(identityId);
  if (!identity) throw new Error('profile not found');
  if (!identity.password_hash) throw new Error('no password on this account yet');
  const current = String(currentPassword || '');
  if (!verifyPassword(current, identity.password_hash)) {
    throw new Error('current password is incorrect');
  }
  const rows = await denizenDb._patchSoft(
    `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
    {
      password_hash: hashPassword(next),
      updated_at: new Date().toISOString(),
    },
    { prefer: 'return=representation' },
  );
  if (identity.team_account_id) {
    await denizenDb._patchSoft(
      `denizen_team_accounts?id=eq.${encodeURIComponent(identity.team_account_id)}`,
      { password_hash: hashPassword(next), updated_at: new Date().toISOString() },
      { prefer: 'return=minimal' },
    ).catch(() => null);
  }
  return rows?.[0] || identity;
}

async function linkSessionToIdentity(identityId, sessionId) {
  if (!isEnabled() || !identityId || !sessionId) return;
  await denizenDb._patchSoft(
    `denizen_visitor_sessions?id=eq.${encodeURIComponent(sessionId)}`,
    { identity_id: identityId },
    { prefer: 'return=minimal' },
  );
  await denizenDb._patchSoft(
    `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
    { primary_session_id: sessionId },
    { prefer: 'return=minimal' },
  );
}

async function resolveIdentityForSession({
  email,
  displayName,
  tier,
  orgId,
  orgSlug,
  source,
  teamAccountId,
  sessionId,
  updateDisplayName = false,
} = {}) {
  const identity = await upsertIdentity({
    email,
    displayName,
    tier,
    orgId,
    orgSlug,
    source,
    teamAccountId,
    updateDisplayName,
  });
  if (identity?.id && sessionId) {
    await linkSessionToIdentity(identity.id, sessionId);
  }
  return identity;
}

function markCeoPrincipal(identityId) {
  if (!isEnabled() || !identityId) return;
  denizenDb.enqueue(async () => {
    const rows = await denizenDb._get(
      `denizen_user_identities?select=id,metadata&limit=1&id=eq.${encodeURIComponent(identityId)}`,
    );
    const existing = rows?.[0];
    if (!existing?.id) return;
    const meta = existing.metadata && typeof existing.metadata === 'object'
      ? { ...existing.metadata }
      : {};
    if (meta.is_ceo_principal) return;
    meta.is_ceo_principal = true;
    await denizenDb._patch(
      `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
      { metadata: meta },
      { prefer: 'return=minimal' },
    );
  });
}

function toClientIdentity(identity) {
  if (!identity) return null;
  return {
    id: identity.id,
    email: identity.email_normalized || identity.email,
    display_name: identity.display_name,
    username: identity.username || null,
    tier: identity.tier,
    returning: (identity.login_count || 0) > 1,
    login_count: identity.login_count || 0,
    notify_email: identity.notify_email !== false,
    subscription_status: identity.subscription_status || 'none',
    has_password: !!identity.password_hash,
  };
}

function toClientNpcTeam(template, members = []) {
  if (!template) return null;
  return {
    id: template.id,
    identity_id: template.identity_id,
    org_id: template.org_id || null,
    name: template.name || 'My NPC team',
    purpose: template.purpose || null,
    settings: template.settings || {},
    members: (members || []).map((m) => {
      const settings = m.settings || {};
      return {
        id: m.id,
        npc_key: m.npc_key,
        display_name: m.display_name || m.npc_key,
        role: m.role || 'assistant',
        focus: m.focus || null,
        instructions: m.instructions || null,
        job: settings.job || null,
        sort_order: Number(m.sort_order) || 0,
        active: m.active !== false,
        settings,
        portrait: npcTeamSoul.portraitMeta(m.npc_key),
      };
    }),
  };
}

async function getNpcTeamTemplate(identityId) {
  if (!isEnabled() || !identityId) return null;
  const rows = await denizenDb._getSoft(
    `denizen_identity_npc_team_templates?select=*&identity_id=eq.${encodeURIComponent(identityId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function ensureNpcTeamTemplate(identityId, { orgId = null, name = 'My NPC team', purpose = null } = {}) {
  if (!isEnabled() || !identityId) return null;
  const existing = await getNpcTeamTemplate(identityId);
  if (existing?.id) return existing;
  const rows = await denizenDb._postSoft(
    'denizen_identity_npc_team_templates',
    {
      identity_id: identityId,
      org_id: orgId,
      name,
      purpose,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function updateNpcTeamTemplate(identityId, { orgId = null, name, purpose, settings } = {}) {
  if (!isEnabled() || !identityId) return null;
  const template = await ensureNpcTeamTemplate(identityId, { orgId });
  if (!template?.id) return null;
  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = String(name || 'My NPC team').slice(0, 160);
  if (purpose !== undefined) patch.purpose = String(purpose || '').slice(0, 1000) || null;
  if (settings && typeof settings === 'object') patch.settings = settings;
  const rows = await denizenDb._patchSoft(
    `denizen_identity_npc_team_templates?id=eq.${encodeURIComponent(template.id)}`,
    patch,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || { ...template, ...patch };
}

async function listNpcTeamMembers(identityId) {
  if (!isEnabled() || !identityId) return [];
  const rows = await denizenDb._getSoft(
    [
      'denizen_identity_npc_team_members?select=*',
      `identity_id=eq.${encodeURIComponent(identityId)}`,
      'active=eq.true',
      'order=sort_order.asc,created_at.asc',
    ].join('&'),
  );
  return rows || [];
}

async function getNpcTeam(identityId) {
  const template = await getNpcTeamTemplate(identityId);
  if (!template?.id) return null;
  const members = await listNpcTeamMembers(identityId);
  return toClientNpcTeam(template, members);
}

async function getNpcTeamMember(identityId, npcKey) {
  if (!isEnabled() || !identityId || !npcKey) return null;
  const key = String(npcKey || '').trim().toLowerCase();
  const rows = await denizenDb._getSoft(
    `denizen_identity_npc_team_members?select=*&identity_id=eq.${encodeURIComponent(identityId)}&npc_key=eq.${encodeURIComponent(key)}&active=eq.true&limit=1`,
  );
  return rows?.[0] || null;
}

async function getNpcTeamMemberSoulView(identityId, npcKey) {
  const member = await getNpcTeamMember(identityId, npcKey);
  return npcTeamSoul.buildMemberSoulView(npcKey, member);
}

async function upsertNpcTeamMember(identityId, {
  orgId = null,
  npcKey,
  displayName = null,
  role = 'assistant',
  focus = null,
  instructions = null,
  job = null,
  sortOrder = 0,
  settings = {},
} = {}) {
  if (!isEnabled() || !identityId || !npcKey) return null;
  const template = await ensureNpcTeamTemplate(identityId, { orgId });
  if (!template?.id) return null;
  const key = String(npcKey || '').trim().toLowerCase();
  const existingRows = await denizenDb._getSoft(
    `denizen_identity_npc_team_members?select=*&identity_id=eq.${encodeURIComponent(identityId)}&npc_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  const existing = existingRows?.[0] || null;
  const mergedSettings = npcTeamSoul.mergeMemberSettings(
    existing?.settings,
    {
      ...(settings && typeof settings === 'object' ? settings : {}),
      ...(job !== undefined && job !== null ? { job: String(job).slice(0, 500) } : {}),
    },
    {
      npc_key: key,
      display_name: displayName ?? existing?.display_name ?? key,
      role: role ?? existing?.role ?? 'assistant',
      focus: focus ?? existing?.focus,
      instructions: instructions ?? existing?.instructions,
    },
  );
  const row = {
    template_id: template.id,
    identity_id: identityId,
    npc_key: key,
    display_name: displayName || existing?.display_name || key,
    role: role || existing?.role || 'assistant',
    focus: focus !== undefined ? (focus || null) : (existing?.focus || null),
    instructions: instructions !== undefined ? (instructions || null) : (existing?.instructions || null),
    sort_order: Number(sortOrder) || Number(existing?.sort_order) || 0,
    active: true,
    settings: mergedSettings,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    const rows = await denizenDb._patchSoft(
      `denizen_identity_npc_team_members?id=eq.${encodeURIComponent(existing.id)}`,
      row,
      { prefer: 'return=representation' },
    );
    return rows?.[0] || null;
  }
  const rows = await denizenDb._postSoft(
    'denizen_identity_npc_team_members',
    row,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function deactivateNpcTeamMember(identityId, npcKey) {
  if (!isEnabled() || !identityId || !npcKey) return null;
  const rows = await denizenDb._patchSoft(
    [
      'denizen_identity_npc_team_members',
      `identity_id=eq.${encodeURIComponent(identityId)}`,
      `npc_key=eq.${encodeURIComponent(String(npcKey).trim().toLowerCase())}`,
    ].join('&').replace('&', '?'),
    { active: false, updated_at: new Date().toISOString() },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function loadNpcChatHistory(identityId, npcKey, limit = 50) {
  if (!identityId || !npcKey) return [];
  if (isLocalChatIdentity(identityId)) {
    const msgs = localDmMessages.get(localDmKey(identityId, npcKey)) || [];
    return msgs.slice(-Math.min(limit, 100));
  }
  if (!isEnabled()) return [];
  const rows = await denizenDb._get(
    `denizen_visitor_npc_chat?select=role,content,created_at&identity_id=eq.${encodeURIComponent(identityId)}&npc_key=eq.${encodeURIComponent(npcKey)}&order=created_at.asc&limit=${Math.min(limit, 100)}`,
  );
  return rows || [];
}

function mapChatRowsToMemories(rows, npcDisplayName, userDisplayName) {
  return (rows || []).map((row) => ({
    from: row.role === 'user' ? (userDisplayName || 'Guest') : npcDisplayName,
    text: String(row.content || ''),
  }));
}

function saveNpcChatTurn({ identityId, npcKey, role, content, sessionId }) {
  if (!identityId || !npcKey || !content) return;
  const row = {
    role: role === 'user' ? 'user' : 'npc',
    content: String(content).slice(0, 4000),
    created_at: new Date().toISOString(),
  };
  if (isLocalChatIdentity(identityId)) {
    const key = localDmKey(identityId, npcKey);
    const msgs = localDmMessages.get(key) || [];
    msgs.push(row);
    if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
    localDmMessages.set(key, msgs);
    return;
  }
  if (!isEnabled()) return;
  denizenDb.enqueue(async () => {
    await denizenDb._post('denizen_visitor_npc_chat', {
      identity_id: identityId,
      npc_key: npcKey,
      role: row.role,
      content: row.content,
      session_id: sessionId || null,
    });
  });
}

async function listDmChatThreads(identityId, limit = 40) {
  if (!identityId) return [];
  if (isLocalChatIdentity(identityId)) {
    return listLocalDmThreads(identityId, limit);
  }
  const rows = await denizenDb._get(
    `denizen_visitor_npc_chat?select=npc_key,role,content,created_at&identity_id=eq.${encodeURIComponent(identityId)}&order=created_at.desc&limit=500`,
  ).catch(() => []);
  const seen = new Set();
  const threads = [];
  for (const row of rows || []) {
    const key = String(row.npc_key || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    threads.push({
      type: 'dm',
      thread_id: `dm:${key}`,
      npc_key: key,
      preview: String(row.content || '').slice(0, 120),
      preview_role: row.role,
      updated_at: row.created_at,
    });
    if (threads.length >= limit) break;
  }
  return threads;
}

const localGroupChats = new Map();
const localGroupMessages = new Map();
const localDmMessages = new Map();

function isLocalChatIdentity(identityId) {
  return String(identityId || '').startsWith('session:') || !isEnabled();
}

function localDmKey(identityId, npcKey) {
  return `${identityId}:${String(npcKey || '').toLowerCase()}`;
}

function listLocalDmThreads(identityId, limit = 40) {
  if (!identityId) return [];
  const prefix = `${identityId}:`;
  const threads = [];
  for (const [key, msgs] of localDmMessages.entries()) {
    if (!key.startsWith(prefix)) continue;
    const npcKey = key.slice(prefix.length);
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    threads.push({
      type: 'dm',
      thread_id: `dm:${npcKey}`,
      npc_key: npcKey,
      preview: String(last.content || '').slice(0, 120),
      preview_role: last.role,
      updated_at: last.created_at,
    });
  }
  return threads
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, limit);
}

function isLocalGroupId(groupId) {
  return String(groupId || '').startsWith('mem-');
}

function makeLocalGroupId() {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function listLocalGroupsForIdentity(identityId) {
  if (!identityId) return [];
  return [...localGroupChats.values()].filter((g) => g.identity_id === identityId);
}

function summarizeLocalGroup(g) {
  const msgs = localGroupMessages.get(g.id) || [];
  const last = msgs[msgs.length - 1] || null;
  return {
    type: 'group',
    thread_id: `group:${g.id}`,
    group_id: g.id,
    name: g.name,
    member_npc_keys: Array.isArray(g.member_npc_keys) ? g.member_npc_keys : [],
    preview: last ? String(last.content || '').slice(0, 120) : '',
    preview_sender: last?.sender_type === 'user' ? 'user' : (last?.sender_npc_key || null),
    updated_at: last?.created_at || g.updated_at || g.created_at,
  };
}

async function listGroupChats(identityId, limit = 30) {
  if (!identityId) return [];
  const out = listLocalGroupsForIdentity(identityId).map(summarizeLocalGroup);
  if (!isEnabled()) {
    return out.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, limit);
  }
  const groups = await denizenDb._get(
    `denizen_visitor_group_chat?select=id,name,member_npc_keys,created_at,updated_at&identity_id=eq.${encodeURIComponent(identityId)}&order=updated_at.desc&limit=${Math.min(limit, 50)}`,
  ).catch(() => []);
  for (const g of groups || []) {
    if (out.some((row) => row.group_id === g.id)) continue;
    const msgs = await denizenDb._get(
      `denizen_visitor_group_chat_message?select=sender_type,sender_npc_key,content,created_at&group_id=eq.${encodeURIComponent(g.id)}&order=created_at.desc&limit=1`,
    ).catch(() => []);
    const last = msgs?.[0] || null;
    out.push({
      type: 'group',
      thread_id: `group:${g.id}`,
      group_id: g.id,
      name: g.name,
      member_npc_keys: Array.isArray(g.member_npc_keys) ? g.member_npc_keys : [],
      preview: last ? String(last.content || '').slice(0, 120) : '',
      preview_sender: last?.sender_type === 'user' ? 'user' : (last?.sender_npc_key || null),
      updated_at: last?.created_at || g.updated_at || g.created_at,
    });
  }
  return out.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, limit);
}

async function listChatThreads(identityId) {
  const [dms, groups] = await Promise.all([
    listDmChatThreads(identityId),
    listGroupChats(identityId),
  ]);
  return [...dms, ...groups].sort((a, b) => {
    const ta = new Date(a.updated_at || 0).getTime();
    const tb = new Date(b.updated_at || 0).getTime();
    return tb - ta;
  });
}

async function loadDmChatHistory(identityId, npcKey, limit = 80) {
  return loadNpcChatHistory(identityId, npcKey, limit);
}

async function getGroupChat(identityId, groupId) {
  if (!identityId || !groupId) return null;
  if (isLocalGroupId(groupId)) {
    const local = localGroupChats.get(groupId);
    return local && local.identity_id === identityId ? local : null;
  }
  if (!isEnabled()) return null;
  const rows = await denizenDb._get(
    `denizen_visitor_group_chat?select=*&id=eq.${encodeURIComponent(groupId)}&identity_id=eq.${encodeURIComponent(identityId)}&limit=1`,
  ).catch(() => []);
  return rows?.[0] || null;
}

function createLocalGroupChat({ identityId, name, memberNpcKeys }) {
  const keys = [...new Set((memberNpcKeys || []).map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
  if (keys.length < 2) throw new Error('Pick at least two NPCs for a group chat');
  const label = String(name || '').trim() || keys.slice(0, 3).join(', ');
  const now = new Date().toISOString();
  const group = {
    id: makeLocalGroupId(),
    identity_id: identityId,
    name: label.slice(0, 120),
    member_npc_keys: keys,
    created_at: now,
    updated_at: now,
    _local: true,
  };
  localGroupChats.set(group.id, group);
  localGroupMessages.set(group.id, []);
  return group;
}

async function createGroupChat({ identityId, name, memberNpcKeys }) {
  if (!identityId) throw new Error('Profile required to create group chats');
  const keys = [...new Set((memberNpcKeys || []).map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
  if (keys.length < 2) throw new Error('Pick at least two NPCs for a group chat');
  const label = String(name || '').trim() || keys.slice(0, 3).join(', ');
  if (isEnabled()) {
    try {
      const rows = await denizenDb._post('denizen_visitor_group_chat', {
        identity_id: identityId,
        name: label.slice(0, 120),
        member_npc_keys: keys,
        updated_at: new Date().toISOString(),
      }, { prefer: 'return=representation' });
      if (rows?.[0]?.id) return rows[0];
    } catch (err) {
      console.warn('[GroupChat] DB create failed, using in-memory store:', err?.message || err);
    }
  }
  return createLocalGroupChat({ identityId, name: label, memberNpcKeys: keys });
}

async function loadGroupChatHistory(identityId, groupId, limit = 80) {
  if (!identityId || !groupId) return [];
  const group = await getGroupChat(identityId, groupId);
  if (!group) return [];
  if (isLocalGroupId(groupId)) {
    const rows = localGroupMessages.get(groupId) || [];
    return rows.slice(-Math.min(limit, 200));
  }
  if (!isEnabled()) return [];
  const rows = await denizenDb._get(
    `denizen_visitor_group_chat_message?select=sender_type,sender_npc_key,content,created_at&group_id=eq.${encodeURIComponent(groupId)}&identity_id=eq.${encodeURIComponent(identityId)}&order=created_at.asc&limit=${Math.min(limit, 200)}`,
  ).catch(() => []);
  return rows || [];
}

function mapGroupRowsToMessages(rows, userDisplayName, nameForKey) {
  return (rows || []).map((row) => {
    if (row.sender_type === 'user') {
      return { from: userDisplayName || 'You', text: String(row.content || ''), time: row.created_at };
    }
    const key = row.sender_npc_key || '';
    const label = nameForKey?.(key) || key || 'NPC';
    return { from: label, text: String(row.content || ''), time: row.created_at, npc_key: key };
  });
}

function saveGroupChatMessage({ identityId, groupId, senderType, senderNpcKey, content, sessionId }) {
  if (!identityId || !groupId || !content) return;
  const row = {
    sender_type: senderType === 'user' ? 'user' : 'npc',
    sender_npc_key: senderType === 'user' ? null : String(senderNpcKey || '').toLowerCase(),
    content: String(content).slice(0, 4000),
    created_at: new Date().toISOString(),
  };
  if (isLocalGroupId(groupId)) {
    const group = localGroupChats.get(groupId);
    if (!group || group.identity_id !== identityId) return;
    const msgs = localGroupMessages.get(groupId) || [];
    msgs.push(row);
    if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
    localGroupMessages.set(groupId, msgs);
    group.updated_at = row.created_at;
    localGroupChats.set(groupId, group);
    return;
  }
  if (!isEnabled()) return;
  denizenDb.enqueue(async () => {
    await denizenDb._post('denizen_visitor_group_chat_message', {
      group_id: groupId,
      identity_id: identityId,
      ...row,
      session_id: sessionId || null,
    });
    await denizenDb._patchSoft(
      `denizen_visitor_group_chat?id=eq.${encodeURIComponent(groupId)}`,
      { updated_at: new Date().toISOString() },
    );
  });
}

module.exports = {
  normalizeEmail,
  isEnabled,
  getIdentityById,
  getIdentityByEmail,
  getIdentityBySession,
  upsertIdentity,
  updateIdentityProfile,
  changeIdentityPassword,
  linkSessionToIdentity,
  resolveIdentityForSession,
  markCeoPrincipal,
  toClientIdentity,
  toClientNpcTeam,
  ensureNpcTeamTemplate,
  updateNpcTeamTemplate,
  getNpcTeam,
  getNpcTeamMember,
  getNpcTeamMemberSoulView,
  upsertNpcTeamMember,
  deactivateNpcTeamMember,
  loadNpcChatHistory,
  mapChatRowsToMemories,
  saveNpcChatTurn,
  listDmChatThreads,
  listGroupChats,
  listChatThreads,
  loadDmChatHistory,
  getGroupChat,
  createGroupChat,
  loadGroupChatHistory,
  mapGroupRowsToMessages,
  saveGroupChatMessage,
};
