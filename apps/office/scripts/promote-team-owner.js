'use strict';

/**
 * Promote a team account to owner (skill proposal approval in Account → Skills).
 *
 * Usage:
 *   node scripts/promote-team-owner.js you@company.com
 *   DENIZEN_TEAM_OWNER_EMAIL=you@company.com node scripts/promote-team-owner.js
 */

require('../src/load-env');
const denizenDb = require('../src/intelligence/denizen-db');
const promptTuning = require('../src/intelligence/prompt-tuning');

async function main() {
  const email = String(process.argv[2] || process.env.DENIZEN_TEAM_OWNER_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/promote-team-owner.js <email>');
    console.error('Or set DENIZEN_TEAM_OWNER_EMAIL in .env');
    process.exit(1);
  }
  if (!denizenDb.enabled) {
    console.error('Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const orgRows = await denizenDb._get(
    `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(promptTuning.teamOrgSlug)}&limit=1`,
  );
  const org = orgRows?.[0];
  if (!org) {
    console.error(`Team org "${promptTuning.teamOrgSlug}" not found`);
    process.exit(1);
  }

  const accounts = await denizenDb._get(
    `denizen_team_accounts?select=id,email,role,display_name&org_id=eq.${encodeURIComponent(org.id)}&email=eq.${encodeURIComponent(email)}&limit=1`,
  );
  const account = accounts?.[0];
  if (!account) {
    console.error(`No team account for ${email} in org ${org.slug}. Register via Team email login first.`);
    process.exit(1);
  }

  if (account.role === 'owner') {
    console.log(`Already owner: ${account.display_name || email} (${email})`);
    process.exit(0);
  }

  await denizenDb._patch(
    `denizen_team_accounts?id=eq.${encodeURIComponent(account.id)}`,
    { role: 'owner' },
    { prefer: 'return=minimal' },
  );

  console.log(`Promoted ${account.display_name || email} (${email}) to owner in org ${org.slug}.`);
  console.log('Skill proposals will appear in Account → Skills after next login.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
