'use strict';

/**
 * First-class CRM MCP tools — clearer than raw run_skill for LLM clients.
 * Prefer crm_working_set before mutating. Never invent pipeline $.
 */

const mcpActions = require('./denizen-mcp-actions');
const crmStore = require('./denizen-crm-store');
const workingSet = require('./denizen-crm-working-set');
const crmMutations = require('./denizen-crm-mutations');
const crmAccess = require('./denizen-crm-access');
const mcpActor = require('./denizen-mcp-actor');
const denizenDb = require('./denizen-db');
const mailPolicy = require('./denizen-mail-policy');
const { sendCrmEmail } = require('./denizen-crm-email');

let _runSkill = null;

const CRM_TOOL_DEFINITIONS = [
  {
    name: 'crm_operate',
    description:
      'CRM writes the connector must expose. action is one of: list-records, update-contact, delete-contact, '
      + 'update-deal, delete-deal, merge-contacts, link-deal, '
      + 'upsert-company, link, update-task, close-task, upsert-package, sync-business-context. '
      + 'delete-deal and merge-contacts require confirm: true and explicit ids. '
      + 'link-deal needs an existing contact_id. Nothing is inferred or deleted without confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list-records',
            'update-contact',
            'delete-contact',
            'update-deal',
            'delete-deal',
            'merge-contacts',
            'link-deal',
            'upsert-company',
            'link',
            'update-task',
            'close-task',
            'upsert-package',
            'sync-business-context',
          ],
        },
        contact_id: { type: 'string' },
        company_id: { type: 'string' },
        deal_id: { type: 'string' },
        task_id: { type: 'string' },
        package_id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        role: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string', description: 'Link type when action is link' },
        links: { type: 'array', items: { type: 'object' } },
        features: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
    },
  },
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
  {
    name: 'crm_upsert_company',
    description:
      'Create or update a CRM company. Pass company_id to update; omit it to create. Returns company_id.',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Existing company id. Omit to create.' },
        id: { type: 'string' },
        name: { type: 'string' },
        domain: { type: 'string' },
        industry: { type: 'string' },
        website: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string' },
        address: { type: 'string' },
      },
    },
  },
  {
    name: 'crm_delete_contact',
    description:
      'Delete one CRM contact by the contact_id returned from crm_list_records. Requires contact_id.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact id from crm_list_records' },
        id: { type: 'string', description: 'Alias for contact_id' },
      },
    },
  },
  {
    name: 'crm_upsert_contact',
    description:
      'Create or update a CRM contact. Pass the contact_id from crm_list_records to update email, phone, role, or company. A new email is saved onto that id; it is not used to search.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing contact id from crm_list_records' },
        contact_id: { type: 'string', description: 'Alias for id. This is the lookup key.' },
        name: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        phone: { type: 'string' },
        role: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'crm_upsert_deal',
    description:
      'Create or update a CRM deal. Pass deal_id to update; omit to create. Prefer crm_working_set first.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'number' },
        id: { type: 'number' },
        title: { type: 'string' },
        contact: { type: 'string' },
        company: { type: 'string' },
        value: { type: 'number' },
        stage: { type: 'string' },
        health: { type: 'string' },
        close_date: { type: 'string' },
        notes: { type: 'string' },
        studio_task_ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'crm_move_deal',
    description: 'Move a CRM deal to a pipeline stage (requires deal_id + stage).',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'number' },
        id: { type: 'number' },
        title: { type: 'string' },
        stage: { type: 'string', description: 'Target stage e.g. Qualified, Proposal, Closed Won' },
      },
      required: ['stage'],
    },
  },
  {
    name: 'crm_upsert_task',
    description: 'Create a CRM follow-up task (title required). Optional deal_id / contact.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        contact: { type: 'string' },
        deal_id: { type: 'number' },
        due: { type: 'string', description: 'YYYY-MM-DD' },
        priority: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'crm_complete_task',
    description: 'Close (or delete) a CRM task by id or title match.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number' },
        id: { type: 'number' },
        title: { type: 'string', description: 'Title match if id unknown' },
        delete: { type: 'boolean', description: 'Delete instead of mark done' },
      },
    },
  },
  {
    name: 'crm_add_note',
    description: 'Add a CRM note on a contact (and optionally associate context).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        contact: { type: 'string', description: 'Contact name' },
        contact_id: { type: 'number' },
        type: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'crm_list_records',
    description:
      'Structured CRM records with ids. Returns deals, contacts, companies, and tasks as JSON '
      + '{deal_id, contact_id, company_id, task_id, name, stage, value, status, deadline, next_action}. '
      + 'Use these ids for bulk updates. kind=all|deals|contacts|companies|tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'all, deals, contacts, companies, or tasks' },
        limit: { type: 'number', description: 'Max rows per list (default 100, max 200)' },
      },
    },
  },
  {
    name: 'crm_bulk_update_deals',
    description:
      'Update many deals. updates: [{deal_id, stage, value, status, contact_id, company_id, deadline, next_action, notes}]. '
      + 'Returns ok/error for every deal_id.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'array', description: 'Array of deal patches keyed by deal_id' },
      },
      required: ['updates'],
    },
  },
  {
    name: 'crm_bulk_update_tasks',
    description:
      'Update many tasks. updates: [{task_id, status}] where status is open, paused, cancelled, or done. '
      + 'Returns ok/error for every task_id.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'array', description: 'Array of task patches keyed by task_id' },
      },
      required: ['updates'],
    },
  },
  {
    name: 'crm_bulk_update_contacts',
    description:
      'Update many contacts. updates: [{contact_id, name, email, company, company_id, phone, status}]. '
      + 'Returns ok/error for every contact_id.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'array', description: 'Array of contact patches keyed by contact_id' },
      },
      required: ['updates'],
    },
  },
  {
    name: 'crm_bulk_link_records',
    description:
      'Link CRM records. links: [{type, contact_id, company_id, deal_id, task_id, partner_id, opportunity_id, customer_id}]. '
      + 'Types: contact_company, contact_deal, deal_company, task_deal, task_contact, partner_opportunity, past_performance_customer.',
    inputSchema: {
      type: 'object',
      properties: {
        links: { type: 'array', description: 'Relationship links to apply' },
      },
      required: ['links'],
    },
  },
  {
    name: 'crm_upsert_package',
    description:
      'Create or update a CRM package by id or name. Fields: name, tier, tagline, features, line_items, best_for.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        package_id: { type: 'number' },
        name: { type: 'string' },
        tier: { type: 'string' },
        tagline: { type: 'string' },
        features: { type: 'array', items: { type: 'string' } },
        line_items: { type: 'array' },
        best_for: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'crm_update_profile',
    description:
      'Write CRM profile/setup fields: name, email, title, phone, company, website, bio.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        title: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        website: { type: 'string' },
        bio: { type: 'string' },
      },
    },
  },
  {
    name: 'crm_link_records',
    description:
      'Link CRM records. Same as crm_bulk_link_records. links: [{type, contact_id, company_id, deal_id, task_id}]. '
      + 'Types: contact_company, contact_deal, deal_company, task_deal, task_contact, partner_opportunity, past_performance_customer.',
    inputSchema: {
      type: 'object',
      properties: {
        links: { type: 'array' },
      },
      required: ['links'],
    },
  },
  {
    name: 'crm_close_task',
    description: 'Close or delete a CRM task by task_id. Pass delete=true to remove it.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number' },
        id: { type: 'number' },
        title: { type: 'string' },
        delete: { type: 'boolean' },
      },
    },
  },
  {
    name: 'crm_create_quote',
    description:
      'Create a CRM quote from a company, package_id, or line_items. Does not require an intake submission.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        client_name: { type: 'string' },
        title: { type: 'string' },
        package_id: { type: 'number' },
        package: { type: 'string' },
        line_items: { type: 'array' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'crm_calendar_status',
    description:
      'Calendar connection status. Reports whether Google and Microsoft OAuth apps are configured on this server '
      + 'and whether an account is connected.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_context_sync',
    description:
      'Rewrite canonical Business Context from the current CRM deals and Business Studio goals. '
      + 'Past-due and duplicate opportunities become historical and stop being the active priority.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_context_update',
    description:
      'Write canonical Business Context: current_focus, active_opportunities, strategic_goals, capture_sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        current_focus: { type: 'array', items: { type: 'string' } },
        active_opportunities: { type: 'array' },
        strategic_goals: { type: 'array', items: { type: 'string' } },
        capture_sprint: { type: 'object' },
      },
    },
  },
  {
    name: 'crm_update_task',
    description: 'Set one task status by task_id: open, paused, cancelled, or done.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number' },
        id: { type: 'number' },
        status: { type: 'string' },
        due: { type: 'string' },
        deal_id: { type: 'number' },
        contact_id: { type: 'number' },
      },
      required: ['status'],
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

