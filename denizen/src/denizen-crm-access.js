'use strict';

/**
 * CRM record visibility: members see only their own rows (browser + MCP).
 * Owners/admins / org-wide callers keep the full org workspace.
 *
 * Personal maps (userPrefs.profiles, calendarConnections) are keyed by
 * identity so teammate profile edits cannot overwrite each other.
 */

const ORG_WIDE_ROLES = new Set(['owner', 'admin', 'ceo']);

const SCOPED_ARRAY_KEYS = [
  'deals',
  'tasks',
  'contacts',
  'notes',
  'companies',
  'meetings',
  'quotes',
  'submissions',
  'supportTickets',
  'dealComments',
  'crmQuotas',
  'aiThreads',
  'emailLog',
  'auditLog',
  'usageLog',
];

const MEMBER_READ_ONLY_KEYS = new Set([
  'teamPolicy',
  'industryConfig',
  'packages',
  'automations',
  'sequences',
  'emailTemplates',
  'contactGroups',
  'contactGroupMap',
  'integrations',
  'calendarConnections',
  'metricSnapshots',
  'automationRuns',
  'marketingCampaigns',
  'goals',
  'availability',
  'onboarding',
]);

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function isOrgWideRole(role) {
  return ORG_WIDE_ROLES.has(norm(role));
}

/**
 * Build match aliases for an actor (display names, email local-part, ids).
 */
function buildActorAliases(actor = {}) {
  const aliases = new Set();
  const add = (v) => {
    const n = norm(v);
    if (!n) return;
    aliases.add(n);
    if (n.includes('@')) aliases.add(n.split('@')[0]);
    // first token for "Kaiser Smith" → "kaiser"
    const first = n.split(/\s+/)[0];
    if (first && first.length >= 2) aliases.add(first);
  };
  add(actor.user);
  add(actor.displayName);
  add(actor.email);
  add(actor.identityId);
  add(actor.accountId);
  if (Array.isArray(actor.aliases)) {
    for (const a of actor.aliases) add(a);
  }
  return [...aliases];
}

