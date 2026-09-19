'use strict';

/**
 * Sync Studio Board people strip from denizen_team_accounts for an org.
 */

const denizenDb = require('./denizen-db');

const AV_COLORS = [
  '#3d6b4f', '#5a7a9a', '#8b6914', '#7a4a6a', '#4a6b7a',
  '#6b5a3d', '#3d5a6b', '#6b3d4a', '#4a6b3d', '#5a4a6b',
];

function uid() {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

async function listTeamAccounts(orgId) {
  if (!orgId || !denizenDb.enabled) return [];
  const rows = await denizenDb._get(
    `denizen_team_accounts?select=id,display_name,email,role,visitor_session_id,username`
    + `&org_id=eq.${encodeURIComponent(orgId)}&order=display_name`,
  ).catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

function matchPerson(people, account) {
  const email = norm(account.email);
  const identityId = norm(account.identity_id);
  const name = norm(account.display_name || account.username);
  return (people || []).find((p) => identityId && norm(p.identityId || p.identity_id) === identityId)
    || (people || []).find((p) => email && norm(p.email) === email)
    || (people || []).find((p) => account.id && String(p.teamAccountId || '') === String(account.id))
    || (people || []).find((p) => name && norm(p.name) === name)
    || null;
}

/**
 * Merge org team logins into state.people. Returns { state, changed }.
 */
function syncPeopleFromAccounts(state, accounts) {
  const next = state && typeof state === 'object' ? { ...state } : { people: [] };
  const people = Array.isArray(next.people) ? [...next.people] : [];
  let changed = false;

  for (const account of accounts || []) {
    const displayName = String(account.display_name || account.username || account.email || '').trim();
    if (!displayName && !account.email) continue;
    let person = matchPerson(people, account);
    if (!person) {
      person = {
        id: uid(),
        name: (displayName || account.email || 'Teammate').slice(0, 120),
        role: account.role === 'owner' || account.role === 'admin' ? 'Lead' : 'Team member',
        color: AV_COLORS[people.length % AV_COLORS.length],
        fromTeamAccount: true,
      };
      people.push(person);
      changed = true;
    }
    if (account.email && norm(person.email) !== norm(account.email)) {
      person.email = String(account.email).toLowerCase();
      changed = true;
    }
    if (account.identity_id && !(person.identityId || person.identity_id)) {
      person.identityId = account.identity_id;
      changed = true;
    }
    if (account.id && String(person.teamAccountId || '') !== String(account.id)) {
      person.teamAccountId = account.id;
      changed = true;
    }
    if (!person.fromTeamAccount) {
      person.fromTeamAccount = true;
      changed = true;
    }
  }

  next.people = people;
  return { state: next, changed };
}

async function syncOrgRoster(state, orgId) {
  const accounts = await listTeamAccounts(orgId);
  return syncPeopleFromAccounts(state, accounts);
}

module.exports = {
  listTeamAccounts,
  syncPeopleFromAccounts,
  syncOrgRoster,
  AV_COLORS,
};