function scopedCrmState(scope, state) {
  const actor = mcpActor.actorFromMcpScope(scope);
  const orgWide = mcpActor.isOrgWideScope(scope);
  const scoped = crmAccess.filterWorkspaceForAccess(state || {}, actor, { orgWide });
  return {
    state: scoped.state,
    data_scope: scoped.scope,
    filtered: !!scoped.filtered,
    actor,
  };
}

function actorForScope(scope) {
  const actor = mcpActor.actorFromMcpScope(scope);
  if (mcpActor.isOrgWideScope(scope)) return null;
  return { ...actor, forceOwn: true };
}

async function toolWorkingSet(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const row = await crmStore.getWorkspace(orgId);
  const { state, data_scope, filtered, actor } = scopedCrmState(scope, row?.state || {});
  const board = workingSet.buildWorkingSet(state);
  const c = board.counts || {};
  const scopeNote = filtered
    ? ` Scoped to ${actor.user || 'you'} (personal CRM + team calendar).`
    : ' Org-wide view.';
  return {
    ok: true,
    focus: args?.focus || null,
    data_scope,
    filtered,
    viewer: {
      identity_id: actor.identityId || null,
      user: actor.user || null,
      role: actor.role || null,
    },
    summary: board.empty
      ? `Working set empty — no open pursuits. Do not invent seed data.${scopeNote}`
      : `Working set: ${c.open_pipeline} live deal(s), $${Number(c.open_pipeline_value || 0).toLocaleString()}, `
        + `${c.contacts} contacts, ${c.open_tasks} open tasks, ${c.watchlist} watchlist parked, ${c.at_risk} at-risk.${scopeNote}`,
    ...board,
  };
}

