'use strict';

const bridge = require('./bridge-client');
const { fmtRows } = bridge;
const orgPolicy = require('../../src/denizen-org-policy');
const federalPipeline = require('../../src/federal-pipeline');
const crmMutations = require('../../src/denizen-crm-mutations');
const crmSkills = require('../../src/denizen-crm-skills');
const agentWrites = require('../../src/denizen-crm-agent-writes');
const crmCapture = require('../../src/denizen-crm-capture');

let _cachedOrgId = null;

async function defaultOrgId(config) {
  if (_cachedOrgId) return _cachedOrgId;
  const rows = await bridge.bridgeQuery(config, {
    table: 'denizen_organizations',
    select: ['id'],
    filters: { slug: { eq: process.env.DENIZEN_ORG_SLUG || 'zion' } },
    limit: 1,
  });
  _cachedOrgId = rows[0]?.id || null;
  return _cachedOrgId;
}

const ACTIONS = new Set([
  'intake-triage',
  'lead-monitor',
  'rfp-status',
  'prediction-brief',
  'client-lookup',
  'outcome-standup',
  'work-history',
  'cost-dashboard',
  'entity-link',
  'rfp-requirement-review',
  'rfp-pipeline-summary',
  'proposal-outline',
  'past-performance-match',
  'intake-to-client',
  'visitor-claim',
  'assistant-handoff',
  'org-benchmark',
  'crm-summary',
  'crm-list-pipeline',
  'crm-add-contact',
  'crm-update-deal',
  'crm-setup-status',
  'crm-list-industries',
  'crm-apply-industry',
  'crm-add-task',
  'crm-list-tasks',
  'crm-at-risk',
  'crm-add-ticket',
  'crm-list-tickets',
  'crm-setup-wizard',
  'crm-add-deal',
  'crm-update-profile',
  'crm-get-intake-link',
  'crm-update-contact',
  'crm-qualify-submission',
  'crm-draft-email',
  'crm-enroll-sequence',
  'crm-move-deal',
  'crm-mark-deal-outcome',
  'crm-generate-quote',
  'crm-pipeline-brief',
  'business-context-brief',
  'crm-dedupe-contacts',
  'crm-audit-workspace',
  'crm-export-snapshot',
  'crm-schedule-followup',
  'crm-recommend-package',
  'crm-invite-teammate',
  'crm-intake-to-pipeline',
  'crm-qualify-deal',
  'crm-save-at-risk-deal',
  'crm-draft-followup',
  'crm-enrich-contact',
  'crm-list-companies',
  'crm-list-contacts',
  'crm-add-company',
  'crm-link-company',
  'crm-list-quotes',
  'crm-portal-link',
  'crm-list-automations',
  'crm-add-automation',
  'crm-analytics-summary',
  'crm-marketing-funnel',
  'crm-calendar-status',
  'crm-sync-calendar',
  'crm-list-meetings',
  'crm-schedule-meeting',
  'crm-add-sequence',
  'crm-add-email-template',
  'crm-import-contacts',
  'crm-add-note',
  'crm-capture',
  'help',
]);

function resolveAction(skill, params) {
  if (params?.action && ACTIONS.has(params.action)) return params.action;
  if (ACTIONS.has(skill)) return skill;
  return 'help';
}