function tokensOf(value) {
  return norm(value).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

function matchesAlias(value, aliases) {
  const n = norm(value);
  if (!n || !aliases?.length) return false;
  const nTokens = tokensOf(n);
  return aliases.some((a) => {
    if (!a) return false;
    if (n === a) return true;
    const aTokens = tokensOf(a);
    if (!aTokens.length || !nTokens.length) return false;
    // Whole tokens only — "zion" must not match inside "vzion253".
    if (aTokens.every((t) => nTokens.includes(t))) return true;
    if (n.length >= 4 && nTokens.every((t) => aTokens.includes(t))) return true;
    return false;
  });
}

function recordOwnedBy(record, aliases, fields = []) {
  if (!record || typeof record !== 'object') return false;
  for (const field of fields) {
    if (matchesAlias(record[field], aliases)) return true;
  }
  return false;
}

function dealOwnedBy(deal, aliases) {
  return recordOwnedBy(deal, aliases, ['ownerId', 'owner', 'ownerEmail', 'ownerIdentityId', 'createdBy']);
}

function taskOwnedBy(task, aliases) {
  return recordOwnedBy(task, aliases, ['assignee', 'createdBy', 'ownerId', 'ownerIdentityId']);
}

function ticketOwnedBy(ticket, aliases) {
  return recordOwnedBy(ticket, aliases, ['assignee', 'createdBy', 'ownerId', 'ownerIdentityId']);
}

function contactOwnedBy(contact, aliases, ownedContactNames) {
  if (recordOwnedBy(contact, aliases, ['ownerId', 'owner', 'ownerEmail', 'ownerIdentityId', 'assignedTo', 'createdBy'])) {
    return true;
  }
  if (ownedContactNames && matchesAlias(contact?.name, [...ownedContactNames])) return true;
  return false;
}

function collectOwnedContactNames(deals, contacts, aliases) {
  const names = new Set();
  for (const d of deals || []) {
    if (!dealOwnedBy(d, aliases)) continue;
    const n = norm(d.contact);
    if (n) names.add(n);
  }
  for (const c of contacts || []) {
    if (recordOwnedBy(c, aliases, ['ownerId', 'owner', 'ownerEmail', 'ownerIdentityId', 'assignedTo', 'createdBy'])) {
      const n = norm(c.name);
      if (n) names.add(n);
    }
  }
  return names;
}

/**
 * Filter full org workspace down to records the member may see.
 * Owners/admins get state unchanged (orgWide=true).
 */
function filterWorkspaceForAccess(state, actor, { orgWide = false, forceOwn = false } = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  if (!forceOwn && orgWide) {
    return {
      state: {
        ...raw,
        calendarConnections: stripAllConnectionSecrets(raw.calendarConnections),
      },
      scope: 'org',
      filtered: false,
    };
  }

  const aliases = buildActorAliases(actor);
  const deals = Array.isArray(raw.deals) ? raw.deals.filter((d) => dealOwnedBy(d, aliases)) : [];
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.filter((t) => taskOwnedBy(t, aliases)) : [];
  const supportTickets = Array.isArray(raw.supportTickets)
    ? raw.supportTickets.filter((t) => ticketOwnedBy(t, aliases))
    : [];
  const ownedNames = collectOwnedContactNames(deals, raw.contacts, aliases);
  const contacts = Array.isArray(raw.contacts)
    ? raw.contacts.filter((c) => contactOwnedBy(c, aliases, ownedNames))
    : [];
  const contactNames = new Set(contacts.map((c) => norm(c.name)).filter(Boolean));
  for (const n of ownedNames) contactNames.add(n);

  const dealIds = new Set(deals.map((d) => String(d.id)));
  const contactIds = new Set(contacts.map((c) => Number(c.id)).filter((n) => Number.isFinite(n)));

  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n) => {
      if (recordOwnedBy(n, aliases, ['createdBy', 'user', 'author', 'ownerId'])) return true;
      return contactNames.has(norm(n.contact));
    })
    : [];

  // Calendars are team-view by default (so teammates see who's who).
  // Only meetings explicitly marked visibility=private stay personal.
  const meetings = Array.isArray(raw.meetings)
    ? raw.meetings.filter((m) => {
      const vis = norm(m.visibility || 'team');
      if (vis === 'private') {
        if (recordOwnedBy(m, aliases, ['ownerId', 'assignee', 'createdBy', 'organizer', 'ownerIdentityId', 'ownerName'])) {
          return true;
        }
        const attendees = Array.isArray(m.attendees) ? m.attendees : [];
        return attendees.some((a) => matchesAlias(typeof a === 'string' ? a : a?.name || a?.email, aliases));
      }
      return true;
    })
    : [];

  const quotes = Array.isArray(raw.quotes)
    ? raw.quotes.filter((q) => {
      if (recordOwnedBy(q, aliases, ['ownerId', 'createdBy', 'assignedTo'])) return true;
      return contactNames.has(norm(q.clientName));
    })
    : [];

  const submissions = Array.isArray(raw.submissions)
    ? raw.submissions.filter((s) => {
      if (recordOwnedBy(s, aliases, ['assignedTo', 'ownerId', 'createdBy'])) return true;
      return contactNames.has(norm(s.clientName));
    })
    : [];

  const companies = Array.isArray(raw.companies)
    ? raw.companies.filter((co) => {
      if (recordOwnedBy(co, aliases, ['ownerId', 'owner', 'createdBy'])) return true;
      const linkedContacts = Array.isArray(co.linkedContacts) ? co.linkedContacts : [];
      if (linkedContacts.some((id) => contactIds.has(Number(id)))) return true;
      const linkedDeals = Array.isArray(co.linkedDeals) ? co.linkedDeals : [];
      if (linkedDeals.some((id) => dealIds.has(String(id)))) return true;
      return false;
    })
    : [];

  const dealComments = Array.isArray(raw.dealComments)
    ? raw.dealComments.filter((c) => dealIds.has(String(c.dealId)) || matchesAlias(c.user, aliases))
    : [];

  const crmQuotas = Array.isArray(raw.crmQuotas)
    ? raw.crmQuotas.filter((q) => recordOwnedBy(q, aliases, ['assigneeId', 'assigneeName', 'createdBy']))
    : [];

  const aiThreads = Array.isArray(raw.aiThreads)
    ? raw.aiThreads.filter((t) => recordOwnedBy(t, aliases, ['ownerName', 'ownerEmail', 'user']))
    : [];

  const emailLog = Array.isArray(raw.emailLog)
    ? raw.emailLog.filter((e) => {
      if (recordOwnedBy(e, aliases, ['user', 'from', 'createdBy', 'ownerId'])) return true;
      return contactIds.has(Number(e.contactId));
    })
    : [];

  const auditLog = Array.isArray(raw.auditLog)
    ? raw.auditLog.filter((e) => matchesAlias(e.user, aliases) || matchesAlias(e.email, aliases)
      || matchesAlias(e.identityId, aliases))
    : [];

  const usageLog = Array.isArray(raw.usageLog)
    ? raw.usageLog.filter((e) => matchesAlias(e.user, aliases) || matchesAlias(e.email, aliases))
    : [];

  const out = { ...raw };
  out.deals = deals;
  out.tasks = tasks;
  out.contacts = contacts;
  out.notes = notes;
  out.companies = companies;
  out.meetings = meetings;
  out.quotes = quotes;
  out.submissions = submissions;
  out.supportTickets = supportTickets;
  out.dealComments = dealComments;
  out.crmQuotas = crmQuotas;
  out.aiThreads = aiThreads;
  out.emailLog = emailLog;
  out.auditLog = auditLog;
  out.usageLog = usageLog;

  // Personal prefs / OAuth calendar tokens — never leak teammates'.
  const identityId = actor?.identityId || null;
  const myPrefs = prefsForIdentity(raw.userPrefs, identityId);
  out.userPrefs = {
    ...myPrefs,
    // Project caller's prefs into legacy shape the CRM UI expects.
    profile: myPrefs.profile || null,
    notifications: myPrefs.notifications || null,
    profiles: identityId ? { [identityId]: myPrefs } : {},
  };
  out.calendarConnections = calendarConnectionsForIdentity(raw.calendarConnections, identityId);

  if (Array.isArray(raw.noteBoards)) {
    // Legacy unowned boards stay visible; owned boards only for their owner.
    out.noteBoards = raw.noteBoards.filter((b) => !noteBoardHasOwner(b) || noteBoardOwnedBy(b, aliases));
  }

  // Availability is shared team scheduling — keep visible, but strip if
  // it becomes a per-identity map in the future.
  if (raw.availability && typeof raw.availability === 'object' && !Array.isArray(raw.availability)) {
    const keys = Object.keys(raw.availability);
    const looksKeyed = identityId && keys.length > 0 && keys.every((k) => k.length > 20 || k.includes('-'));
    if (looksKeyed && raw.availability[identityId]) {
      out.availability = raw.availability[identityId];
    }
  }

  return {
    state: out,
    scope: 'own',
    filtered: true,
    counts: {
      deals: deals.length,
      tasks: tasks.length,
      contacts: contacts.length,
    },
  };
}

