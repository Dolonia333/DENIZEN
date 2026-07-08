#!/usr/bin/env node
'use strict';
/** Clone template pack (souls + business model) to an org. */
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}

const denizenDb = require('../src/intelligence/denizen-db');
const agentSouls = require('../src/npc/agent-souls');

async function main() {
  const orgSlug = process.argv[2];
  const templatePack = process.argv[3] || '1921-govcon';
  if (!orgSlug) {
    console.error('Usage: node scripts/clone-template-pack.js <org_slug> [template_pack]');
    process.exit(1);
  }

  const init = await denizenDb.init();
  if (!init?.ok) {
    console.error('DB init failed:', init);
    process.exit(1);
  }

  const orgs = await denizenDb._get(
    `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(orgSlug)}`,
  );
  const orgId = orgs?.[0]?.id;
  if (!orgId) {
    console.error(`Org not found: ${orgSlug}`);
    process.exit(1);
  }

  const result = await agentSouls.cloneTemplatePackToOrg(denizenDb, orgId, templatePack);
  console.log(JSON.stringify({ ok: true, orgSlug, orgId, ...result }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
