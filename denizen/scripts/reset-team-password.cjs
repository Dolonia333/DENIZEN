#!/usr/bin/env node
'use strict';
/**
 * Admin: reset denizen_team_accounts (+ linked identity) password by email.
 * Usage: node scripts/reset-team-password.cjs <email> <newPassword>
 */
require('../src/load-env');
const denizenDb = require('../src/denizen-db');
const { hashPassword } = require('../src/denizen-team-password');

const EMAIL = String(process.argv[2] || '').trim().toLowerCase();
const PASSWORD = String(process.argv[3] || '');

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Usage: node scripts/reset-team-password.cjs <email> <newPassword>');
    process.exit(1);
  }
  if (!denizenDb.enabled) {
    console.error('Supabase not configured (SUPABASE_URL + key)');
    process.exit(1);
  }

  const rows = await denizenDb._get(
    `denizen_team_accounts?select=id,username,email,display_name&email=eq.${encodeURIComponent(EMAIL)}&limit=1`,
  );
  const account = rows?.[0];
  if (!account?.id) {
    console.error('No team account for email:', EMAIL);
    process.exit(1);
  }

  const hash = hashPassword(PASSWORD);
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${account.id}`,
    { password_hash: hash },
    { prefer: 'return=minimal' },
  );

  const identRows = await denizenDb._get(
    `denizen_user_identities?select=id&email_normalized=eq.${encodeURIComponent(EMAIL)}&limit=1`,
  );
  if (identRows?.[0]?.id) {
    await denizenDb._patch(
      `denizen_user_identities?id=eq.${identRows[0].id}`,
      { password_hash: hash },
      { prefer: 'return=minimal' },
    );
  }

  console.log('Password reset OK');
  console.log('  email:', account.email);
  console.log('  username:', account.username);
  console.log('  display_name:', account.display_name);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