function indexById(list) {
  const map = new Map();
  for (const row of list || []) {
    if (row?.id == null) continue;
    map.set(String(row.id), row);
  }
  return map;
}

function stampOwnerFields(record, actor) {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };
  const name = actor?.user || actor?.displayName || null;
  if (name && !next.ownerId && !next.assignee) {
    if ('ownerId' in next || next.title != null) next.ownerId = next.ownerId || name;
  }
  if (actor?.identityId && !next.ownerIdentityId) next.ownerIdentityId = actor.identityId;
  if (actor?.email && !next.ownerEmail) next.ownerEmail = actor.email;
  return next;
}

/**
 * Read the caller's personal prefs from the org workspace.
 * Supports legacy flat `userPrefs.profile` and keyed `userPrefs.profiles[id]`.
 */
function prefsForIdentity(userPrefs, identityId) {
  const raw = userPrefs && typeof userPrefs === 'object' ? userPrefs : {};
  const profiles = raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  if (identityId && profiles[identityId] && typeof profiles[identityId] === 'object') {
    return { ...profiles[identityId] };
  }
  // Legacy singleton — only expose when caller has no identity (or as seed).
  const legacy = {};
  if (raw.profile && typeof raw.profile === 'object') legacy.profile = { ...raw.profile };
  if (raw.notifications && typeof raw.notifications === 'object') {
    legacy.notifications = { ...raw.notifications };
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'profiles' || k === 'profile' || k === 'notifications') continue;
    legacy[k] = v;
  }
  return legacy;
}

