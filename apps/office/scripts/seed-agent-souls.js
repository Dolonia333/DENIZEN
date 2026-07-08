'use strict';
/**
 * Seed agent_souls from npc SOUL.md + MEMORY.md files for an org.
 * Usage: node scripts/seed-agent-souls.js [org_slug] [template_pack]
 */
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const denizenDb = require('../src/intelligence/denizen-db');
const agentSouls = require('../src/npc/agent-souls');

async function main() {
  const orgSlug = process.argv[2] || process.env.DENIZEN_ORG_SLUG || 'zion';
  const templatePack = process.argv[3] || '1921-govcon';

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

  const souls = agentSouls.loadSoulsForTemplatePack(templatePack);
  let upserted = 0;
  for (const s of souls) {
    if (!s.soul_content?.trim()) {
      console.warn(`skip ${s.npc_key}: empty SOUL`);
      continue;
    }
    await denizenDb.upsertAgentSoul({
      orgId,
      npcKey: s.npc_key,
      displayName: s.display_name,
      soulContent: s.soul_content,
      memoryContent: s.memory_content || '',
      templatePack,
    });
    upserted += 1;
    console.log(`ok ${s.display_name} (${s.npc_key})`);
  }

  console.log(JSON.stringify({ ok: true, orgSlug, orgId, templatePack, upserted }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
