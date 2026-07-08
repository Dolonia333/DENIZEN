'use strict';

/**
 * Org-scoped SOUL/MEMORY loading — file fallback for dev, DB for multi-tenant.
 */

const fs = require('fs');
const path = require('path');
const npcRoster = require('./npc-roster');
const genericSoulPack = require('./generic-soul-pack');
const NPCS_DIR = path.join(__dirname, '..', 'npcs');
const DISPLAY_BY_FOLDER = Object.fromEntries(
  (npcRoster.entries || []).map((e) => [e.folder, e.display]),
);
const FOLDER_BY_DISPLAY = Object.fromEntries(
  (npcRoster.entries || []).map((e) => [e.display, e.folder]),
);

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return '';
  }
}

function loadSoulFromFiles(npcKey) {
  const soul = readFileSafe(path.join(NPCS_DIR, npcKey, 'SOUL.md'));
  const memory = readFileSafe(path.join(NPCS_DIR, npcKey, 'MEMORY.md'));
  return {
    npc_key: npcKey,
    display_name: DISPLAY_BY_FOLDER[npcKey] || npcKey,
    soul_content: soul,
    memory_content: memory,
    source: 'file',
  };
}

function loadAllSoulsFromFiles() {
  return (npcRoster.entries || []).map((e) => loadSoulFromFiles(e.folder));
}

function parseSoulMeta(soul) {
  const providerMatch = soul.match(/## Provider\r?\n([\w-]+)/);
  const roleMatch = soul.match(/## Role\r?\n(.+)/);
  const capMatch = soul.match(/## What You Can Do\r?\n([\s\S]+?)(?=\r?\n## )/);
  return {
    provider: providerMatch?.[1] || 'lmstudio',
    role: (roleMatch?.[1] || 'Employee').trim(),
    capabilitiesSoul: capMatch ? capMatch[1].trim() : null,
  };
}

function displayToFolder(nameOrKey) {
  if (!nameOrKey) return null;
  const s = String(nameOrKey);
  if (FOLDER_BY_DISPLAY[s]) return FOLDER_BY_DISPLAY[s];
  const lower = s.toLowerCase();
  if (DISPLAY_BY_FOLDER[lower]) return lower;
  const hit = (npcRoster.entries || []).find(
    (e) => e.display.toLowerCase() === lower || e.folder === lower,
  );
  return hit?.folder || null;
}

function loadSoulsForTemplatePack(templatePack = '1921-govcon') {
  if (templatePack === genericSoulPack.TEMPLATE_PACK || templatePack === 'generic-office') {
    return genericSoulPack.loadAllGenericSouls();
  }
  return loadAllSoulsFromFiles();
}

function isOperatorOrgId(denizenDb, orgId) {
  return !!(denizenDb?.orgId && orgId && String(orgId) === String(denizenDb.orgId));
}

async function loadSoulForOrg(denizenDb, orgId, npcKeyOrName) {
  const folder = displayToFolder(npcKeyOrName);
  if (!folder) return null;

  if (denizenDb?.enabled && orgId) {
    const row = await denizenDb.getAgentSoul(orgId, folder);
    if (row?.soul_content) {
      return {
        npc_key: folder,
        display_name: row.display_name || DISPLAY_BY_FOLDER[folder],
        soul_content: row.soul_content,
        memory_content: row.memory_content || '',
        template_pack: row.template_pack || null,
        source: 'database',
      };
    }
    if (!isOperatorOrgId(denizenDb, orgId)) {
      return genericSoulPack.loadGenericSoul(folder);
    }
  }

  return loadSoulFromFiles(folder);
}

async function listSoulsForOrg(denizenDb, orgId) {
  if (denizenDb?.enabled && orgId) {
    const rows = await denizenDb.listAgentSouls(orgId);
    if (rows?.length) return rows.map((r) => ({ ...r, source: 'database' }));
    if (!isOperatorOrgId(denizenDb, orgId)) {
      return genericSoulPack.loadAllGenericSouls();
    }
  }
  return loadAllSoulsFromFiles();
}

async function cloneTemplatePackToOrg(denizenDb, orgId, templatePack = '1921-govcon') {
  if (!denizenDb?.enabled || !orgId) {
    throw new Error('database unavailable or missing orgId');
  }
  const souls = loadSoulsForTemplatePack(templatePack);
  let upserted = 0;
  for (const s of souls) {
    if (!s.soul_content?.trim()) continue;
    await denizenDb.upsertAgentSoul({
      orgId,
      npcKey: s.npc_key,
      displayName: s.display_name,
      soulContent: s.soul_content,
      memoryContent: s.memory_content || '',
      templatePack,
    });
    upserted += 1;
  }
  const businessContext = require('./denizen-business-context');
  const isGeneric = templatePack === genericSoulPack.TEMPLATE_PACK || templatePack === 'generic-office';
  await denizenDb.upsertOrgBusinessModel({
    orgId,
    templatePack,
    businessModel: isGeneric
      ? genericSoulPack.loadGenericBusinessModel()
      : businessContext.loadBusinessModel(),
    companyBrief: isGeneric
      ? genericSoulPack.loadGenericCompanyBrief()
      : businessContext.loadCompanyBrief(),
  });
  return { upserted, templatePack };
}
module.exports = {
  loadSoulFromFiles,
  loadAllSoulsFromFiles,
  loadSoulsForTemplatePack,
  loadSoulForOrg,  listSoulsForOrg,
  cloneTemplatePackToOrg,
  parseSoulMeta,
  displayToFolder,
  DISPLAY_BY_FOLDER,
  FOLDER_BY_DISPLAY,
};
