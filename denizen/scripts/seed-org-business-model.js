#!/usr/bin/env node
'use strict';
/** Seed org_business_models from data/*.json for an org. */
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}

const denizenDb = require('../src/denizen-db');
const businessContext = require('../src/denizen-business-context');
const genericSoulPack = require('../src/generic-soul-pack');

async function main() {
  const orgSlug = process.argv[2] || process.env.DENIZEN_ORG_SLUG || 'zion';
  const templatePack = process.argv[3] || '1921-govcon';
  const isGeneric = templatePack === genericSoulPack.TEMPLATE_PACK || templatePack === 'generic-office';

  const init = await denizenDb.init();
  if (!init?.ok || !denizenDb.orgId) {
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

  const row = await denizenDb.upsertOrgBusinessModel({
    orgId,
    templatePack,
    businessModel: isGeneric
      ? genericSoulPack.loadGenericBusinessModel()
      : businessContext.loadBusinessModel(),
    companyBrief: isGeneric
      ? genericSoulPack.loadGenericCompanyBrief()
      : businessContext.loadCompanyBrief(),
  });
  console.log(JSON.stringify({
    ok: true,
    orgSlug,
    orgId,
    templatePack,
    entity: row?.business_model?.entity?.legal_name || businessContext.loadBusinessModel()?.entity?.legal_name,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