async function runAction(action, { npcName, params, config }) {
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  await orgPolicy.assertBusinessActionAllowed(orgSlug, action);

  switch (action) {
    case 'intake-triage':
      return intakeTriage(config, params);
    case 'lead-monitor':
      return leadMonitor(config, params);
    case 'rfp-status':
      return rfpStatus(config, params);
    case 'prediction-brief':
      return predictionBrief(config, params);
    case 'client-lookup':
      return clientLookup(config, params);
    case 'outcome-standup':
      return outcomeStandup(config, params);
    case 'work-history':
      return workHistory(config, params, npcName);
    case 'cost-dashboard':
      return costDashboard(config, params);
    case 'entity-link':
      return entityLink(config, params, npcName);
    case 'rfp-requirement-review':
      return rfpRequirementReview(config, params);
    case 'rfp-pipeline-summary':
      return rfpPipelineSummary(config, params);
    case 'proposal-outline':
      return proposalOutline(config, params);
    case 'past-performance-match':
      return pastPerformanceMatch(config, params);
    case 'intake-to-client':
      return intakeToClient(config, params, npcName);
    case 'visitor-claim':
      return visitorClaim(config, params);
    case 'assistant-handoff':
      return assistantHandoff(config, params);
    case 'org-benchmark':
      return orgBenchmark(config, params);
    case 'crm-summary':
      return crmSummary(config, params);
    case 'crm-list-pipeline':
      return crmListPipeline(config, params);
    case 'crm-add-contact':
      return crmAddContact(config, params);
    case 'crm-update-deal':
      return crmUpdateDeal(config, params, npcName);
    case 'crm-setup-status':
      return crmSetupStatus(config, params);
    case 'crm-setup-wizard':
      return crmSetupWizard(config, params);
    case 'crm-add-deal':
      return crmAddDeal(config, params);
    case 'crm-update-profile':
      return crmUpdateProfile(config, params);
    case 'crm-get-intake-link':
      return crmGetIntakeLink(config, params);
    case 'crm-list-industries':
      return crmListIndustries(config, params);
    case 'crm-apply-industry':
      return crmApplyIndustry(config, params, npcName);
    case 'crm-add-task':
      return crmAddTask(config, params, npcName);
    case 'crm-list-tasks':
      return crmListTasks(config, params);
    case 'crm-at-risk':
      return crmAtRisk(config, params);
    case 'crm-add-ticket':
      return crmAddTicket(config, params, npcName);
    case 'crm-list-tickets':
      return crmListTickets(config, params);
    case 'crm-update-contact':
      return crmUpdateContact(config, params);
    case 'crm-qualify-submission':
      return crmQualifySubmission(config, params);
    case 'crm-draft-email':
      return crmDraftEmail(config, params, npcName);
    case 'crm-enroll-sequence':
      return crmEnrollSequence(config, params);
    case 'crm-move-deal':
      return crmMoveDeal(config, params);
    case 'crm-mark-deal-outcome':
      return crmMarkDealOutcome(config, params);
    case 'crm-generate-quote':
      return crmGenerateQuote(config, params);
    case 'crm-pipeline-brief':
      return crmPipelineBrief(config, params);
    case 'business-context-brief':
      return businessContextBriefAction(config, params);
    case 'crm-dedupe-contacts':
      return crmDedupeContacts(config, params);
    case 'crm-audit-workspace':
      return crmAuditWorkspace(config, params);
    case 'crm-export-snapshot':
      return crmExportSnapshot(config, params);
    case 'crm-schedule-followup':
      return crmScheduleFollowup(config, params);
    case 'crm-recommend-package':
      return crmRecommendPackage(config, params);
    case 'crm-invite-teammate':
      return crmInviteTeammate(config, params);
    case 'crm-intake-to-pipeline':
      return crmIntakeToPipeline(config, params);
    case 'crm-qualify-deal':
      return crmQualifyDeal(config, params);
    case 'crm-save-at-risk-deal':
      return crmSaveAtRiskDeal(config, params);
    case 'crm-draft-followup':
      return crmDraftFollowup(config, params);
    case 'crm-enrich-contact':
      return crmEnrichContact(config, params);
    case 'crm-list-companies':
      return crmListCompanies(config, params);
    case 'crm-list-contacts':
      return crmListContacts(config, params);
    case 'crm-add-company':
      return crmAddCompany(config, params, npcName);
    case 'crm-link-company':
      return crmLinkCompany(config, params, npcName);
    case 'crm-list-quotes':
      return crmListQuotes(config, params);
    case 'crm-portal-link':
      return crmPortalLink(config, params, npcName);
    case 'crm-list-automations':
      return crmListAutomations(config, params);
    case 'crm-add-automation':
      return crmAddAutomation(config, params, npcName);
    case 'crm-analytics-summary':
      return crmAnalyticsSummary(config, params);
    case 'crm-marketing-funnel':
      return crmMarketingFunnel(config, params);
    case 'crm-calendar-status':
      return crmCalendarStatus(config, params);
    case 'crm-sync-calendar':
      return crmSyncCalendar(config, params, npcName);
    case 'crm-list-meetings':
      return crmListMeetings(config, params);
    case 'crm-schedule-meeting':
      return crmScheduleMeeting(config, params, npcName);
    case 'crm-add-sequence':
      return crmAddSequence(config, params, npcName);
    case 'crm-add-email-template':
      return crmAddEmailTemplate(config, params, npcName);
    case 'crm-import-contacts':
      return crmImportContacts(config, params, npcName);
    case 'crm-add-note':
      return crmAddNote(config, params, npcName);
    case 'crm-capture':
      return crmCaptureAction(config, params, npcName);
    default:
      return {
        summary: `Denizen data skills: ${[...ACTIONS].filter((a) => a !== 'help').join(', ')}`,
      };
  }
}

async function intakeTriage(config, params) {
  const status = params.status || 'new';
  const intakes = await bridge.bridgeQuery(config, {
    table: 'intake_forms',
    select: ['id', 'full_name', 'company_name', 'email', 'service_category', 'budget_range', 'priority_score', 'status', 'created_at'],
    filters: { status: { eq: status } },
    order: { priority_score: 'desc' },
    limit: Number(params.limit) || 10,
  });

  const preds = [];
  for (const row of intakes.slice(0, 5)) {
    const p = await bridge.bridgeQuery(config, {
      table: 'denizen_predictions',
      select: ['entity_id', 'prediction_type', 'confidence', 'prediction', 'validated_at'],
      filters: { entity_id: { eq: row.id }, entity_type: { eq: 'intake_form' } },
      order: { created_at: 'desc' },
      limit: 1,
    });
    if (p[0]) preds.push({ intake_id: row.id, ...p[0] });
  }

  return {
    summary: `${intakes.length} intake(s) with status="${status}". Top: ${fmtRows(intakes, 5)}`,
    intakes,
    predictions: preds,
  };
}

async function leadMonitor(config, params) {
  const leads = await bridge.bridgeQuery(config, {
    table: 'leads',
    select: ['id', 'name', 'email', 'company', 'source', 'status', 'created_at'],
    filters: params.status ? { status: { eq: params.status } } : {},
    order: { created_at: 'desc' },
    limit: Number(params.limit) || 15,
  });
  const open = leads.filter((l) => !/archiv|spam|lost/i.test(l.status || ''));
  const suggestions = open.slice(0, 3).map(l => `Use crm-enrich-contact for ${l.name} (${l.email || l.company || 'n/a'}) with source '${l.source || 'lead'}' then crm-add-deal if fit is strong (1921/OMES/RM Cyber keywords)`);
  return {
    summary: `${leads.length} lead(s) fetched (${open.length} open). ${fmtRows(open, 6)}. Actionable: ${suggestions.join('; ')} — run via run_skill denizen-data lead-monitor + crm-enrich-contact + crm-add-deal. High fit ones get tagged research-lead automatically on enrich.`,
    leads: open,
    grok_suggestions: suggestions,
    openCount: open.length,
    suggestedActions: open.slice(0, 2).map(l => ({ action: 'crm-enrich-contact', params: { name: l.name, email: l.email, company: l.company, source: l.source, score: 55 } })),
  };
}