/**
 * Merge one member's prefs into keyed storage without clobbering teammates.
 */
function mergePrefsForIdentity(fullPrefs, memberPrefs, identityId) {
  const full = fullPrefs && typeof fullPrefs === 'object' ? { ...fullPrefs } : {};
  const member = memberPrefs && typeof memberPrefs === 'object' ? memberPrefs : {};
  if (!identityId) {
    // No identity → keep legacy shallow merge (automation / demos).
    return { ...full, ...member };
  }
  const profiles = { ...(full.profiles && typeof full.profiles === 'object' ? full.profiles : {}) };
  const prev = prefsForIdentity(full, identityId);
  const incoming = { ...member };
  // Prefer explicit profile object; otherwise treat top-level as prefs blob.
  const nextProfile = incoming.profile && typeof incoming.profile === 'object'
    ? { ...(prev.profile || {}), ...incoming.profile }
    : (prev.profile || undefined);
  const next = {
    ...prev,
    ...incoming,
    ...(nextProfile ? { profile: nextProfile } : {}),
  };
  if (incoming.notifications && typeof incoming.notifications === 'object') {
    next.notifications = { ...(prev.notifications || {}), ...incoming.notifications };
  }
  profiles[identityId] = next;
  full.profiles = profiles;
  // Do not keep a shared singleton profile once keyed profiles exist.
  return full;
}

function calendarConnectionsForIdentity(connections, identityId) {
  const raw = connections && typeof connections === 'object' ? connections : {};
  if (!identityId || raw[identityId] == null) return {};
  return { [identityId]: stripConnectionSecrets(raw[identityId]) };
}

const CONNECTION_SECRET_KEYS = ['access_token', 'refresh_token', 'id_token', 'token'];

function stripAllConnectionSecrets(connections) {
  const raw = connections && typeof connections === 'object' ? connections : {};
  const out = {};
  for (const [identityId, bundle] of Object.entries(raw)) {
    out[identityId] = stripConnectionSecrets(bundle);
  }
  return out;
}

function stripConnectionSecrets(bundle) {
  if (!bundle || typeof bundle !== 'object') return bundle;
  const out = {};
  for (const [provider, conn] of Object.entries(bundle)) {
    if (!conn || typeof conn !== 'object' || Array.isArray(conn)) {
      out[provider] = conn;
      continue;
    }
    const clean = { ...conn };
    for (const key of CONNECTION_SECRET_KEYS) delete clean[key];
    out[provider] = clean;
  }
  return out;
}

function preserveConnectionSecrets(previous, incoming) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const merged = {};
  for (const provider of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const oldP = prev[provider];
    const newP = next[provider];
    if (!oldP || typeof oldP !== 'object') continue;
    if (!newP || typeof newP !== 'object') {
      merged[provider] = oldP;
      continue;
    }
    const combined = { ...oldP, ...newP };
    for (const key of CONNECTION_SECRET_KEYS) {
      if (oldP[key]) combined[key] = oldP[key];
      else delete combined[key];
    }
    merged[provider] = combined;
  }
  return merged;
}

function noteBoardHasOwner(board) {
  return !!(board?.ownerId || board?.owner || board?.createdBy
    || board?.user || board?.author || board?.ownerIdentityId);
}

