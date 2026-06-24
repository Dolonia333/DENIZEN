'use strict';

/**
 * First-class CRM MCP tools — clearer than raw run_skill for LLM clients.
 */

const mcpActions = require('./denizen-mcp-actions');

let _runSkill = null;

const CRM_TOOL_DEFINITIONS = [
  {
    name: 'crm_pipeline_brief',
    description: 'Summarize CRM pipeline — deals, stages, and at-risk accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus: industry, owner, stage' },
      },
    },
  },
  {
    name: 'crm_list_tasks',
    description: 'List open CRM tasks and follow-ups.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max tasks (default 25)' },
      },
    },
  },
  {
    name: 'crm_draft_email',
    description: 'Draft a CRM email (does not send — returns draft text).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient name or email context' },
        subject: { type: 'string', description: 'Email subject or topic' },
        context: { type: 'string', description: 'What the email should cover' },
      },
      required: ['context'],
    },
  },
];

function configure(deps = {}) {
  if (typeof deps.runNpcSkill === 'function') {
    _runSkill = (scope, skill, params) => mcpActions.toolRunSkill(scope, {
      skill,
      params,
      wait: true,
      timeout_ms: deps.skillTimeoutMs || 180000,
    });
  }
}

function hasCrmAccess(npcKey) {
  const skills = mcpActions.listSkillsForNpc(npcKey);
  return skills.some((s) => s.startsWith('crm-') || s === 'intake-triage' || s === 'lead-monitor');
}

function toolsForNpc(npcKey) {
  return hasCrmAccess(npcKey) ? [...CRM_TOOL_DEFINITIONS] : [];
}

function isCrmTool(name) {
  return CRM_TOOL_DEFINITIONS.some((t) => t.name === name);
}

async function callTool(scope, name, args) {
  if (!hasCrmAccess(scope.npc_key)) {
    return { ok: false, error: 'CRM tools not available for this NPC' };
  }
  if (!_runSkill) {
    return { ok: false, error: 'skill runner not configured' };
  }

  switch (name) {
    case 'crm_pipeline_brief':
      return _runSkill(scope, 'crm-pipeline-brief', {
        focus: args?.focus || '',
        query: args?.focus || 'pipeline brief',
      });
    case 'crm_list_tasks':
      return _runSkill(scope, 'crm-list-tasks', {
        limit: args?.limit || 25,
      });
    case 'crm_draft_email':
      return _runSkill(scope, 'crm-draft-email', {
        to: args?.to || '',
        subject: args?.subject || '',
        context: args?.context || args?.body || '',
        query: args?.context || '',
      });
    default:
      return { ok: false, error: `unknown crm tool: ${name}` };
  }
}

module.exports = {
  configure,
  CRM_TOOL_DEFINITIONS,
  hasCrmAccess,
  toolsForNpc,
  isCrmTool,
  callTool,
};
