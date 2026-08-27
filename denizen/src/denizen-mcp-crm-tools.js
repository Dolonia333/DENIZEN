'use strict';

/**
 * First-class CRM MCP tools — clearer than raw run_skill for LLM clients.
 * Prefer crm_working_set before mutating. Never invent pipeline $.
 */

const mcpActions = require('./denizen-mcp-actions');

let _runSkill = null;

const CRM_TOOL_DEFINITIONS = [
  {
    name: 'crm_working_set',
    description:
      'READ-ONLY Meridian working-set board: live deals, contacts, open tasks, watchlist parked, at-risk (missed next date). '
      + 'Excludes seed/watchlist from pipeline $. Empty workspace is OK — do not invent data. '
      + 'Call this first before any CRM write. Returns checklist for cloud + slow local modes.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional note (ignored for filtering; for agent context)' },
      },
    },
  },
  {
    name: 'crm_pipeline_brief',
    description:
      'READ-ONLY pipeline brief grounded in the working set (not inflated open-deal counts). '
      + 'Watchlist RFPs are parked and not pipeline $. If empty, guides clean rebuild. Prefer crm_working_set for structured JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus: industry, owner, stage' },
      },
    },
  },
  {
    name: 'business_context_brief',
    description:
      'READ-ONLY business model + CRM cross-reference + proactive blockers (bids, teaming, goals). '
      + 'Use after crm_working_set when strategy/OMES context is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        npcName: { type: 'string', description: 'Optional NPC name for owner-filtered proactive flags' },
      },
    },
  },
  {
    name: 'crm_list_tasks',
    description:
      'READ-ONLY list of open CRM tasks (not done/closed). Prefer verb titles tied to one deal. '
      + 'Overdue hygiene chores should be closed, not enriched.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max tasks (default 25)' },
      },
    },
  },
  {
    name: 'crm_draft_email',
    description:
      'Draft a CRM email (does NOT send). Requires crm_write scope. Returns draft text only.',
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
    _runSkill = (scope, skill, params, opts = {}) => mcpActions.toolRunSkill(scope, {
      skill,
      params,
      wait: opts.wait !== false,
      timeout_ms: deps.skillTimeoutMs || 180000,
    });
  }
}

function hasCrmAccess(npcKey) {
  if (npcKey === '_team') return true;
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
  const key = scope?.npc_key;
  if (!hasCrmAccess(key) && scope?.scope_mode !== 'team') {
    return { ok: false, error: 'CRM tools not available for this NPC' };
  }
  if (!_runSkill) {
    return { ok: false, error: 'skill runner not configured' };
  }

  // Prefer Abby (or Marcus) as skill runner when called from team scope
  const runScope = key === '_team' || scope?.scope_mode === 'team'
    ? { ...scope, npc_key: 'abby' }
    : scope;

  switch (name) {
    case 'crm_working_set':
      return _runSkill(runScope, 'crm-working-set', {
        focus: args?.focus || '',
        query: args?.focus || 'working set board',
      });
    case 'crm_pipeline_brief':
      return _runSkill(runScope, 'crm-pipeline-brief', {
        focus: args?.focus || '',
        query: args?.focus || 'pipeline brief',
      });
    case 'business_context_brief':
      return _runSkill(runScope, 'business-context-brief', {
        npcName: args?.npcName || runScope.npc_key || '',
        query: 'business context brief',
      });
    case 'crm_list_tasks':
      return _runSkill(runScope, 'crm-list-tasks', {
        limit: args?.limit || 25,
      });
    case 'crm_draft_email':
      return _runSkill(runScope, 'crm-draft-email', {
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