function noteBoardOwnedBy(board, aliases) {
  if (!noteBoardHasOwner(board)) return false;
  return recordOwnedBy(board, aliases, ['ownerId', 'owner', 'createdBy', 'user', 'author', 'ownerIdentityId']);
}

/**
 * Merge a member's scoped PUT into the full org workspace without wiping teammates.
 */
function mergeMemberWorkspace(fullState, memberState, actor) {
  const full = fullState && typeof fullState === 'object' ? { ...fullState } : {};
  const member = memberState && typeof memberState === 'object' ? memberState : {};
  const aliases = buildActorAliases(actor);

  // Org-wide config: members cannot overwrite via scoped save
  for (const key of MEMBER_READ_ONLY_KEYS) {
    if (full[key] !== undefined) member[key] = undefined;
  }

  for (const key of SCOPED_ARRAY_KEYS) {
    const fullList = Array.isArray(full[key]) ? full[key] : [];
    const memberList = Array.isArray(member[key]) ? member[key] : null;
    if (!memberList) continue;

    const ownedFilter = (row) => {
      if (key === 'deals') return dealOwnedBy(row, aliases);
      if (key === 'tasks') return taskOwnedBy(row, aliases);
      if (key === 'supportTickets') return ticketOwnedBy(row, aliases);
      if (key === 'contacts') {
        const ownedNames = collectOwnedContactNames(
          Array.isArray(member.deals) ? member.deals : full.deals,
          full.contacts,
          aliases,
        );
        return contactOwnedBy(row, aliases, ownedNames);
      }
      if (key === 'auditLog' || key === 'usageLog') {
        return matchesAlias(row?.user, aliases) || matchesAlias(row?.email, aliases)
          || matchesAlias(row?.identityId, aliases);
      }
      if (key === 'dealComments') {
        return matchesAlias(row?.user, aliases);
      }
      if (key === 'crmQuotas') {
        return recordOwnedBy(row, aliases, ['assigneeId', 'assigneeName', 'createdBy']);
      }
      if (key === 'aiThreads') {
        return recordOwnedBy(row, aliases, ['ownerName', 'ownerEmail', 'user']);
      }
      if (key === 'emailLog') {
        return recordOwnedBy(row, aliases, ['user', 'from', 'createdBy', 'ownerId']);
      }
      if (key === 'notes' || key === 'meetings' || key === 'quotes' || key === 'submissions' || key === 'companies') {
        return recordOwnedBy(row, aliases, [
          'ownerId', 'owner', 'assignee', 'createdBy', 'assignedTo', 'organizer', 'user', 'author',
        ]);
      }
      return recordOwnedBy(row, aliases, ['ownerId', 'assignee', 'createdBy', 'user']);
    };

    const fullById = indexById(fullList);
    const memberMayTouch = (row) => {
      const existing = row?.id == null ? null : fullById.get(String(row.id));
      // A row already owned by someone else stays theirs.
      if (existing && !ownedFilter(existing)) return false;
      return true;
    };
    const keepOthers = fullList.filter((row) => !ownedFilter(row));
    const memberIds = new Set(
      memberList.filter(memberMayTouch).map((r) => String(r?.id)).filter(Boolean),
    );
    // Drop owned rows the member deleted (were owned, not in member payload)
    const stampedMember = memberList.filter(memberMayTouch).map((row) => {
      const existing = row?.id == null ? null : fullById.get(String(row.id));
      const base = existing ? { ...existing, ...row } : stampOwnerFields(row, actor);
      if (existing) {
        // Never rewrite another person's ownership onto a row the member may edit.
        for (const field of ['ownerId', 'owner', 'ownerEmail', 'ownerIdentityId', 'assignee', 'createdBy']) {
          if (existing[field]) base[field] = existing[field];
        }
      }
      const name = actor.user || actor.displayName || null;
      if (key === 'deals' && !base.ownerId && name) {
        base.ownerId = name;
      }
      if (key === 'tasks' && !base.assignee && name) {
        base.assignee = name;
      }
      if ((key === 'notes' || key === 'dealComments' || key === 'usageLog') && !base.createdBy && !base.user && name) {
        if (key === 'usageLog' || key === 'dealComments') base.user = base.user || name;
        else base.createdBy = name;
      }
      if (key === 'supportTickets' && !base.assignee && name) {
        base.assignee = name;
      }
      return base;
    });

    const othersById = indexById(keepOthers);
    for (const id of memberIds) {
      othersById.delete(id);
    }
    full[key] = [...othersById.values(), ...stampedMember];
  }

  // Non-scoped keys the member may edit for themselves
  const identityId = actor?.identityId || null;
  if (member.userPrefs && typeof member.userPrefs === 'object') {
    full.userPrefs = mergePrefsForIdentity(full.userPrefs, member.userPrefs, identityId);
  }
  if (member.calendarConnections && typeof member.calendarConnections === 'object' && identityId) {
    const all = {
      ...(full.calendarConnections && typeof full.calendarConnections === 'object'
        ? full.calendarConnections
        : {}),
    };
    if (member.calendarConnections[identityId] != null) {
      all[identityId] = preserveConnectionSecrets(all[identityId], member.calendarConnections[identityId]);
    } else if (Object.keys(member.calendarConnections).length) {
      all[identityId] = preserveConnectionSecrets(
        all[identityId],
        member.calendarConnections[identityId] || member.calendarConnections,
      );
    }
    full.calendarConnections = all;
  }
  if (member.noteBoards && Array.isArray(member.noteBoards)) {
    const fullBoards = Array.isArray(full.noteBoards) ? full.noteBoards : [];
    const keepOthers = fullBoards.filter((b) => !noteBoardOwnedBy(b, aliases));
    const stamped = member.noteBoards.map((b) => stampOwnerFields({ ...b }, actor));
    full.noteBoards = [...keepOthers, ...stamped];
  }

  return full;
}

