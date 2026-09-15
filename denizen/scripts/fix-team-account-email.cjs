#!/usr/bin/env node
'use strict';
/**
 * Admin: point a team account at the correct email (and optionally username).
 *
 * Usage:
 *   node --env-file=.env scripts/fix-team-account-email.cjs \
 *     --from info@royalsocietymanagement.com \
 *     --to info@royalsocietymanagementgroup.com \
 *     [--username kaiser] \
 *     [--org-slug zion] \
 *     [--delete-dupes]
 *
 * --delete-dupes removes other team_accounts rows that already use --to
 * (same org preferred; also drops stray auto-created rows with username "info").
 */
require('../src/load-env');
const denizenDb = require('../src/denizen-db');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const fromEmail = String(arg('from') || '').toLowerCase();
  const toEmail = String(arg('to') || '').toLowerCase();
  const username = arg('username');
  const orgSlug = arg('org-slug');
  const deleteDupes = hasFlag('delete-dupes');

  if (!fromEmail || !toEmail) {
    console.error('Usage: node scripts/fix-team-account-email.cjs --from <email> --to <email> [--username kaiser] [--org-slug zion] [--delete-dupes]');
    process.exit(1);
  }
  if (!denizenDb.enabled) {
    console.error('Supabase not configured (SUPABASE_URL + key)');
    process.exit(1);
  }

  let orgId = null;
  if (orgSlug) {
    const orgs = await denizenDb._get(
      `denizen_organizations?select=id,slug,display_name&slug=eq.${encodeURIComponent(orgSlug)}&limit=1`,
    );
    if (!orgs?.[0]) {
      console.error('Org not found for slug:', orgSlug);
      process.exit(1);
    }
    orgId = orgs[0].id;
    console.log('Org:', orgs[0].display_name || orgs[0].slug, orgId);
  }

  let q = `denizen_team_accounts?select=*&email=eq.${encodeURIComponent(fromEmail)}`;
  if (orgId) q += `&org_id=eq.${encodeURIComponent(orgId)}`;
  if (username) q += `&username=eq.${encodeURIComponent(username.toLowerCase())}`;
  q += '&limit=5';

  const rows = await denizenDb._get(q);
  if (!rows?.length) {
    console.error('No team account matched --from', fromEmail, username ? `(username ${username})` : '');
    process.exit(1);
  }
  if (rows.length > 1 && !orgId) {
    console.error('Multiple accounts for --from; pass --org-slug to disambiguate:');
    for (const r of rows) console.error(' ', r.id, r.org_id, r.username, r.email);
    process.exit(1);
  }

  const account = rows[0];
  console.log('Updating account', account.id, account.username, account.email, '→', toEmail);

  if (deleteDupes) {
    let dq = `denizen_team_accounts?select=id,username,email,org_id&email=eq.${encodeURIComponent(toEmail)}`;
    if (orgId) dq += `&org_id=eq.${encodeURIComponent(orgId)}`;
    const dupes = await denizenDb._get(dq).catch(() => []);
    for (const d of dupes || []) {
      if (d.id === account.id) continue;
      console.log('Deleting duplicate', d.id, d.username, d.email);
      await denizenDb._delete(`denizen_team_accounts?id=eq.${encodeURIComponent(d.id)}`);
    }
  }

  const patch = { email: toEmail };
  if (username) patch.username = String(username).trim().toLowerCase();
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${encodeURIComponent(account.id)}`,
    patch,
    { prefer: 'return=minimal' },
  );

  // Keep identity email in sync when present
  const idents = await denizenDb._get(
    `denizen_user_identities?select=id,email,email_normalized&or=(email.eq.${encodeURIComponent(fromEmail)},email_normalized.eq.${encodeURIComponent(fromEmail)})&limit=5`,
  ).catch(() => []);
  for (const ident of idents || []) {
    console.log('Updating identity', ident.id, ident.email, '→', toEmail);
    await denizenDb._patch(
      `denizen_user_identities?id=eq.${encodeURIComponent(ident.id)}`,
      { email: toEmail, email_normalized: toEmail },
      { prefer: 'return=minimal' },
    );
  }

  console.log('Done. Kaiser / Look At This Media should now log in with:');
  console.log('  email:', toEmail);
  console.log('  username:', username || account.username);
  console.log('  team code: (their Zion / Look At This Media code)');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
