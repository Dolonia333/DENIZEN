'use strict';

const bridge = require('./bridge-client');
const { fmtRows } = bridge;
const orgPolicy = require('../../src/denizen-org-policy');
const federalPipeline = require('../../src/federal-pipeline');
const crmMutations = require('../../src/denizen-crm-mutations');

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
      return crmUpdateDeal(config, params);
    case 'crm-setup-status':
      return crmSetupStatus(config, params);
    case 'crm-list-industries':
      return crmListIndustries(config, params);
    case 'crm-apply-industry':
      return crmApplyIndustry(config, params, npcName);
    case 'crm-add-task':
      return crmAddTask(config, params);
    case 'crm-list-tasks':
      return crmListTasks(config, params);
    case 'crm-at-risk':
      return crmAtRisk(config, params);
    case 'crm-add-ticket':
      return crmAddTicket(config, params, npcName);
    case 'crm-list-tickets':
      return crmListTickets(config, params);
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
  return {
    summary: `${leads.length} lead(s) fetched (${open.length} open). ${fmtRows(open, 6)}`,
    leads,
  };
}

async function rfpStatus(config, params) {
  const filters = {};
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
    const detail = await federalPipeline.getRfpDetail(pipelineDb, rfp.id).catch(() => null);
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

  const outcomes = await bridge.bridgeQuery(config, {
    table: 'denizen_outcomes',
    select: ['outcome_type', 'entity_type', 'entity_id', 'entity_key', 'value_text', 'observed_at'],
    filters: {},
    order: { observed_at: 'desc' },
    limit: Number(params.limit) || 20,
  });

  const recent = outcomes.filter((o) => !since || o.observed_at >= since);
  const byType = {};
  for (const o of recent) {
    byType[o.outcome_type] = (byType[o.outcome_type] || 0) + 1;
  }

  return {
    summary: `Last ${hours}h: ${recent.length} outcomes. Breakdown: ${JSON.stringify(byType)}. ${fmtRows(recent, 5)}`,
    outcomes: recent,
    breakdown: byType,
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
  const detail = await federalPipeline.getRfpDetail(createPipelineBridgeDb(config), params.rfp_id);
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
  const summary = await federalPipeline.getRfpPipelineSummary(createPipelineBridgeDb(config));
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

async function crmUpdateDeal(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  const result = await crmMutations.updateDeal(orgId, params);
  if (/closed won/i.test(String(result.deal?.stage || ''))) {
    result.note = 'Deal marked won — team office may show a CRM notification.';
  }
  return result;
}

async function crmSetupStatus(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
  return crmMutations.getSetupStatus(orgId, params);
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

async function crmAddTask(config, params) {
  const orgId = await defaultOrgId(config);
  if (!orgId) return { summary: 'CRM workspace unavailable — organization not resolved.' };
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

module.exports = {
  ACTIONS,
  resolveAction,
  runAction,
};
