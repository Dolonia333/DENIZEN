'use strict';

const fs = require('node:fs');
const path = require('node:path');
const personalityBridge = require('./npc-personality-bridge');

const NPCS_DIR = path.join(__dirname, '..', '..', 'npcs');
const MAX_EXCERPT = 2400;
const MAX_MEMORY_LINES = 24;

function readFileSafe(filePath, maxChars = MAX_EXCERPT) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return String(text || '').slice(0, maxChars);
  } catch (_) {
    return '';
  }
}

function extractSection(markdown, heading) {
  const re = new RegExp(`## ${heading}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`, 'i');
  const m = String(markdown || '').match(re);
  return m?.[1]?.trim() || '';
}

function buildUserBaseline(member = {}) {
  const settings = member.settings && typeof member.settings === 'object' ? member.settings : {};
  return {
    display_name: member.display_name || member.npc_key || null,
    role: member.role || null,
    job: settings.job || null,
    focus: member.focus || null,
    instructions: member.instructions || null,
    soul_snippet: settings.soul_snippet || null,
    personality: personalityBridge.normalizePersonality(settings.personality),
    extra_skills: personalityBridge.normalizeExtraSkills(settings.extra_skills),
    saved_at: new Date().toISOString(),
  };
}

function diffBaselines(prev = {}, next = {}) {
  const changes = [];
  for (const field of ['display_name', 'role', 'job', 'focus', 'instructions', 'soul_snippet']) {
    const a = String(prev[field] || '').trim();
    const b = String(next[field] || '').trim();
    if (a !== b) {
      changes.push({ field, from: a || null, to: b || null, at: next.saved_at });
    }
  }
  for (const field of ['formality', 'verbosity', 'proactivity']) {
    const a = Number(prev.personality?.[field]);
    const b = Number(next.personality?.[field]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      changes.push({ field: `personality.${field}`, from: a, to: b, at: next.saved_at });
    }
  }
  return changes;
}

function mergeMemberSettings(existing = {}, patch = {}, memberFields = {}) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const nextBaseline = buildUserBaseline({
    npc_key: memberFields.npc_key,
    display_name: memberFields.display_name,
    role: memberFields.role,
    focus: memberFields.focus,
    instructions: memberFields.instructions,
    settings: { ...base, job: patch.job ?? base.job },
  });
  const changes = diffBaselines(base.user_baseline || {}, nextBaseline);
  const evolution = Array.isArray(base.evolution_log) ? [...base.evolution_log] : [];
  if (changes.length) {
    evolution.push(...changes.map((c) => ({ ...c, source: 'user_edit' })));
  }
  return {
    ...base,
    ...patch,
    user_baseline: nextBaseline,
    evolution_log: evolution.slice(-40),
  };
}

function buildMemberSoulView(npcKey, member = null, effectiveMember = null) {
  const key = String(npcKey || '').trim().toLowerCase();
  const soulPath = path.join(NPCS_DIR, key, 'SOUL.md');
  const memoryPath = path.join(NPCS_DIR, key, 'MEMORY.md');
  const historyPath = path.join(NPCS_DIR, key, 'SOUL.history.md');

  const soulRaw = readFileSafe(soulPath, 12000);
  const memoryRaw = readFileSafe(memoryPath, 6000);
  const historyRaw = readFileSafe(historyPath, 2000);

  const settings = member?.settings && typeof member.settings === 'object' ? member.settings : {};
  const userBaseline = settings.user_baseline || buildUserBaseline(member || { npc_key: key });
  const effective = effectiveMember || member;
  const effectiveSettings = effective?.settings || {};
  const soulRole = extractSection(soulRaw, 'Role');
  const soulIdentity = extractSection(soulRaw, 'Core Identity') || soulRaw.split('\n').slice(0, 6).join('\n');

  const memoryLines = memoryRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-MAX_MEMORY_LINES);

  const drift = [];
  if (userBaseline.role && soulRole && !soulRole.toLowerCase().includes(String(userBaseline.role).toLowerCase().slice(0, 12))) {
    drift.push({ kind: 'role', user: userBaseline.role, soul: soulRole });
  }

  return {
    npc_key: key,
    user_baseline: userBaseline,
    effective_overlay: personalityBridge.buildTeamMemberPromptOverlay(effective),
    personality: personalityBridge.normalizePersonality(effectiveSettings.personality || settings.personality),
    soul_snippet: effectiveSettings.soul_snippet || settings.soul_snippet || null,
    soul_snippet_identity: settings.soul_snippet || null,
    soul_snippet_org: effectiveSettings.soul_snippet_org || null,
    extra_skills: personalityBridge.normalizeExtraSkills(effectiveSettings.extra_skills),
    evolution_log: Array.isArray(settings.evolution_log) ? settings.evolution_log.slice(-20) : [],
    soul: {
      excerpt: soulRaw.slice(0, MAX_EXCERPT),
      role: soulRole || null,
      identity: soulIdentity.slice(0, 600) || null,
      file_mtime: (() => {
        try { return fs.statSync(soulPath).mtime.toISOString(); } catch (_) { return null; }
      })(),
    },
    memory: {
      excerpt: memoryLines.join('\n').slice(0, MAX_EXCERPT),
      line_count: memoryLines.length,
      file_mtime: (() => {
        try { return fs.statSync(memoryPath).mtime.toISOString(); } catch (_) { return null; }
      })(),
    },
    soul_history_excerpt: historyRaw || null,
    drift,
  };
}

function portraitMeta(npcKey) {
  try {
    const roster = require('./npc-roster');
    const entry = (roster.entries || []).find((e) => e.folder === String(npcKey || '').toLowerCase());
    if (!entry) return null;
    const frame = 1;
    const col = frame % 4;
    const row = Math.floor(frame / 4);
    return {
      npc_key: entry.folder,
      display: entry.display,
      asset_name: entry.assetName,
      texture_key: entry.textureKey,
      sprite_url: `assets/${entry.assetName}.png`,
      frame,
      frame_width: 32,
      frame_height: 48,
      columns: 4,
      rows: 4,
      col,
      row,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  buildUserBaseline,
  mergeMemberSettings,
  buildMemberSoulView,
  portraitMeta,
  extractSection,
};