async function rfpStatus(config, params) {
  // rfps is shared by every org on this database (dossier G#5) — scope first.
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'Default org not found — apply Denizen migrations.' };

  const filters = { org_id: { eq: orgId } };
  if (params.status) filters.status = { eq: params.status };
  if (params.rfp_id) filters.id = { eq: params.rfp_id };
  if (params.solicitation_number) filters.solicitation_number = { eq: params.solicitation_number };

  const rfps = await bridge.bridgeQuery(config, {
    table: 'rfps',
    select: ['id', 'title', 'agency', 'solicitation_number', 'status', 'bid_decision', 'proposal_due_date', 'estimated_value_max'],
    filters,
    order: { proposal_due_date: 'asc' },
    limit: Number(params.limit) || 10,
  });

  const pipelineDb = createPipelineBridgeDb(config);
  const enriched = [];
  for (const rfp of rfps) {
    const detail = await federalPipeline.getRfpDetail(pipelineDb, rfp.id, { orgId }).catch(() => null);
    if (detail) {
      enriched.push({
        ...rfp,
        bid_probability: detail.bid_probability,
        requirement_completion_pct: detail.requirement_completion_pct,
        days_to_due: detail.days_to_due,
      });
    } else {
      enriched.push(rfp);
    }
  }

  let velocity = [];
  if (rfps[0]?.id) {
    velocity = await bridge.bridgeQuery(config, {
      table: 'denizen_rfp_velocity',
      select: ['rfp_id', 'requirement_count', 'workflow_run_count', 'total_tokens', 'days_until_due_at_create'],
      filters: { rfp_id: { eq: rfps[0].id } },
      limit: 1,
    });
  }

  return {
    summary: `${enriched.length} RFP(s). ${fmtRows(enriched, 4)}${velocity[0] ? ` Velocity: ${JSON.stringify(velocity[0])}` : ''}`,
    rfps: enriched,
    velocity: velocity[0] || null,
  };
}

async function predictionBrief(config, params) {
  const filters = { entity_type: { eq: params.entity_type || 'intake_form' } };
  if (params.entity_id) filters.entity_id = { eq: params.entity_id };
  if (params.entity_key) filters.entity_key = { eq: params.entity_key };

  const preds = await bridge.bridgeQuery(config, {
    table: 'denizen_predictions',
    select: ['id', 'prediction_type', 'entity_type', 'entity_id', 'entity_key', 'confidence', 'prediction', 'validated_at', 'accuracy_score', 'created_at'],
    filters,
    order: { created_at: 'desc' },
    limit: Number(params.limit) || 5,
  });

  if (!preds.length && params.email) {
    const intakes = await bridge.bridgeQuery(config, {
      table: 'intake_forms',
      select: ['id', 'email', 'company_name', 'status'],
      filters: { email: { eq: params.email } },
      limit: 1,
    });
    if (intakes[0]) {
      return predictionBrief(config, { ...params, entity_id: intakes[0].id, email: null });
    }
  }

  const p = preds[0];
  const prob = p?.prediction?.close_probability ?? p?.prediction?.bid_probability ?? p?.confidence;
  let accuracySummary = { sample_size: 0, validated: 0, avg_accuracy: null };
  if (p?.prediction_type) {
    const benchFilters = { prediction_type: { eq: p.prediction_type } };
    const orgId = await defaultOrgId(config).catch(() => null);
    if (orgId) benchFilters.org_id = { eq: orgId };
    const benchmarkRows = await bridge.bridgeQuery(config, {
      table: 'denizen_predictions',
      select: ['accuracy_score', 'validated_at'],
      filters: benchFilters,
      order: { created_at: 'desc' },
      limit: 200,
    });
    const validated = (benchmarkRows || []).filter((r) => r.validated_at != null);
    const accuracyTotal = validated.reduce((sum, r) => sum + (Number(r.accuracy_score) || 0), 0);
    accuracySummary = {
      sample_size: (benchmarkRows || []).length,
      validated: validated.length,
      avg_accuracy: validated.length ? +(accuracyTotal / validated.length).toFixed(3) : null,
    };
  }
  return {
    summary: p
      ? `Prediction ${p.prediction_type}: ${Math.round((prob || 0) * 100)}% confidence${p.validated_at ? `, validated accuracy ${p.accuracy_score}` : ' (pending validation)'}; benchmark ${accuracySummary.validated}/${accuracySummary.sample_size} validated${accuracySummary.avg_accuracy != null ? `, avg ${Math.round(accuracySummary.avg_accuracy * 100)}%` : ''}`
      : 'No predictions found for this entity.',
    predictions: preds,
    accuracy_summary: accuracySummary,
  };
}

async function clientLookup(config, params) {
  const filters = {};
  if (params.email) filters.email = { eq: params.email };
  if (params.company) filters.company = { ilike: `%${params.company}%` };
  if (params.client_id) filters.id = { eq: params.client_id };

  const clients = await bridge.bridgeQuery(config, {
    table: 'clients',
    select: ['id', 'name', 'company', 'email', 'phone', 'status', 'created_at'],
    filters,
    order: { created_at: 'desc' },
    limit: Number(params.limit) || 5,
  });

  return {
    summary: clients.length ? `Found ${clients.length} client(s): ${fmtRows(clients, 3)}` : 'No matching clients.',
    clients,
  };
}

