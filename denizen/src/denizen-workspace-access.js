'use strict';

/**
 * Shared Mine / Team / Org visibility for CRM, Studio Board, Business Studio.
 *
 * Product rules:
 * - New records default to visibility=private + owner stamps
 * - Mine: owner OR assignee OR sharedWith me
 * - Team: visibility shared|team OR assigned (not private-to-someone-else)
 * - Org: owner/admin/ceo only when scope=org explicitly
 * - Legacy (no owner stamps): treat as Team-visible so nothing vanishes
 */

const ORG_WIDE_ROLES = new Set(['owner', 'admin', 'ceo']);
const VALID_SCOPES = new Set(['own', 'team', 'org']);
const TEAM_VISIBILITIES = new Set(['shared', 'team']);

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function isOrgWideRole(role) {
  return ORG_WIDE_ROLES.has(norm(role));
}

function parseScope(raw, { role = null, defaultScope = 'own' } = {}) {
  const s = norm(raw || defaultScope);
  if (!VALID_SCOPES.has(s)) return defaultScope;
  if (s === 'org' && !isOrgWideRole(role)) return defaultScope;
  return s;
}

/**
 * Prefer identityId / email equality; fuzzy name only as last resort for display matching.
 */
function buildActorAliases(actor = {}, { fuzzyName = false } = {}) {
  const exact = new Set();
  const fuzzy = new Set();
  const addExact = (v) => {
    const n = norm(v);
    if (n) exact.add(n);
  };
  const addFuzzy = (v) => {
    const n = norm(v);
    if (!n) return;
    fuzzy.add(n);
    if (n.includes('@')) fuzzy.add(n.split('@')[0]);
    const first = n.split(/\s+/)[0];
    if (first && first.length >= 2) fuzzy.add(first);
  };

  addExact(actor.identityId);
  addExact(actor.identity_id);
  addExact(actor.accountId);
  addExact(actor.email);
  if (actor.email && String(actor.email).includes('@')) {
    addExact(String(actor.email).split('@')[0]);
  }
  addExact(actor.user);
  addExact(actor.displayName);
  if (Array.isArray(actor.aliases)) {
    for (const a of actor.aliases) addExact(a);
  }
  if (fuzzyName) {
    addFuzzy(actor.user);
    addFuzzy(actor.displayName);
    addFuzzy(actor.email);
  }
  return { exact: [...exact], fuzzy: [...fuzzy], all: [...new Set([...exact, ...fuzzy])] };
}

function matchesExact(value, aliases) {
  const n = norm(value);
  if (!n || !aliases?.exact?.length) return false;
  return aliases.exact.some((a) => a && n === a);
}

function matchesFuzzy(value, aliases) {
  const n = norm(value);
  if (!n || !aliases?.fuzzy?.length) return false;
  return aliases.fuzzy.some((a) => a && (n === a || n.includes(a) || a.includes(n)));
}

function matchesAlias(value, aliases) {
  if (!aliases) return false;
  if (Array.isArray(aliases)) {
    const n = norm(value);
    return aliases.some((a) => a && (n === a || n.includes(a) || a.includes(n)));
  }
  return matchesExact(value, aliases) || matchesFuzzy(value, aliases);
}

function recordHasOwnerStamp(record) {
  if (!record || typeof record !== 'object') return false;
  return Boolean(
    record.ownerIdentityId
    || record.owner_identity_id
    || record.ownerEmail
    || record.owner_email
    || record.ownerId
    || record.owner
    || record.createdBy
    || record.created_by
    || record.author
    || record.user
  );
}

function recordOwnedBy(record, aliases, fields = []) {
  if (!record || typeof record !== 'object') return false;
  const preferred = [
    'ownerIdentityId', 'owner_identity_id', 'assigneeIdentityId', 'assignee_identity_id',
    'ownerEmail', 'owner_email', 'identityId', 'identity_id',
  ];
  for (const field of preferred) {
    if (record[field] != null && matchesExact(record[field], aliases)) return true;
  }
  for (const field of fields) {
    if (record[field] == null) continue;
    if (matchesExact(record[field], aliases)) return true;
  }
  const fuzzyFields = fields.filter((f) => !/identity|email|id$/i.test(f) || f === 'ownerId' || f === 'assignee');
  for (const field of fuzzyFields) {
    if (record[field] != null && matchesFuzzy(record[field], aliases)) return true;
  }
  return false;
}

function sharedWithActor(record, aliases) {
  if (!record || typeof record !== 'object') return false;
  const lists = [
    record.sharedWith,
    record.shared_with,
    record.sharedWithEmails,
    record.sharedWithIds,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const val = typeof entry === 'string' ? entry : (entry?.email || entry?.identityId || entry?.id || entry?.name);
      if (matchesAlias(val, aliases)) return true;
    }
  }
  return false;
}

