'use strict';

/**
 * First-class CRM MCP tools — clearer than raw run_skill for LLM clients.
 * Prefer crm_working_set before mutating. Never invent pipeline $.
 */

const mcpActions = require('./denizen-mcp-actions');
const crmStore = require('./denizen-crm-store');
const workingSet = require('./denizen-crm-working-set');
const crmMutations = require('./denizen-crm-mutations');
const denizenDb = require('./denizen-db');
const mailPolicy = require('./denizen-mail-policy');
const { sendCrmEmail } = require('./denizen-crm-email');

let _runSkill = null;

const CRM_TOOL_DEFINITIONS = [
  {
    name: 'crm_working_set',
    description:
      'READ-ONLY Meridian working-set board: live deals, contacts, open tasks, watchlist parked, at-risk. '
      + 'Excludes seed/watchlist from pipeline $. Empty workspace is OK — do not invent data. '
      + 'Call this first before any CRM write. Returns IDs + checklist.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional note for agent context' },
      },
    },
  },
  {
    name: 'crm_pipeline_brief',
    description: 'Summarize CRM pipeline — deals, stages, and at-risk accounts (working-set grounded).',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus: industry, owner, stage' },
      },
    },
  },
  {
    name: 'business_context_brief',
    description: 'Canonical business model + CRM cross-reference + proactive blockers (OMES, teaming, goals).',
    inputSchema: {
      type: 'object',
      properties: {
        npcName: { type: 'string', description: 'Optional NPC name for owner-filtered proactive flags' },
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
  {
    name: 'mail_policy_status',
    description:
      'READ-ONLY: current outbound mail policy (never|confirm|allowlist). '
      + 'Default is never — use send_draft only after policy allows.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_draft',
    description:
      'Send a CRM email under DENIZEN_MAIL_POLICY. Default policy=never (blocked). '
      + 'confirm mode: first call returns confirm_token; re-call with same args + token. '
      + 'allowlist mode: to must match DENIZEN_MAIL_ALLOWLIST. Prefer crm_draft_email first.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
        confirm_token: { type: 'string', description: 'Token from prior confirm challenge' },
        contact_id: { type: 'number', description: 'Optional CRM contact id' },
        deal_id: { type: 'number', description: 'Optional CRM deal id' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'crm_park_deal',
    description:
      'Park a deal to watchlist (research / SAM scrape). Sets status=watchlist, value=$0, not open pipeline. '
      + 'Use for scrape titles that lack a human contact + next-verb task. Writes an outcome receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'number', description: 'Deal id (preferred)' },
        id: { type: 'number', description: 'Alias for deal_id' },
        title: { type: 'string', description: 'Deal title if id unknown' },
        reason: { type: 'string', description: 'Why parking (e.g. no-human-contact)' },
      },
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
  if (npcKey === '_team') return true;
  const skills = mcpActions.listSkillsForNpc(npcKey);
  return skills.some((s) => s.startsWith('crm-') || s === 'intake-triage' || s === 'lead-monitor');
}

function toolsForNpc(npcKey) {
  const policyTool = CRM_TOOL_DEFINITIONS.filter((t) => t.name === 'mail_policy_status');
  // Always expose read-only mail policy so connectors can verify default-deny.
  if (!hasCrmAccess(npcKey)) return [...policyTool];
  return [...CRM_TOOL_DEFINITIONS];
}

function isCrmTool(name) {
  return CRM_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function resolveOrgId(scope) {
  return scope?.org_id || denizenDb.orgId || null;
}

async function toolWorkingSet(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const row = await crmStore.getWorkspace(orgId);
  const state = row?.state || {};
  const board = workingSet.buildWorkingSet(state);
  const c = board.counts || {};
  return {
    ok: true,
    focus: args?.focus || null,
    summary: board.empty
      ? 'Working set empty — no open pursuits. Do not invent seed data.'
      : `Working set: ${c.open_pipeline} live deal(s), $${Number(c.open_pipeline_value || 0).toLocaleString()}, `
        + `${c.contacts} contacts, ${c.open_tasks} open tasks, ${c.watchlist} watchlist parked, ${c.at_risk} at-risk.`,
    ...board,
  };
}

async function toolParkDeal(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  try {
    const result = await crmMutations.parkDeal(orgId, {
      dealId: args?.deal_id ?? args?.dealId ?? args?.id,
      title: args?.title,
      reason: args?.reason || args?.parkReason,
      actor: scope?.npc_key || 'mcp',
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function toolMailPolicyStatus() {
  return { ok: true, ...mailPolicy.policyStatus() };
}

async function toolSendDraft(scope, args = {}) {
  const npcKey = scope?.npc_key || 'mcp';
  const to = String(args?.to || args?.toEmail || args?.to_email || '').trim();
  const subject = String(args?.subject || '').trim();
  const body = String(args?.body || args?.context || '').trim();
  const confirmToken = args?.confirm_token || args?.confirmToken || null;

  const gate = mailPolicy.assertSendAllowed({
    npcKey,
    to,
    subject,
    body,
    confirmToken,
  });
  if (!gate.ok) {
    return { ...gate, sent: false };
  }

  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable', policy: gate.policy };

  try {
    const row = await crmStore.getWorkspace(orgId);
    const sendResult = await sendCrmEmail(row?.state || {}, {
      contactId: args?.contact_id ?? args?.contactId,
      dealId: args?.deal_id ?? args?.dealId,
      toEmail: to,
      subject,
      body,
      senderName: npcKey,
    });
    if (!sendResult.ok) {
      return { ok: false, error: sendResult.error || 'Send failed', policy: gate.policy };
    }
    const identityId = scope?.identity_id || null;
    if (sendResult.state) {
      await crmStore.upsertWorkspace(orgId, sendResult.state, identityId, {
        ifUpdatedAt: row?.updated_at || null,
      });
    }
    return {
      ok: true,
      sent: true,
      policy: gate.policy,
      mode: sendResult.mode,
      mailto: sendResult.mailto || null,
      subject: sendResult.subject || subject,
      to,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), policy: gate.policy };
  }
}

async function callTool(scope, name, args) {
  const key = scope?.npc_key;

  // Read-only mail policy is always available (default deny must be inspectable).
  if (name === 'mail_policy_status') return toolMailPolicyStatus();

  if (!hasCrmAccess(key) && scope?.scope_mode !== 'team') {
    return { ok: false, error: 'CRM tools not available for this NPC' };
  }

  if (name === 'crm_working_set') return toolWorkingSet(scope, args);
  if (name === 'crm_park_deal') return toolParkDeal(scope, args);
  if (name === 'send_draft') return toolSendDraft(scope, args);

  if (!_runSkill) {
    return { ok: false, error: 'skill runner not configured' };
  }

  const runScope = key === '_team' || scope?.scope_mode === 'team'
    ? { ...scope, npc_key: 'abby' }
    : scope;

  switch (name) {
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
      return _runSkill(runScope, 'crm_draft_email', {
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