async function outcomeStandup(config, params) {
  const hours = Number(params.hours) || 168;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  let outcomes = [];
  try {
    outcomes = await bridge.bridgeQuery(config, {
      table: 'denizen_outcomes',
      select: ['outcome_type', 'entity_type', 'entity_id', 'entity_key', 'value_text', 'observed_at'],
      filters: {},
      order: { observed_at: 'desc' },
      limit: Number(params.limit) || 20,
    });
  } catch (_) {
    outcomes = [];
  }

  let recent = (outcomes || []).filter((o) => !since || o.observed_at >= since);
  let source = 'denizen_outcomes';

  // Local ledger fallback — unattended work writes here even when DB table is empty
  if (!recent.length) {
    try {
      const ledger = require('../../src/denizen-outcome-ledger');
      const local = ledger.standup({ hours, limit: Number(params.limit) || 20 });
      if (local.count > 0) {
        recent = local.outcomes.map((o) => ({
          outcome_type: o.outcome_type,
          entity_type: o.entity_type,
          entity_key: o.entity_key,
          value_text: o.value_text,
          observed_at: o.ts,
          pass: o.pass,
          actor: o.actor,
          source: o.source,
        }));
        source = 'outcome-ledger';
      }
    } catch (_) {}
  }

  const byType = {};
  for (const o of recent) {
    byType[o.outcome_type] = (byType[o.outcome_type] || 0) + 1;
  }

  return {
    summary: `Last ${hours}h: ${recent.length} outcomes (${source}). Breakdown: ${JSON.stringify(byType)}. ${fmtRows(recent, 5)}`,
    outcomes: recent,
    breakdown: byType,
    source,
  };
}

async function workHistory(config, params, npcName) {
  const npc_key = (params.npc_key || npcName || '').toLowerCase();
  const filters = npc_key ? { npc_key: { eq: npc_key } } : {};

  const rows = await bridge.bridgeQuery(config, {
    table: 'denizen_work_output',
    select: ['npc_key', 'phase', 'action', 'note', 'artifact_path', 'ts'],
    filters,
    order: { ts: 'desc' },
    limit: Number(params.limit) || 15,
  });

  return {
    summary: `${rows.length} work output row(s)${npc_key ? ` for ${npc_key}` : ''}. ${fmtRows(rows, 6)}`,
    work: rows,
  };
}

async function costDashboard(config, params) {
  const llm = await bridge.bridgeQuery(config, {
    table: 'denizen_llm_events',
    select: ['npc_key', 'kind', 'provider', 'model', 'tokens_in', 'tokens_out', 'latency_ms', 'at'],
    filters: params.npc_key ? { npc_key: { eq: params.npc_key } } : {},
    order: { at: 'desc' },
    limit: Number(params.limit) || 30,
  });

  const workflows = await bridge.bridgeQuery(config, {
    table: 'workflow_runs',
    select: ['workflow_name', 'status', 'tokens_input', 'tokens_output', 'cost_estimate', 'rfp_id'],
    filters: params.rfp_id ? { rfp_id: { eq: params.rfp_id } } : {},
    order: { created_at: 'desc' },
    limit: 10,
  });

  const tokensIn = llm.reduce((s, r) => s + (r.tokens_in || 0), 0);
  const tokensOut = llm.reduce((s, r) => s + (r.tokens_out || 0), 0);

  return {
    summary: `LLM: ${llm.length} calls, ${tokensIn + tokensOut} tokens. Workflows: ${workflows.length} runs. ${fmtRows(workflows, 3)}`,
    llm_events: llm,
    workflow_runs: workflows,
    totals: { tokens_in: tokensIn, tokens_out: tokensOut, llm_calls: llm.length },
  };
}

async function entityLink(config, params, npcName) {
  const entity_type = params.entity_type;
  const entity_id = params.entity_id;
  if (!entity_type || !entity_id) {
    return { summary: 'entity-link requires entity_type and entity_id.' };
  }

  const org_id = await defaultOrgId(config);
  if (!org_id) return { summary: 'Default org not found — apply Denizen migrations.' };

  const npc_key = (params.npc_key || npcName || 'unknown').toLowerCase();
  await bridge.bridgeInsert(config, {
    table: 'denizen_entity_links',
    rows: [{
      org_id,
      entity_type,
      entity_id,
      link_kind: params.link_kind || 'worked_on',
      npc_key,
      source_type: 'npc',
      metadata: {
        note: params.note || null,
        display_name: npcName,
      },
    }],
  });

  await bridge.bridgeInsert(config, {
    table: 'denizen_facts',
    rows: [{
      org_id,
      fact_type: params.fact_type || `${entity_type}.reviewed`,
      actor_type: 'npc',
      actor_id: npc_key,
      entity_type,
      entity_id,
      payload: { title: params.note || `${npcName} linked to ${entity_type}`, npc: npcName },
      tags: ['entity-link', entity_type],
    }],
  });

  return {
    summary: `Linked ${npcName} → ${entity_type}:${entity_id} (${params.link_kind || 'worked_on'})`,
  };
}