/**
 * Team activity feed for the Team Viewer (what everyone is doing).
 */
function buildTeamActivity(state, { limit = 50, teamMembers = [] } = {}) {
  const usage = Array.isArray(state?.usageLog) ? state.usageLog : [];
  const audit = Array.isArray(state?.auditLog) ? state.auditLog : [];
  const items = [];

  for (const e of usage) {
    items.push({
      kind: 'usage',
      at: e.at || null,
      user: e.user || 'Unknown',
      action: e.action || 'action',
      entity: e.entity || null,
      entityId: e.entityId ?? null,
      detail: e.action || 'CRM activity',
    });
  }
  for (const e of audit) {
    items.push({
      kind: 'audit',
      at: e.at || null,
      user: e.user || 'Unknown',
      action: e.action || 'updated',
      entity: e.entity || null,
      entityId: e.entityId ?? null,
      detail: [e.action, e.entity, e.entityName || e.field].filter(Boolean).join(' · '),
    });
  }

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const byUser = new Map();
  for (const name of teamMembers) {
    byUser.set(String(name), { user: name, actions: 0, lastAt: null, lastDetail: null });
  }
  for (const item of items) {
    const key = item.user || 'Unknown';
    const row = byUser.get(key) || { user: key, actions: 0, lastAt: null, lastDetail: null };
    row.actions += 1;
    if (!row.lastAt || String(item.at) > String(row.lastAt)) {
      row.lastAt = item.at;
      row.lastDetail = item.detail;
    }
    byUser.set(key, row);
  }

  return {
    feed: items.slice(0, Math.min(200, Math.max(1, limit))),
    by_user: [...byUser.values()].sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || ''))),
  };
}

module.exports = {
  ORG_WIDE_ROLES,
  SCOPED_ARRAY_KEYS,
  isOrgWideRole,
  buildActorAliases,
  matchesAlias,
  dealOwnedBy,
  taskOwnedBy,
  filterWorkspaceForAccess,
  mergeMemberWorkspace,
  buildTeamActivity,
  stampOwnerFields,
  prefsForIdentity,
  mergePrefsForIdentity,
  calendarConnectionsForIdentity,
};
