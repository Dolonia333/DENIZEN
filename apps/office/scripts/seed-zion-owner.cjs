'use strict';
/**
 * One-time: register Zion as team owner on org zion with email + password.
 * Usage: node scripts/seed-zion-owner.cjs
 */
require('../src/load-env');
const denizenDb = require('../src/intelligence/denizen-db');
const { hashPassword, minPasswordLength, assertPasswordMinLength } = require('../src/auth/denizen-team-password');
const teamAuth = require('../src/auth/denizen-team-auth');

const EMAIL = 'zionvanzandt@gmail.com';
const USERNAME = 'Dolonia';
const DISPLAY = 'Dolonia';
const PASSWORD = process.argv[2] || '333';
const TEAM_CODE = process.env.DENIZEN_TEAM_CODE || '1921';

async function resetPassword(orgId, email, password) {
  const rows = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${orgId}&email=eq.${encodeURIComponent(email)}&limit=1`,
  );
  const account = rows?.[0];
  if (!account?.id) return false;
  const hash = hashPassword(password);
  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${account.id}`,
    { password_hash: hash },
    { prefer: 'return=minimal' },
  );
  const identRows = await denizenDb._get(
    `denizen_user_identities?select=id&email_normalized=eq.${encodeURIComponent(email)}&limit=1`,
  );
  if (identRows?.[0]?.id) {
    await denizenDb._patchSoft(
      `denizen_user_identities?id=eq.${identRows[0].id}`,
      { password_hash: hash },
      { prefer: 'return=minimal' },
    );
  }
  return true;
}

async function main() {
  try {
    assertPasswordMinLength(PASSWORD);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!denizenDb.enabled) {
    console.error('Supabase not configured');
    process.exit(1);
  }
  const orgRows = await denizenDb._get('denizen_organizations?select=id,slug&slug=eq.zion&limit=1');
  const org = orgRows?.[0];
  if (!org) {
    console.error('Org zion not found');
    process.exit(1);
  }

  const existing = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${org.id}&email=eq.${encodeURIComponent(EMAIL)}&limit=1`,
  );

  if (existing?.[0]) {
    await resetPassword(org.id, EMAIL, PASSWORD);
    console.log('Updated password for existing account:');
    console.log('  email:', EMAIL);
    console.log('  username:', USERNAME);
    console.log('  password:', PASSWORD);
    console.log('  min length (dev):', minPasswordLength());
    return;
  }

  try {
    const result = await teamAuth.joinTeamAccount({
      email: EMAIL,
      displayName: DISPLAY,
      username: USERNAME,
      password: PASSWORD,
      teamCode: TEAM_CODE,
    });
    console.log('Created team owner account:');
    console.log('  email:', EMAIL);
    console.log('  username:', USERNAME);
    console.log('  password:', PASSWORD);
    console.log('  org:', result.org_slug);
    console.log('  team code:', TEAM_CODE);
  } catch (err) {
    if (/already exists/i.test(String(err?.message || ''))) {
      await resetPassword(org.id, EMAIL, PASSWORD);
      console.log('Account exists — password reset to:', PASSWORD);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