async function rfpRequirementReview(config, params) {
  if (!params.rfp_id) return { summary: 'rfp-requirement-review requires rfp_id.' };
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'Default org not found — apply Denizen migrations.' };
  // Scoped by org as well as id, so an rfp uuid from another tenant reads as
  // "not found" rather than returning their solicitation.
  const detail = await federalPipeline.getRfpDetail(
    createPipelineBridgeDb(config), params.rfp_id, { orgId },
  );
  if (!detail) return { summary: `RFP ${params.rfp_id} not found.` };
  const reqs = (detail.requirements_by_status ? Object.values(detail.requirements_by_status).flat() : [])
    .slice(0, Number(params.limit) || 1000);
  const highRisk = reqs.filter((r) => r.risk_level === 'high' || Number(r.priority || 0) >= 8);
  const groupedByStatus = detail.requirements_by_status || {};
  const unmetMandatory = detail.unmet_mandatory_requirements || [];
  return {
    summary: `${reqs.length} requirements (${highRisk.length} high priority/risk, ${unmetMandatory.length} unmet mandatory).`,
    requirements: reqs,
    grouped_by_status: groupedByStatus,
    unmet_mandatory: unmetMandatory,
    high_risk: highRisk,
  };
}

function createPipelineBridgeDb(config) {
  return {
    query: (q) => bridge.bridgeQuery(config, q),
  };
}

async function rfpPipelineSummary(config) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'Default org not found — apply Denizen migrations.' };
  const summary = await federalPipeline.getRfpPipelineSummary(
    createPipelineBridgeDb(config), { orgId },
  );
  const countsTxt = Object.entries(summary.counts_by_status || {})
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
  const dueTxt = (summary.next_due_dates || [])
    .map((d) => `${d.title || d.id} (${d.days_to_due}d)`)
    .join('; ');
  return {
    summary: `Federal pipeline: ${summary.total_rfps} total, value $${Math.round(summary.total_pipeline_value || 0).toLocaleString()}. Statuses: ${countsTxt || 'none'}. Next due: ${dueTxt || 'none'}.`,
    ...summary,
  };
}

