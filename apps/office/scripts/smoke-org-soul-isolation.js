#!/usr/bin/env node
'use strict';
/** Smoke: zion vs acme soul isolation on NAS. */
const denizenDb = require('../src/denizen-db');
const agentSouls = require('../src/agent-souls');

(async () => {
  const init = await denizenDb.init();
  if (!init?.ok) {
    console.log(JSON.stringify({ ok: false, error: 'db_init' }));
    process.exit(1);
  }
  const orgs = await denizenDb._get('denizen_organizations?select=id,slug');
  const zion = orgs.find((o) => o.slug === 'zion');
  const acme = orgs.find((o) => o.slug === 'acme');
  if (!zion?.id || !acme?.id) {
    console.log(JSON.stringify({ ok: false, error: 'missing_org', orgs: orgs.map((o) => o.slug) }));
    process.exit(1);
  }
  const zAbby = await agentSouls.loadSoulForOrg(denizenDb, zion.id, 'Abby');
  const aAbby = await agentSouls.loadSoulForOrg(denizenDb, acme.id, 'Abby');
  const zText = zAbby?.soul_content || '';
  const aText = aAbby?.soul_content || '';
  const result = {
    ok: true,
    zion_has_omes: /OMES|1921 Holding/i.test(zText),
    acme_generic: /generic Denizen office/i.test(aText),
    acme_no_omes: !/OMES|RM Cyber|1921 Holding/i.test(aText),
    acme_pack: aAbby?.template_pack || null,
    zion_source: zAbby?.source || null,
    acme_source: aAbby?.source || null,
  };
  console.log(JSON.stringify(result));
  if (!result.zion_has_omes || !result.acme_generic || !result.acme_no_omes) {
    process.exit(1);
  }
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
