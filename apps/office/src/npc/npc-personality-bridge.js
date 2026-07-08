'use strict';

const MAX_SOUL_SNIPPET = 2500;
const MAX_EXTRA_SKILLS = 12;

const DEFAULT_PERSONALITY = Object.freeze({
  formality: 50,
  verbosity: 50,
  proactivity: 50,
});

function clampPct(n, fallback = 50) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizePersonality(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    formality: clampPct(p.formality, DEFAULT_PERSONALITY.formality),
    verbosity: clampPct(p.verbosity, DEFAULT_PERSONALITY.verbosity),
    proactivity: clampPct(p.proactivity, DEFAULT_PERSONALITY.proactivity),
  };
}

function sanitizeSoulSnippet(text) {
  return String(text || '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, MAX_SOUL_SNIPPET);
}

function normalizeExtraSkills(list) {
  if (!list) return [];
  const arr = Array.isArray(list)
    ? list
    : String(list || '').split(/[,;\s]+/);
  return [...new Set(arr.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))]
    .slice(0, MAX_EXTRA_SKILLS);
}

function pickField(identityVal, orgVal) {
  const id = identityVal != null ? String(identityVal).trim() : '';
  if (id) return identityVal;
  const og = orgVal != null ? String(orgVal).trim() : '';
  return og || null;
}

/**
 * Merge org defaults with identity overrides (identity wins on non-empty fields).
 */
function mergeMemberProfiles(orgMember, identityMember) {
  if (!orgMember && !identityMember) return null;
  const orgSettings = orgMember?.settings && typeof orgMember.settings === 'object'
    ? orgMember.settings : {};
  const idSettings = identityMember?.settings && typeof identityMember.settings === 'object'
    ? identityMember.settings : {};

  const idSnippet = sanitizeSoulSnippet(idSettings.soul_snippet);
  const orgSnippet = sanitizeSoulSnippet(orgSettings.soul_snippet);

  const mergedSettings = {
    ...orgSettings,
    ...idSettings,
    job: idSettings.job ?? orgSettings.job ?? null,
    personality: normalizePersonality({
      ...(orgSettings.personality || {}),
      ...(idSettings.personality || {}),
    }),
    soul_snippet: idSnippet || orgSnippet || null,
    soul_snippet_identity: idSnippet || null,
    soul_snippet_org: orgSnippet || null,
    extra_skills: normalizeExtraSkills([
      ...(Array.isArray(orgSettings.extra_skills) ? orgSettings.extra_skills : []),
      ...(Array.isArray(idSettings.extra_skills) ? idSettings.extra_skills : []),
    ]),
  };

  return {
    npc_key: identityMember?.npc_key || orgMember?.npc_key,
    display_name: pickField(identityMember?.display_name, orgMember?.display_name)
      || identityMember?.npc_key || orgMember?.npc_key,
    role: pickField(identityMember?.role, orgMember?.role) || 'assistant',
    focus: pickField(identityMember?.focus, orgMember?.focus),
    instructions: pickField(identityMember?.instructions, orgMember?.instructions),
    settings: mergedSettings,
    sources: {
      org: !!orgMember,
      identity: !!identityMember,
    },
  };
}

function buildPersonalityPromptBlock(personality) {
  const p = normalizePersonality(personality);
  const formalityLine = p.formality >= 70
    ? 'Speak formally — complete sentences, no slang, professional tone.'
    : p.formality <= 30
      ? 'Speak casually — contractions OK, friendly peer tone, not corporate.'
      : 'Balanced tone — professional but human, not stiff or overly casual.';
  const verbosityLine = p.verbosity >= 70
    ? 'Be thorough — context, rationale, and next steps when helpful.'
    : p.verbosity <= 30
      ? 'Be ultra-brief — one to three sentences unless they ask for detail.'
      : 'Default to concise answers; expand only when the task needs it.';
  const proactivityLine = p.proactivity >= 70
    ? 'Proactively suggest the next action, offer to run skills, and name who owns handoffs.'
    : p.proactivity <= 30
      ? 'Answer what was asked; do not pile on suggestions unless blocked.'
      : 'Offer one clear next step when obvious; otherwise wait for direction.';
  return [
    '## Personality sliders (teammate preference)',
    formalityLine,
    verbosityLine,
    proactivityLine,
  ].join('\n');
}

function buildSoulSnippetBlock(snippet, { label = 'Teammate SOUL overlay' } = {}) {
  const text = sanitizeSoulSnippet(snippet);
  if (!text) return '';
  return [
    `## ${label}`,
    'This overlay sits on top of your base SOUL.md for this teammate — follow it for this relationship.',
    text,
  ].join('\n');
}

function buildExtraSkillsBlock(skills) {
  const list = normalizeExtraSkills(skills);
  if (!list.length) return '';
  return [
    '## Extra approved skills (teammate/org)',
    `You may also run these skills for this teammate: ${list.join(', ')}.`,
  ].join('\n');
}

function buildTeamMemberPromptOverlay(mergedMember) {
  if (!mergedMember) return '';
  const settings = mergedMember.settings || {};
  const lines = [
    '## Teammate NPC profile',
    mergedMember.display_name ? `This teammate calls you ${mergedMember.display_name}.` : null,
    mergedMember.role ? `Your role for them: ${mergedMember.role}.` : null,
    settings.job ? `Current job assignment: ${settings.job}.` : null,
    mergedMember.focus ? `Focus area: ${mergedMember.focus}` : null,
    mergedMember.instructions ? 'Follow these teammate instructions:' : null,
    mergedMember.instructions || null,
  ].filter(Boolean);

  const personalityBlock = buildPersonalityPromptBlock(settings.personality);
  const snippetBlock = buildSoulSnippetBlock(settings.soul_snippet);
  const skillsBlock = buildExtraSkillsBlock(settings.extra_skills);

  return [
    lines.join('\n'),
    personalityBlock,
    snippetBlock,
    skillsBlock,
  ].filter(Boolean).join('\n\n');
}

function canRunSkillWithExtras(npcKeyOrName, skill, extraSkills, baseCheck) {
  if (extraSkills && normalizeExtraSkills(extraSkills).includes(String(skill || '').trim().toLowerCase())) {
    return true;
  }
  return typeof baseCheck === 'function' ? baseCheck(npcKeyOrName, skill) : false;
}

module.exports = {
  DEFAULT_PERSONALITY,
  MAX_SOUL_SNIPPET,
  MAX_EXTRA_SKILLS,
  clampPct,
  normalizePersonality,
  sanitizeSoulSnippet,
  normalizeExtraSkills,
  mergeMemberProfiles,
  buildPersonalityPromptBlock,
  buildSoulSnippetBlock,
  buildExtraSkillsBlock,
  buildTeamMemberPromptOverlay,
  canRunSkillWithExtras,
};