async function proposalOutline(config, params) {
  if (!params.rfp_id) return { summary: 'proposal-outline requires rfp_id.' };

  if (params.draft_content || params.status) {
    if (!params.outline_id) return { summary: 'Update requires outline_id.' };
    await bridge.bridgeUpdate(config, {
      table: 'proposal_outlines',
      filters: { id: { eq: params.outline_id } },
      data: {
        ...(params.draft_content ? { draft_content: params.draft_content } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
    });
    return { summary: `Updated proposal outline ${params.outline_id}` };
  }

  const outlines = await bridge.bridgeQuery(config, {
    table: 'proposal_outlines',
    select: ['id', 'section_number', 'title', 'status', 'assigned_to', 'word_count_actual', 'order_index'],
    filters: { rfp_id: { eq: params.rfp_id } },
    order: { order_index: 'asc' },
    limit: Number(params.limit) || 30,
  });

  return {
    summary: `${outlines.length} outline section(s). ${fmtRows(outlines, 8)}`,
    outlines,
  };
}

async function pastPerformanceMatch(config, params) {
  const filters = { is_active: { eq: true } };
  if (params.naics_code) filters.naics_code = { eq: params.naics_code };

  const rows = await bridge.bridgeQuery(config, {
    table: 'past_performance',
    select: ['id', 'project_name', 'client_name', 'naics_code', 'dollar_value', 'description', 'times_used'],
    filters,
    order: { times_used: 'desc' },
    limit: Number(params.limit) || 10,
  });

  let filtered = rows;
  if (params.agency) {
    const needle = params.agency.toLowerCase();
    filtered = rows.filter((r) => (r.client_name || '').toLowerCase().includes(needle)
      || (r.description || '').toLowerCase().includes(needle));
  }

  return {
    summary: `${filtered.length} past performance record(s). ${fmtRows(filtered, 4)}`,
    past_performance: filtered,
  };
}

async function intakeToClient(config, params, npcName) {
  const intake_id = params.intake_id;
  if (!intake_id) return { summary: 'intake-to-client requires intake_id.' };

  const intakes = await bridge.bridgeQuery(config, {
    table: 'intake_forms',
    select: ['id', 'full_name', 'company_name', 'email', 'status'],
    filters: { id: { eq: intake_id } },
    limit: 1,
  });
  const intake = intakes[0];
  if (!intake) return { summary: `Intake ${intake_id} not found.` };

  let clients = [];
  if (intake.email) {
    clients = await bridge.bridgeQuery(config, {
      table: 'clients',
      select: ['id', 'name', 'company', 'email', 'status'],
      filters: { email: { eq: intake.email } },
      limit: 3,
    });
  }

  const org_id = await defaultOrgId(config);
  if (org_id) {
    await bridge.bridgeInsert(config, {
      table: 'denizen_facts',
      rows: [{
        org_id,
        fact_type: 'intake.reviewed',
        actor_type: 'npc',
        actor_id: (npcName || 'lucy').toLowerCase(),
        entity_type: 'intake_form',
        entity_id: intake_id,
        payload: {
          note: params.note || `${npcName} reviewed intake`,
          client_matches: clients.length,
          status: intake.status,
        },
        tags: ['intake', 'reviewed'],
      }],
    });
  }

  return {
    summary: `Reviewed intake ${intake.company_name || intake.full_name}. ${clients.length} matching client(s). ${fmtRows(clients, 2)}`,
    intake,
    clients,
  };
}

async function visitorClaim(config, params) {
  const session_id = params.session_id;
  const npc_key = params.npc_key;
  if (!session_id || !npc_key) {
    return { summary: 'visitor-claim requires session_id and npc_key.' };
  }

  await bridge.bridgeInsert(config, {
    table: 'denizen_user_assistants',
    rows: [{
      session_id,
      npc_key,
      assistant_name: params.assistant_name || npc_key,
      focus: params.focus || null,
      role_overlay: params.role_overlay || null,
    }],
  });

  return {
    summary: `Visitor ${session_id} claimed NPC ${npc_key} as personal assistant.`,
  };
}

async function assistantHandoff(config, params) {
  const { from_session_id, to_session_id, from_npc, to_npc, message } = params;
  if (!from_session_id || !to_session_id || !message) {
    return { summary: 'assistant-handoff requires from_session_id, to_session_id, and message.' };
  }

  await bridge.bridgeInsert(config, {
    table: 'denizen_assistant_messages',
    rows: [{
      from_session_id,
      to_session_id,
      from_npc: from_npc || 'lucy',
      to_npc: to_npc || 'assistant',
      message,
      status: 'pending',
      metadata: params.metadata || {},
    }],
  });

  return {
    summary: `Handoff message queued: ${from_npc || 'lucy'} → ${to_npc || 'assistant'}`,
  };
}

async function orgBenchmark(config, params) {
  const preds = await bridge.bridgeQuery(config, {
    table: 'denizen_predictions',
    select: ['prediction_type', 'confidence', 'accuracy_score', 'validated_at', 'entity_type'],
    filters: {},
    order: { created_at: 'desc' },
    limit: Number(params.limit) || 100,
  });

  const validated = preds.filter((p) => p.validated_at != null);
  const byType = {};
  for (const p of validated) {
    const k = p.prediction_type || 'unknown';
    if (!byType[k]) byType[k] = { count: 0, accuracy_sum: 0 };
    byType[k].count += 1;
    byType[k].accuracy_sum += Number(p.accuracy_score) || 0;
  }
  for (const k of Object.keys(byType)) {
    byType[k].avg_accuracy = +(byType[k].accuracy_sum / byType[k].count).toFixed(3);
    delete byType[k].accuracy_sum;
  }

  return {
    summary: `Predictions: ${preds.length} total, ${validated.length} validated. Benchmark: ${JSON.stringify(byType)}`,
    benchmark: byType,
    sample_size: validated.length,
  };
}

async function crmSummary(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) {
    return { summary: 'CRM workspace unavailable — organization not resolved.' };
  }
  const rows = await bridge.bridgeQuery(config, {
    table: 'denizen_crm_workspaces',
    select: ['org_id', 'state', 'updated_at', 'schema_version'],
    filters: { org_id: { eq: orgId } },
    limit: 1,
  });
  const row = rows[0];
  if (!row) {
    return { summary: 'No CRM workspace saved yet for this team.' };
  }
  const state = row.state || {};
  const contacts = Array.isArray(state.contacts) ? state.contacts.length : 0;
  const deals = Array.isArray(state.deals) ? state.deals.length : 0;
  const openDeals = (state.deals || []).filter(
    (d) => d && !/closed won|closed lost/i.test(String(d.stage || '')),
  ).length;
  const tasks = Array.isArray(state.tasks) ? state.tasks.filter((t) => t && !t.done).length : 0;
  const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  const openTickets = tickets.filter((t) => t && (t.status === 'open' || t.status === 'pending')).length;
  const campaigns = Array.isArray(state.marketingCampaigns) ? state.marketingCampaigns : [];
  const activeCampaigns = campaigns.filter((c) => c && c.status === 'active').length;
  return {
    summary: `CRM: ${contacts} contacts, ${deals} deals (${openDeals} open), ${tasks} open tasks, ${openTickets} open tickets, ${activeCampaigns} active campaign(s). Updated ${row.updated_at || 'unknown'}.`,
    counts: { contacts, deals, openDeals, openTasks: tasks, openTickets, activeCampaigns },
    updated_at: row.updated_at,
  };
}

async function crmListPipeline(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.listPipeline(orgId, params);
}

async function crmAddContact(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.addContact(orgId, params);
}

async function crmUpdateDeal(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  const stage = String(params.stage || '').trim();
  const dealId = params.dealId ?? params.id;
  if (stage && dealId != null && dealId !== '') {
    const viaAgent = await agentWrites.updateDealStage({
      orgSlug,
      dealId,
      stage,
      npcName: npcName || params.senderName || 'Marcus',
      identityId: params.identityId || null,
    });
    if (viaAgent.ok) {
      return {
        summary: viaAgent.summary,
        deal: viaAgent.deal,
        previousStage: viaAgent.previousStage,
        note: /closed won/i.test(stage) ? 'Deal marked won — team office may show a CRM notification.' : undefined,
      };
    }
    if (viaAgent.code === 'ORG_POLICY_DENIED' || viaAgent.code === 'MISSING_ORG') {
      return { summary: viaAgent.error || viaAgent.summary, error: viaAgent.error };
    }
  }
  const result = await crmMutations.updateDeal(orgId, params);
  if (/closed won/i.test(String(result.deal?.stage || ''))) {
    result.note = 'Deal marked won — team office may show a CRM notification.';
  }
  return result;
}

async function crmSetupStatus(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const wizard = require('../../src/denizen-crm-setup-wizard');
  const chatActions = require('../../src/denizen-crm-chat-actions');
  const result = await crmMutations.getSetupStatus(orgId, params);
  const lines = [result.summary];
  if (params.demoCoach) {
    lines.unshift('Demo mode — I can guide you through CRM setup, but saving changes needs a team account (Citizen ID → Team access).');
  }
  if (params.deferTo && params.deferredSkill) {
    lines.unshift(`That action (${params.deferredSkill}) is owned by ${params.deferTo} — ask them in chat or tap Ask ${params.deferTo} below.`);
  }
  return {
    ...result,
    summary: lines.join('\n'),
    crm_actions: chatActions.normalizeCrmActions([
      ...wizard.proposeSetupActions(result.setup, params.task || params.message),
      ...(params.deferTo ? [chatActions.askNpcAction(params.deferTo, params.task || 'Help with CRM', `Ask ${params.deferTo}`)] : []),
    ]),
  };
}

async function crmSetupWizard(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const wizard = require('../../src/denizen-crm-setup-wizard');
  const industryBridge = require('../../src/denizen-crm-industry-bridge');
  let industryId = params.industryId || params.templateId || params.industry;
  if (!industryId && params.task) {
    industryId = wizard.inferIndustryId(params);
  }
  let mode = params.mode || 'run_all';
  if (mode === 'run_all' && !params.forceBatch) mode = 'interactive';
  if (/\b(continue|next step|keep going)\b/i.test(String(params.task || ''))) mode = 'continue';
  const out = await wizard.runSetupWizard(orgId, {
    mode: params.stepId ? 'run_step' : mode,
    stepId: params.stepId || params.step || null,
    identityId: params.identityId || null,
    sessionId: params.sessionId || null,
    orgSlug: params.orgSlug || config?.orgSlug || process.env.DENIZEN_ORG_SLUG || null,
    profile: params.profile || null,
    displayName: params.displayName || null,
    workPosition: params.workPosition || null,
    industryId,
    contact: params.contact || (params.name || params.email ? {
      name: params.name,
      email: params.email,
      company: params.company,
    } : null),
    deal: params.deal || (params.title && !params.name ? { title: params.title, contact: params.contact, value: params.value } : null),
    seedPackages: params.seedPackages !== false,
    task: params.task || '',
    teamCount: params.teamCount || null,
    inviterName: params.inviterName || null,
    inviteEmail: params.inviteEmail || null,
    inviteName: params.inviteName || null,
    platform: params.platform || null,
  });
  const chatActions = require('../../src/denizen-crm-chat-actions');
  return {
    ...out,
    crm_actions: chatActions.normalizeCrmActions(out.crm_actions || []),
  };
}

async function crmAddDeal(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const result = await crmMutations.addDeal(orgId, params);
  const wizard = require('../../src/denizen-crm-setup-wizard');
  return {
    ...result,
    crm_actions: [wizard.navAction('sales', 'Open pipeline', { subTab: 'pipeline' })],
  };
}

async function crmUpdateProfile(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.updateUserProfile(orgId, params.profile || params);
}

async function crmGetIntakeLink(config, params) {
  const wizard = require('../../src/denizen-crm-setup-wizard');
  const chatActions = require('../../src/denizen-crm-chat-actions');
  const orgSlug = params.orgSlug || config?.orgSlug || process.env.DENIZEN_ORG_SLUG || '';
  const intakeUrl = wizard.buildIntakeUrl(orgSlug);
  return {
    summary: `Public intake form — copy and share with prospects:\n${intakeUrl}`,
    intake_url: intakeUrl,
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.copyLinkAction(intakeUrl, 'Copy intake link'),
      wizard.navAction('intake', 'Open intake settings'),
    ]),
  };
}

