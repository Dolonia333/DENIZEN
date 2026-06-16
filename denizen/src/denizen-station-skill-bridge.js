'use strict';

/**
 * Routes Jelly / chat skills to the paired Denizen Desktop station (Cowork mode).
 * GUI and local-PC tasks run on the user's machine via screen capture + nut-js.
 */

const DESKTOP_AGENT_SKILLS = new Set([
  'desktop-agent',
  'browserclaw',
  'web-search',
  'research',
  'coding-agent',
  'github',
  'job-scraper',
  'job-applier',
  'resume-generator',
  'pdf-generator',
  'screen-observe',
]);

const FILE_SKILLS = new Set(['file-read', 'file-write']);
const CODE_SKILLS = new Set(['run-code', 'run_code']);

function normalizeSkill(skill) {
  return String(skill || '').trim().toLowerCase();
}

function taskText(skillParams = {}, fallback = '') {
  return String(
    skillParams.task
    || skillParams.instruction
    || skillParams.query
    || skillParams.message
    || skillParams.url
    || fallback
    || '',
  ).trim();
}

function shouldRouteSkillToStation(skill) {
  const key = normalizeSkill(skill);
  if (!key) return false;
  if (DESKTOP_AGENT_SKILLS.has(key)) return true;
  if (FILE_SKILLS.has(key)) return true;
  if (CODE_SKILLS.has(key)) return true;
  return false;
}

function buildDesktopAgentInstruction(skill, skillParams = {}, fallbackMessage = '') {
  const key = normalizeSkill(skill);
  const task = taskText(skillParams, fallbackMessage);
  const lines = [
    task || `Complete this ${key} task on my computer.`,
    '',
    `Skill context: ${key}.`,
    'You are on the user\'s REAL desktop — use mouse and keyboard to complete the task.',
    'Prefer visible apps (browser, editor, file explorer) on this machine.',
  ];
  if (skillParams.url) lines.push(`URL hint: ${skillParams.url}`);
  if (skillParams.path || skillParams.file) {
    lines.push(`File hint: ${skillParams.path || skillParams.file}`);
  }
  return lines.join('\n').slice(0, 4000);
}

/**
 * @returns {{ kind, skill, instruction, payload }|null}
 */
function resolveStationRoute(skill, skillParams = {}, { fallbackMessage = '' } = {}) {
  const key = normalizeSkill(skill);
  if (!shouldRouteSkillToStation(key)) return null;

  if (key === 'screen-observe') {
    const instruction = taskText(skillParams, fallbackMessage)
      || 'Describe what is on my screen read-only.';
    return {
      kind: 'screen_observe',
      skill: key,
      instruction,
      payload: {},
    };
  }

  if (FILE_SKILLS.has(key)) {
    const pathVal = skillParams.path || skillParams.file || taskText(skillParams, fallbackMessage);
    if (key === 'file-write') {
      return {
        kind: 'file_write',
        skill: key,
        instruction: String(pathVal || ''),
        payload: {
          path: pathVal,
          content: skillParams.content ?? '',
        },
      };
    }
    return {
      kind: 'file_read',
      skill: key,
      instruction: String(pathVal || ''),
      payload: { path: pathVal },
    };
  }

  if (CODE_SKILLS.has(key)) {
    return {
      kind: 'run_code',
      skill: key,
      instruction: String(skillParams.command || 'node'),
      payload: {
        command: skillParams.command || 'node',
        args: Array.isArray(skillParams.args) ? skillParams.args : (skillParams.script ? [skillParams.script] : []),
        cwd: skillParams.cwd || null,
      },
    };
  }

  return {
    kind: 'desktop_agent',
    skill: key === 'desktop-agent' ? key : 'desktop-agent',
    instruction: buildDesktopAgentInstruction(key, skillParams, fallbackMessage),
    payload: { source_skill: key, ...skillParams },
  };
}

module.exports = {
  DESKTOP_AGENT_SKILLS,
  FILE_SKILLS,
  CODE_SKILLS,
  normalizeSkill,
  shouldRouteSkillToStation,
  buildDesktopAgentInstruction,
  resolveStationRoute,
};
