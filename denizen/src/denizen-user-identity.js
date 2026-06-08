'use strict';

/**
 * Persistent platform users keyed by email — survives session/browser changes.
 * Powers demo capture, team re-login, per-user NPC chat memory, and notifications.
 */

const denizenDb = require('./denizen-db.js');

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
    if (displayName) patch.display_name = name;
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
} = {}) {
  const identity = await upsertIdentity({
    email,
    displayName,
    tier,
    orgId,
    orgSlug,
    source,
    teamAccountId,
  });
  if (identity?.id && sessionId) {
    await linkSessionToIdentity(identity.id, sessionId);
  }
  return identity;
}

function toClientIdentity(identity) {
  if (!identity) return null;
  return {
    id: identity.id,
    email: identity.email_normalized || identity.email,
    display_name: identity.display_name,
    tier: identity.tier,
    returning: (identity.login_count || 0) > 1,
    login_count: identity.login_count || 0,
    notify_email: identity.notify_email !== false,
    subscription_status: identity.subscription_status || 'none',
  };
}

async function loadNpcChatHistory(identityId, npcKey, limit = 50) {
  if (!isEnabled() || !identityId || !npcKey) return [];
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
  if (!isEnabled() || !identityId || !npcKey || !content) return;
  denizenDb.enqueue(async () => {
    await denizenDb._post('denizen_visitor_npc_chat', {
      identity_id: identityId,
      npc_key: npcKey,
      role: role === 'user' ? 'user' : 'npc',
      content: String(content).slice(0, 4000),
      session_id: sessionId || null,
    });
  });
}

module.exports = {
  normalizeEmail,
  isEnabled,
  getIdentityById,
  getIdentityByEmail,
  getIdentityBySession,
  upsertIdentity,
  linkSessionToIdentity,
  resolveIdentityForSession,
  toClientIdentity,
  loadNpcChatHistory,
  mapChatRowsToMemories,
  saveNpcChatTurn,
};