async function crmListIndustries(config, params) {
  const industryBridge = require('../../src/denizen-crm-industry-bridge');
  const q = String(params.query || params.task || '').trim();
  const rows = industryBridge.listIndustries(q);
  const limit = Math.min(20, Math.max(1, Number(params.limit) || 12));
  const slice = rows.slice(0, limit);
  return {
    summary: `${rows.length} industry template(s). ${slice.map((r) => `${r.icon} ${r.name} (${r.id})`).join('; ')}`,
    industries: slice,
    total: rows.length,
  };
}

async function crmApplyIndustry(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.applyIndustry(orgId, { ...params, npcName }, null);
}

async function crmAddTask(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  const title = String(params.title || params.task || params.name || '').trim();
  if (title) {
    const viaAgent = await agentWrites.logTask({
      orgSlug,
      npcName: npcName || params.senderName || 'Lucy',
      title,
      dueAt: params.due || params.dueAt || undefined,
      identityId: params.identityId || null,
    });
    if (viaAgent.ok) {
      return { summary: viaAgent.summary, task: viaAgent.task };
    }
    if (viaAgent.code === 'ORG_POLICY_DENIED' || viaAgent.code === 'MISSING_ORG') {
      return { summary: viaAgent.error || viaAgent.summary, error: viaAgent.error };
    }
  }
  return crmMutations.addTask(orgId, params);
}

async function crmListTasks(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.listTasks(orgId, { ...params, overdue: params.overdue ? true : undefined });
}

async function crmAtRisk(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.listAtRisk(orgId, params);
}

async function crmAddTicket(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.addTicket(orgId, { ...params, npcName }, null);
}

async function crmListTickets(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.listTickets(orgId, { ...params, overdue: params.overdue ? true : undefined });
}

async function crmWrap(orgId, params, npcName, fn) {
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return fn(orgId, { ...params, senderName: params.senderName || npcName, npcName }, params.identityId || null);
}

async function crmUpdateContact(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.updateContact);
}

async function crmQualifySubmission(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.qualifySubmission);
}

async function crmDraftEmail(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.draftEmail);
}

async function crmEnrollSequence(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.enrollSequenceSkill);
}