function ownerStamp(actor) {
  if (!actor?.forceOwn) return {};
  return {
    ownerEmail: actor.email || null,
    ownerIdentityId: actor.identityId || null,
    ownerId: actor.displayName || actor.user || null,
    assignee: actor.displayName || actor.user || null,
  };
}

async function ownIds(scope, kind) {
  const actor = await actorForScope(scope);
  if (!actor?.forceOwn) return { actor, ids: null };
  const orgId = resolveOrgId(scope);
  const row = await crmStore.getWorkspace(orgId);
  const view = require('./denizen-crm-access').filterWorkspaceForAccess(row?.state || {}, actor, { forceOwn: true }).state;
  const list = kind === 'task' ? view.tasks : (kind === 'contact' ? view.contacts : view.deals);
  return { actor, ids: new Set((list || []).map((rowItem) => String(rowItem?.id))) };
}

async function toolParkDeal(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const gate = await ownIds(scope, 'deal');
  const dealId = args?.deal_id ?? args?.dealId ?? args?.id;
  if (gate.ids && dealId != null && !gate.ids.has(String(dealId))) {
    return { ok: false, error: 'deal not found' };
  }
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

async function toolCreateQuote(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  try {
    const crmSkills = require('./denizen-crm-skills');
    const result = await crmSkills.generateQuote(orgId, args || {}, scope?.identity_id || null);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolCalendarStatus(scope) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const crmSkills = require('./denizen-crm-skills');
  const status = await crmSkills.calendarStatusSkill(orgId, { identityId: scope?.identity_id || 'default' });
  return { ok: true, ...status };
}

async function toolSyncBusinessContext(scope) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const businessContext = require('./denizen-business-context');
  const saved = await businessContext.syncBusinessContext(orgId);
  const snapshot = await businessContext.buildSnapshot({ orgId, npcName: scope?.npc_key || null });
  return { ok: true, saved: true, focus: snapshot.current_focus, opportunities: snapshot.opportunities, model: saved.model };
}

async function toolUpdateBusinessContext(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const businessContext = require('./denizen-business-context');
  const saved = await businessContext.updateBusinessContext(orgId, args || {});
  return { ok: true, saved: true, model: saved.model, brief: saved.brief };
}

async function toolUpsertCompany(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const identityId = scope?.identity_id || null;
  const companyId = args?.company_id ?? args?.companyId ?? args?.id;
  try {
    if (companyId != null && companyId !== '') {
      try {
        const updated = await crmMutations.updateCompany(orgId, { ...args, company_id: companyId }, identityId);
        return {
          ok: true,
          updated: true,
          company_id: updated.company?.id,
          ...updated,
        };
      } catch (err) {
        const missing = /company not found/i.test(err?.message || '');
        if (!missing || !(args?.name || args?.company)) {
          return { ok: false, error: err?.message || String(err) };
        }
      }
    }
    if (!args?.name && !args?.company) return { ok: false, error: 'name required to create a company' };
    const crmSkills = require('./denizen-crm-skills');
    const created = await crmSkills.addCompany(orgId, args || {}, identityId);
    return { ok: true, created: true, company_id: created.company?.id, ...created };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolDeleteContact(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const id = args?.contact_id ?? args?.contactId ?? args?.id;
  const gate = await ownIds(scope, 'contact');
  if (gate.ids && id != null && !gate.ids.has(String(id))) {
    return { ok: false, error: `contact not found: ${id}` };
  }
  try {
    const crmSkills = require('./denizen-crm-skills');
    const result = await crmSkills.deleteContact(orgId, { contact_id: id }, scope?.identity_id || null);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolUpsertContact(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const identityId = scope?.identity_id || null;
  const actor = mcpActor.actorFromMcpScope(scope);
  const crmSkills = require('./denizen-crm-skills');
  const gate = await ownIds(scope, 'contact');
  try {
    const id = args?.id ?? args?.contact_id ?? args?.contactId;
    if (gate.ids && id != null && !gate.ids.has(String(id))) {
      return { ok: false, error: 'contact not found' };
    }
    if (id != null || args?.email) {
      // Prefer update when id/email matches an existing contact
      try {
        const updated = await crmSkills.updateContact(orgId, {
          ...args,
          actor,
          contactId: id ?? args.contactId ?? args.contact_id,
        }, identityId);
        return { ok: true, updated: true, ...updated };
      } catch (err) {
        if (id != null) return { ok: false, error: err?.message || String(err) };
        // fall through to create when email not found
      }
    }
    const created = await crmMutations.addContact(orgId, { ...(args || {}), ...ownerStamp(gate.actor) }, identityId, actor);
    return { ok: true, created: true, ...created };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolUpsertDeal(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const identityId = scope?.identity_id || null;
  const actor = mcpActor.actorFromMcpScope(scope);
  const gate = await ownIds(scope, 'deal');
  try {
    const dealId = args?.deal_id ?? args?.dealId ?? args?.id;
    if (gate.ids && dealId != null && !gate.ids.has(String(dealId))) {
      return { ok: false, error: 'deal not found' };
    }
    if (dealId != null) {
      const updated = await crmMutations.updateDeal(orgId, { ...args, deal_id: dealId, actor }, identityId);
      return { ok: true, updated: true, ...updated };
    }
    if (!args?.title) return { ok: false, error: 'title required to create a deal' };
    const created = await crmMutations.addDeal(orgId, { ...(args || {}), ...ownerStamp(gate.actor) }, identityId, actor);
    return { ok: true, created: !created.deal || created.summary?.includes('Created'), ...created };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolMoveDeal(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const gate = await ownIds(scope, 'deal');
  const dealId = args?.deal_id ?? args?.dealId ?? args?.id;
  if (gate.ids && dealId != null && !gate.ids.has(String(dealId))) {
    return { ok: false, error: 'deal not found' };
  }
  try {
    const crmSkills = require('./denizen-crm-skills');
    const result = await crmSkills.moveDeal(orgId, {
      deal_id: args?.deal_id ?? args?.dealId ?? args?.id,
      dealId: args?.deal_id ?? args?.dealId ?? args?.id,
      title: args?.title,
      stage: args?.stage,
    }, scope?.identity_id || null);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolUpsertTask(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const actor = mcpActor.actorFromMcpScope(scope);
  const gate = await ownIds(scope, 'task');
  try {
    const result = await crmMutations.addTask(orgId, {
      title: args?.title,
      contact: args?.contact,
      due: args?.due,
      priority: args?.priority,
      notes: args?.notes,
      deal_id: args?.deal_id ?? args?.dealId,
      dealId: args?.deal_id ?? args?.dealId,
      assignee: args?.assignee || actor.user,
      ...ownerStamp(gate.actor),
    }, scope?.identity_id || null, actor);
    return { ok: true, created: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolCompleteTask(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const gate = await ownIds(scope, 'task');
  const taskId = args?.task_id ?? args?.taskId ?? args?.id;
  if (gate.ids && taskId != null && !gate.ids.has(String(taskId))) {
    return { ok: false, error: 'task not found' };
  }
  try {
    const result = await crmMutations.closeTask(orgId, {
      task_id: args?.task_id ?? args?.taskId ?? args?.id,
      title: args?.title,
      delete: args?.delete === true,
    }, scope?.identity_id || null);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function toolAddNote(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  try {
    const crmSkills = require('./denizen-crm-skills');
    const result = await crmSkills.addNote(orgId, args || {}, scope?.identity_id || null);
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

async function toolListRecords(scope, args = {}) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const agentRecords = require('./denizen-crm-agent-records');
  const actor = await actorForScope(scope);
  const listed = await agentRecords.listRecords(orgId, args || {}, actor);
  return { ok: true, scope: actor?.forceOwn ? 'own' : 'org', ...listed };
}

async function toolBulk(scope, args, fn) {
  const orgId = resolveOrgId(scope);
  if (!orgId) return { ok: false, error: 'org_id unavailable' };
  const agentRecords = require('./denizen-crm-agent-records');
  const actor = await actorForScope(scope);
  try {
    const result = await fn(agentRecords, orgId, actor);
    return { ok: true, scope: actor?.forceOwn ? 'own' : 'org', ...result };
  } catch (err) {
    const msg = String(err?.message || err);
    const infra = /ECONNREFUSED|ENOTFOUND|PostgREST|fetch failed|SUPABASE/i.test(msg);
    return {
      ok: false,
      error: infra ? `${msg}. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this host.` : msg,
    };
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
  if (name === 'crm_list_records') return toolListRecords(scope, args);
  if (name === 'crm_bulk_update_deals') {
    return toolBulk(scope, args, (api, orgId, actor) => api.bulkUpdateDeals(orgId, args || {}, scope?.identity_id || null, actor));
  }
  if (name === 'crm_bulk_update_tasks') {
    return toolBulk(scope, args, (api, orgId, actor) => api.bulkUpdateTasks(orgId, args || {}, scope?.identity_id || null, actor));
  }
  if (name === 'crm_bulk_update_contacts') {
    return toolBulk(scope, args, (api, orgId, actor) => api.bulkUpdateContacts(orgId, args || {}, scope?.identity_id || null, actor));
  }
  if (name === 'crm_bulk_link_records' || name === 'crm_link_records') {
    return toolBulk(scope, args, (api, orgId, actor) => api.bulkLinkRecords(orgId, args || {}, scope?.identity_id || null, actor));
  }
  if (name === 'crm_upsert_package') {
    return toolBulk(scope, args, (api, orgId) => api.upsertPackage(orgId, args || {}, scope?.identity_id || null));
  }
  if (name === 'crm_update_profile') {
    return toolBulk(scope, args, async (api, orgId, actor) => api.updateProfile(
      orgId,
      args || {},
      scope?.identity_id || actor?.identityId || null,
      actor?.forceOwn ? 'angela' : null,
    ));
  }
  if (name === 'crm_update_task') {
    return toolBulk(scope, args, (api, orgId, actor) => api.bulkUpdateTasks(orgId, {
      updates: [{ ...(args || {}), task_id: args?.task_id ?? args?.id }],
    }, scope?.identity_id || null, actor));
  }
  if (name === 'crm_close_task') return toolCompleteTask(scope, args);
  if (name === 'crm_create_quote') return toolCreateQuote(scope, args);
  if (name === 'crm_calendar_status') return toolCalendarStatus(scope);
  if (name === 'business_context_sync') return toolSyncBusinessContext(scope);
  if (name === 'business_context_update') return toolUpdateBusinessContext(scope, args);
  if (name === 'crm_park_deal') return toolParkDeal(scope, args);
  if (name === 'crm_operate') {
    const orgId = resolveOrgId(scope);
    if (!orgId) return { ok: false, error: 'org_id unavailable' };
    const operate = require('./denizen-crm-operate');
    return operate.operateCrm(orgId, args || {}, scope?.identity_id || null, actorForScope(scope));
  }
  if (name === 'crm_upsert_company') return toolUpsertCompany(scope, args);
  if (name === 'crm_delete_contact') return toolDeleteContact(scope, args);
  if (name === 'crm_upsert_contact') return toolUpsertContact(scope, args);
  if (name === 'crm_upsert_deal') return toolUpsertDeal(scope, args);
  if (name === 'crm_move_deal') return toolMoveDeal(scope, args);
  if (name === 'crm_upsert_task') return toolUpsertTask(scope, args);
  if (name === 'crm_complete_task') return toolCompleteTask(scope, args);
  if (name === 'crm_add_note') return toolAddNote(scope, args);
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
