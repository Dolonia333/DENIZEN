'use strict';

const denizenDb = require('../intelligence/denizen-db');
const npcTeamSoul = require('../npc/npc-team-soul');
const personalityBridge = require('../npc/npc-personality-bridge');

function isEnabled() {
  return !!denizenDb.enabled;
}

function toClientOrgTeam(template, members = []) {
  if (!template) return null;
  return {
    id: template.id,
    org_id: template.org_id,
    name: template.name || 'Org NPC defaults',
    purpose: template.purpose || null,
    settings: template.settings || {},
    members: (members || []).map((m) => {
      const settings = m.settings || {};
      return {
        id: m.id,
        npc_key: m.npc_key,
        display_name: m.display_name || m.npc_key,
        role: m.role || 'assistant',
        focus: m.focus || null,
        instructions: m.instructions || null,
        job: settings.job || null,
        soul_snippet: settings.soul_snippet || null,
        personality: personalityBridge.normalizePersonality(settings.personality),
        extra_skills: personalityBridge.normalizeExtraSkills(settings.extra_skills),
        sort_order: Number(m.sort_order) || 0,
        active: m.active !== false,
        settings,
        portrait: npcTeamSoul.portraitMeta(m.npc_key),
      };
    }),
  };
}

async function getOrgTemplate(orgId) {
  if (!isEnabled() || !orgId) return null;
  const rows = await denizenDb._getSoft(
    `denizen_org_npc_team_templates?select=*&org_id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function ensureOrgTemplate(orgId, { name = 'Org NPC defaults', purpose = null } = {}) {
  if (!isEnabled() || !orgId) return null;
  const existing = await getOrgTemplate(orgId);
  if (existing?.id) return existing;
  const rows = await denizenDb._postSoft(
    'denizen_org_npc_team_templates',
    { org_id: orgId, name, purpose },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function updateOrgTemplate(orgId, { name, purpose, settings } = {}) {
  if (!isEnabled() || !orgId) return null;
  const template = await ensureOrgTemplate(orgId);
  if (!template?.id) return null;
  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = String(name || 'Org NPC defaults').slice(0, 160);
  if (purpose !== undefined) patch.purpose = String(purpose || '').slice(0, 1000) || null;
  if (settings && typeof settings === 'object') patch.settings = settings;
  const rows = await denizenDb._patchSoft(
    `denizen_org_npc_team_templates?id=eq.${encodeURIComponent(template.id)}`,
    patch,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || { ...template, ...patch };
}

async function listOrgMembers(orgId) {
  if (!isEnabled() || !orgId) return [];
  const rows = await denizenDb._getSoft(
    [
      'denizen_org_npc_team_members?select=*',
      `org_id=eq.${encodeURIComponent(orgId)}`,
      'active=eq.true',
      'order=sort_order.asc,created_at.asc',
    ].join('&'),
  );
  return rows || [];
}

async function getOrgMember(orgId, npcKey) {
  if (!isEnabled() || !orgId || !npcKey) return null;
  const key = String(npcKey).trim().toLowerCase();
  const rows = await denizenDb._getSoft(
    `denizen_org_npc_team_members?select=*&org_id=eq.${encodeURIComponent(orgId)}&npc_key=eq.${encodeURIComponent(key)}&active=eq.true&limit=1`,
  );
  return rows?.[0] || null;
}

async function upsertOrgMember(orgId, {
  npcKey,
  displayName = null,
  role = 'assistant',
  focus = null,
  instructions = null,
  job = null,
  soulSnippet = null,
  personality = null,
  extraSkills = null,
  sortOrder = 0,
  settings = {},
} = {}) {
  if (!isEnabled() || !orgId || !npcKey) return null;
  const template = await ensureOrgTemplate(orgId);
  if (!template?.id) return null;
  const key = String(npcKey).trim().toLowerCase();
  const existingRows = await denizenDb._getSoft(
    `denizen_org_npc_team_members?select=*&org_id=eq.${encodeURIComponent(orgId)}&npc_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  const existing = existingRows?.[0] || null;

  const settingsPatch = {
    ...(settings && typeof settings === 'object' ? settings : {}),
  };
  if (job !== undefined && job !== null) settingsPatch.job = String(job).slice(0, 500);
  if (soulSnippet !== undefined) {
    settingsPatch.soul_snippet = personalityBridge.sanitizeSoulSnippet(soulSnippet) || null;
  }
  if (personality !== undefined && personality !== null) {
    settingsPatch.personality = personalityBridge.normalizePersonality(personality);
  }
  if (extraSkills !== undefined) {
    settingsPatch.extra_skills = personalityBridge.normalizeExtraSkills(extraSkills);
  }

  const mergedSettings = npcTeamSoul.mergeMemberSettings(
    existing?.settings,
    settingsPatch,
    {
      npc_key: key,
      display_name: displayName ?? existing?.display_name ?? key,
      role: role ?? existing?.role ?? 'assistant',
      focus: focus ?? existing?.focus,
      instructions: instructions ?? existing?.instructions,
    },
  );

  const row = {
    template_id: template.id,
    org_id: orgId,
    npc_key: key,
    display_name: displayName || existing?.display_name || key,
    role: role || existing?.role || 'assistant',
    focus: focus !== undefined ? (focus || null) : (existing?.focus || null),
    instructions: instructions !== undefined ? (instructions || null) : (existing?.instructions || null),
    sort_order: Number(sortOrder) || Number(existing?.sort_order) || 0,
    active: true,
    settings: mergedSettings,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const rows = await denizenDb._patchSoft(
      `denizen_org_npc_team_members?id=eq.${encodeURIComponent(existing.id)}`,
      row,
      { prefer: 'return=representation' },
    );
    return rows?.[0] || null;
  }
  const rows = await denizenDb._postSoft(
    'denizen_org_npc_team_members',
    row,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function deactivateOrgMember(orgId, npcKey) {
  if (!isEnabled() || !orgId || !npcKey) return null;
  const rows = await denizenDb._patchSoft(
    `denizen_org_npc_team_members?org_id=eq.${encodeURIComponent(orgId)}&npc_key=eq.${encodeURIComponent(String(npcKey).trim().toLowerCase())}`,
    { active: false, updated_at: new Date().toISOString() },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function getOrgTeam(orgId) {
  const template = await getOrgTemplate(orgId);
  if (!template?.id) return null;
  const members = await listOrgMembers(orgId);
  return toClientOrgTeam(template, members);
}

module.exports = {
  toClientOrgTeam,
  getOrgTemplate,
  ensureOrgTemplate,
  updateOrgTemplate,
  listOrgMembers,
  getOrgMember,
  upsertOrgMember,
  deactivateOrgMember,
  getOrgTeam,
};
