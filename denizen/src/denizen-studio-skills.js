'use strict';

/**
 * Studio Board + Business Studio skills for ChatGPT Custom GPT (run_skill path).
 * First-class MCP tools already exist for Cursor/Claude connectors; ChatGPT Actions
 * only see skills via OpenAPI — these kebab aliases bridge to the MCP tools.
 */

const mcpStudioBoardTools = require('./denizen-mcp-studio-board-tools');
const mcpBusinessStudioTools = require('./denizen-mcp-business-studio-tools');
const mcpScopes = require('./denizen-mcp-scopes');

/** Compact skill set ChatGPT can discover — prefer working_set/brief first. */
const STUDIO_BOARD_READ_SKILLS = Object.freeze([
  'studio-board-working-set',
  'studio-board-brief',
  'studio-board-standup',
  'studio-board-my-day',
  'studio-board-list-tasks',
  'studio-board-get-task',
  'studio-board-list-people',
  'studio-board-list-events',
  'studio-board-timeline',
  'studio-board-get-config',
  'studio-board-list-columns',
  'studio-board-list-automations',
  'studio-board-list-notes',
]);

const STUDIO_BOARD_WRITE_SKILLS = Object.freeze([
  'studio-board-upsert-task',
  'studio-board-advance-task',
  'studio-board-assign-task',
  'studio-board-add-comment',
  'studio-board-upsert-person',
  'studio-board-upsert-event',
  'studio-board-add-subtask',
  'studio-board-toggle-subtask',
  'studio-board-set-field',
  'studio-board-set-dates',
  'studio-board-set-blockers',
  'studio-board-send-note',
  'studio-board-update-config',
  'studio-board-upsert-column',
  'studio-board-upsert-automation',
  'studio-board-delete-task',
  'studio-board-delete-person',
  'studio-board-delete-event',
  'studio-board-delete-subtask',
]);

const BUSINESS_STUDIO_READ_SKILLS = Object.freeze([
  'business-studio-working-set',
  'business-studio-brief',
  'business-studio-explain',
  'business-studio-list-programs',
  'business-studio-chain-status',
  'business-studio-funding-readiness',
]);

const BUSINESS_STUDIO_WRITE_SKILLS = Object.freeze([
  'business-studio-apply-program-template',
  'business-studio-apply-founder-pack',
  'business-studio-add-evidence',
  'business-studio-revoke-evidence',
  'business-studio-upsert-task',
  'business-studio-upsert-goal',
  'business-studio-create-experiment',
]);

const ALL_STUDIO_SKILLS = Object.freeze([
  ...STUDIO_BOARD_READ_SKILLS,
  ...STUDIO_BOARD_WRITE_SKILLS,
  ...BUSINESS_STUDIO_READ_SKILLS,
  ...BUSINESS_STUDIO_WRITE_SKILLS,
]);

const SKILL_TO_TOOL = Object.freeze(
  Object.fromEntries(
    ALL_STUDIO_SKILLS.map((skill) => [skill, skill.replace(/-/g, '_')]),
  ),
);

function normalizeSkill(skill) {
  return String(skill || '').trim().toLowerCase().replace(/_/g, '-');
}

function isStudioSkill(skill) {
  return ALL_STUDIO_SKILLS.includes(normalizeSkill(skill));
}

function isStudioBoardSkill(skill) {
  const s = normalizeSkill(skill);
  return STUDIO_BOARD_READ_SKILLS.includes(s) || STUDIO_BOARD_WRITE_SKILLS.includes(s);
}

function isBusinessStudioSkill(skill) {
  const s = normalizeSkill(skill);
  return BUSINESS_STUDIO_READ_SKILLS.includes(s) || BUSINESS_STUDIO_WRITE_SKILLS.includes(s);
}

function isWriteStudioSkill(skill) {
  const s = normalizeSkill(skill);
  return STUDIO_BOARD_WRITE_SKILLS.includes(s) || BUSINESS_STUDIO_WRITE_SKILLS.includes(s);
}

function skillsForNpc(_npcKey, { canWrite = true } = {}) {
  const out = [...STUDIO_BOARD_READ_SKILLS, ...BUSINESS_STUDIO_READ_SKILLS];
  // Writes are gated by MCP token scope (crm_write), not just persona canWrite —
  // ChatGPT Full tokens must be able to update board / founder OS as Jenny too.
  if (canWrite !== false) {
    out.push(...STUDIO_BOARD_WRITE_SKILLS, ...BUSINESS_STUDIO_WRITE_SKILLS);
  }
  return out;
}