async function crmMoveDeal(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  const stage = String(params.stage || params.to || '').trim();
  let dealId = params.dealId ?? params.id;
  if (stage && (dealId == null || dealId === '')) {
    const { state } = await crmMutations.loadOrgWorkspace(orgId);
    const deal = crmSkills.findDeal(state, params);
    dealId = deal?.id;
  }
  if (stage && dealId != null && dealId !== '') {
    const viaAgent = await agentWrites.updateDealStage({
      orgSlug,
      dealId,
      stage,
      npcName: npcName || params.senderName || 'Marcus',
      identityId: params.identityId || null,
    });
    if (viaAgent.ok) {
      return { summary: viaAgent.summary, deal: viaAgent.deal, previousStage: viaAgent.previousStage };
    }
    if (viaAgent.code === 'ORG_POLICY_DENIED' || viaAgent.code === 'MISSING_ORG') {
      return { summary: viaAgent.error || viaAgent.summary, error: viaAgent.error };
    }
  }
  return crmWrap(orgId, params, npcName, crmSkills.moveDeal);
}

async function crmMarkDealOutcome(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.markDealOutcome);
}

async function crmGenerateQuote(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.generateQuote);
}

async function crmPipelineBrief(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.pipelineBrief(orgId, params);
}

async function businessContextBriefAction(config, params) {
  const businessContext = require('../../src/denizen-business-context');
  const orgId = await defaultOrgId(config);
  return businessContext.businessContextBrief(orgId, params);
}

async function crmDedupeContacts(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  const merged = /\bmerge\b/i.test(String(params.task || ''));
  return crmWrap(orgId, { ...params, merge: merged || params.merge }, npcName, crmSkills.dedupeContacts);
}

async function crmAuditWorkspace(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.auditWorkspace(orgId);
}

async function crmExportSnapshot(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.exportSnapshot(orgId);
}

async function crmScheduleFollowup(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.scheduleFollowup);
}

async function crmRecommendPackage(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.recommendPackage(orgId, params);
}

async function crmInviteTeammate(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, {
    ...params,
    orgSlug: params.orgSlug || config?.orgSlug || process.env.DENIZEN_ORG_SLUG,
  }, npcName, crmSkills.inviteTeammateSkill);
}

async function crmIntakeToPipeline(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.intakeToPipeline);
}

async function crmQualifyDeal(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.qualifyDeal(orgId, params);
}

async function crmSaveAtRiskDeal(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.saveAtRiskDeal);
}

async function crmDraftFollowup(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.draftFollowup(orgId, params);
}

async function crmEnrichContact(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.enrichContact(orgId, params);
}

async function crmListCompanies(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.listCompanies(orgId, params);
}

async function crmListContacts(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  // Proxy to existing or implement basic list
  if (typeof crmSkills.listContacts === 'function') {
    return crmSkills.listContacts(orgId, params);
  }
  // Fallback: load workspace and return contacts (enables full visibility)
  const { state } = await require('../../src/denizen-crm-mutations').loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state?.contacts) ? state.contacts : [];
  return {
    contacts: contacts.slice(0, params?.limit || 50),
    total: contacts.length,
    note: 'Full list via workspace (use enrich for details)'
  };
}

async function crmAddCompany(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.addCompany);
}

async function crmLinkCompany(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.linkContactCompany);
}

async function crmListQuotes(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.listQuotes(orgId, params);
}

async function crmPortalLink(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.portalLink);
}

async function crmListAutomations(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.listAutomations(orgId);
}

async function crmAddAutomation(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.addAutomation);
}

async function crmAnalyticsSummary(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.analyticsSummary(orgId);
}

async function crmMarketingFunnel(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.marketingFunnel(orgId);
}

async function crmCalendarStatus(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.calendarStatusSkill(orgId, params);
}

async function crmSyncCalendar(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.syncCalendarSkill);
}

async function crmListMeetings(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmSkills.listMeetings(orgId, params);
}

async function crmScheduleMeeting(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.scheduleMeeting);
}

async function crmAddSequence(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.addSequence);
}

async function crmAddEmailTemplate(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.addEmailTemplate);
}

async function crmImportContacts(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  return crmWrap(orgId, params, npcName, crmSkills.importContacts);
}

async function crmAddNote(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  const body = String(params.text || params.note || params.body || params.task || '').trim();
  if (!body) return { summary: 'note text required', error: 'note text required' };
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = crmSkills.findContact(state, params);
  const deal = crmSkills.findDeal(state, params);
  const viaAgent = await agentWrites.createNote({
    orgSlug,
    npcName: npcName || params.senderName || 'Lucy',
    contactId: contact?.id ?? params.contactId,
    dealId: deal?.id ?? params.dealId,
    body,
    identityId: params.identityId || null,
  });
  if (viaAgent.ok) {
    return { summary: viaAgent.summary, note: viaAgent.note };
  }
  if (viaAgent.code === 'ORG_POLICY_DENIED' || viaAgent.code === 'MISSING_ORG') {
    return { summary: viaAgent.error || viaAgent.summary, error: viaAgent.error };
  }
  return crmWrap(orgId, params, npcName, crmSkills.addNote);
}

async function crmCaptureAction(config, params, npcName) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const orgSlug = config?.orgSlug || config?.supabase?.orgSlug || process.env.DENIZEN_ORG_SLUG || 'zion';
  const message = String(params.message || params.task || params.text || params.note || '').trim();
  const result = await crmCapture.runCapture({
    orgSlug,
    orgId,
    npcName: npcName || params.senderName || 'Lucy',
    message,
    identityId: params.identityId || null,
    name: params.name || params.contact,
    email: params.email,
    deal: params.deal || params.title,
    due: params.due || params.dueAt,
    stage: params.stage,
  });
  return {
    summary: result.summary,
    ok: result.ok,
    created: result.created,
    contact: result.contact,
    deal: result.deal,
    due: result.due,
    error: result.error,
  };
}

module.exports = {
  ACTIONS,
  resolveAction,
  runAction,
};