function visibilityOf(record) {
  return norm(record?.visibility || record?.access || '');
}

/**
 * Mine: I own it, I'm assignee, or it's shared with me.
 * Legacy unstamped (pre-isolation) rows: only org owners/admins see them in Mine
 * so teammates who never entered data get a blank workspace.
 */
function recordVisibleMine(record, aliases, ownerFields = [], actor = null) {
  if (!record || typeof record !== 'object') return false;
  const legacy = !recordHasOwnerStamp(record) && !record.assignee && !record.assigneeIdentityId && !record.assignedTo;
  if (legacy) {
    return isOrgWideRole(actor?.role);
  }
  if (recordOwnedBy(record, aliases, ownerFields)) return true;
  if (sharedWithActor(record, aliases)) return true;
  return false;
}

/**
 * Team: explicitly shared/team visibility, OR assigned work.
 * Legacy unstamped rows are NOT team-visible (keeps other teammates blank).
 * Private records owned only by someone else stay hidden unless shared/assigned.
 */
function recordVisibleTeam(record, aliases, ownerFields = []) {
  if (!record || typeof record !== 'object') return false;
  if (!recordHasOwnerStamp(record) && !record.assignee && !record.assigneeIdentityId && !record.assignedTo) {
    return false; // legacy — blank for teammates; owners see via Mine/Org
  }
  const vis = visibilityOf(record);
  if (TEAM_VISIBILITIES.has(vis)) return true;
  if (sharedWithActor(record, aliases)) return true;
  if (record.assignee || record.assigneeIdentityId || record.assignedTo) {
    return true;
  }
  if (vis === 'private' || !vis) {
    return false;
  }
  return false;
}

function filterRecords(list, scope, actor, ownerFields = [
  'ownerIdentityId', 'ownerId', 'owner', 'ownerEmail', 'createdBy', 'assignee', 'assigneeIdentityId', 'assignedTo', 'user', 'author',
]) {
  const rows = Array.isArray(list) ? list : [];
  if (scope === 'org') return rows.slice();
  const aliases = buildActorAliases(actor, { fuzzyName: true });
  if (scope === 'team') {
    return rows.filter((r) => recordVisibleTeam(r, aliases, ownerFields) || recordVisibleMine(r, aliases, ownerFields, actor));
  }
  return rows.filter((r) => recordVisibleMine(r, aliases, ownerFields, actor));
}

function stampOwnership(record, actor, { visibility = 'private', force = false } = {}) {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };
  const name = actor?.displayName || actor?.user || null;
  const email = actor?.email || null;
  const identityId = actor?.identityId || actor?.identity_id || null;

  if (force || !next.ownerIdentityId) {
    if (identityId) next.ownerIdentityId = identityId;
  }
  if (force || !next.ownerEmail) {
    if (email) next.ownerEmail = email;
  }
  if (force || (!next.ownerId && !next.owner && !next.createdBy)) {
    if (name) {
      if ('ownerId' in next || next.title != null || next.name != null) {
        next.ownerId = next.ownerId || name;
      } else if (!next.createdBy) {
        next.createdBy = name;
      }
    }
  }
  if (force || next.visibility == null || next.visibility === '') {
    next.visibility = visibility;
  }
  if (next.assignee || next.assigneeIdentityId || next.assignedTo) {
    const assigneeActor = {
      identityId: next.assigneeIdentityId,
      user: next.assignee,
      displayName: next.assignee,
    };
    const mineAssignee = recordOwnedBy(
      { ownerIdentityId: next.assigneeIdentityId, ownerId: next.assignee },
      buildActorAliases(actor, { fuzzyName: true }),
      ['ownerIdentityId', 'ownerId'],
    );
    if (!mineAssignee && next.visibility === 'private') {
      next.visibility = 'team';
    }
    void assigneeActor;
  }
  return next;
}

function promoteVisibilityOnAssign(record) {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };
  if ((next.assignee || next.assigneeIdentityId || next.assignedTo) && (!next.visibility || next.visibility === 'private')) {
    next.visibility = 'team';
  }
  return next;
}

function shareWithTeam(record) {
  if (!record || typeof record !== 'object') return record;
  return { ...record, visibility: 'team' };
}

module.exports = {
  ORG_WIDE_ROLES,
  VALID_SCOPES,
  TEAM_VISIBILITIES,
  norm,
  isOrgWideRole,
  parseScope,
  buildActorAliases,
  matchesAlias,
  matchesExact,
  matchesFuzzy,
  recordHasOwnerStamp,
  recordOwnedBy,
  sharedWithActor,
  visibilityOf,
  recordVisibleMine,
  recordVisibleTeam,
  filterRecords,
  stampOwnership,
  promoteVisibilityOnAssign,
  shareWithTeam,
};