function toolNameForSkill(skill) {
  return SKILL_TO_TOOL[normalizeSkill(skill)] || null;
}

/**
 * Run a studio-board / business-studio skill by calling the first-class MCP tool.
 * @param {object} scope MCP scope (org_id, npc_key, scopes…)
 * @param {string} skill kebab skill name
 * @param {object} params skill params (passed as tool args)
 */
async function runStudioSkill(scope, skill, params = {}) {
  const normalized = normalizeSkill(skill);
  const toolName = toolNameForSkill(normalized);
  if (!toolName) {
    return { ok: false, error: `unknown studio skill: ${skill}` };
  }
  if (!mcpScopes.toolAllowed(scope, toolName)) {
    return {
      ok: false,
      error: 'scope_denied',
      required_scope: mcpScopes.requiredScope(toolName),
      granted_scopes: mcpScopes.scopesFromTokenScope(scope),
      skill: normalized,
      tool: toolName,
      output: 'scope_denied — mint a Connect AI token with Full access (crm_write) to update Studio Board / Business Studio.',
    };
  }
  const args = params && typeof params === 'object' ? { ...params } : {};
  // Common ChatGPT aliases
  if (args.task_id && !args.id) args.id = args.task_id;
  if (args.program_template && !args.template_id) args.template_id = args.program_template;

  let result;
  if (isStudioBoardSkill(normalized)) {
    if (!mcpStudioBoardTools.isStudioBoardTool(toolName)) {
      return { ok: false, error: `studio board tool missing: ${toolName}` };
    }
    result = await mcpStudioBoardTools.callTool(scope, toolName, args);
  } else if (isBusinessStudioSkill(normalized)) {
    if (!mcpBusinessStudioTools.isBusinessStudioTool(toolName)) {
      return { ok: false, error: `business studio tool missing: ${toolName}` };
    }
    result = await mcpBusinessStudioTools.callTool(scope, toolName, args);
  } else {
    return { ok: false, error: `not a studio skill: ${skill}` };
  }

  const ok = result?.ok !== false;
  const summary = ok
    ? summarizeStudioResult(normalized, result)
    : (result?.error || result?.message || 'studio skill failed');
  return {
    ok,
    skill: normalized,
    tool: toolName,
    routed: 'studio_skill_bridge',
    // String output for ChatGPT / skill-job pollers (match CRM denizen-data shape)
    output: summary,
    summary,
    data: result,
    error: ok ? null : (result?.error || result?.message || null),
  };
}

function summarizeStudioResult(skill, result) {
  if (!result || typeof result !== 'object') return String(result || '');
  if (skill.startsWith('studio-board-')) {
    if (result.brief || result.summary) return result.brief || result.summary;
    if (Array.isArray(result.tasks)) {
      return `Studio Board: ${result.tasks.length} task(s)`
        + (result.count != null ? ` (count=${result.count})` : '');
    }
    if (result.task?.title) return `Studio Board task: ${result.task.title}`;
    if (result.working_set || result.workingSet) {
      return 'Studio Board working set loaded — use it before creating tasks.';
    }
  }
  if (skill.startsWith('business-studio-')) {
    if (result.brief || result.summary) return result.brief || result.summary;
    if (result.working_set || result.workingSet) {
      return 'Business Studio working set loaded — evidence-gated next action included.';
    }
    if (result.readiness || result.funding) {
      return 'Funding readiness snapshot loaded from Business Studio.';
    }
    if (result.evidence?.title) return `Evidence attached: ${result.evidence.title}`;
  }
  try {
    return JSON.stringify(result).slice(0, 1200);
  } catch (_) {
    return 'Studio skill completed.';
  }
}

module.exports = {
  STUDIO_BOARD_READ_SKILLS,
  STUDIO_BOARD_WRITE_SKILLS,
  BUSINESS_STUDIO_READ_SKILLS,
  BUSINESS_STUDIO_WRITE_SKILLS,
  ALL_STUDIO_SKILLS,
  SKILL_TO_TOOL,
  normalizeSkill,
  isStudioSkill,
  isStudioBoardSkill,
  isBusinessStudioSkill,
  isWriteStudioSkill,
  skillsForNpc,
  toolNameForSkill,
  runStudioSkill,
};
