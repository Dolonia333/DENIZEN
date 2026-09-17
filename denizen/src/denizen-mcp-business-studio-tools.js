'use strict';

/**
 * Business Studio MCP tools — founder OS working set + mutations.
 */

const studioStore = require('./denizen-business-studio-store');
const progress = require('./denizen-business-studio-progress');
const e3 = require('./denizen-business-studio-e3-template');
const funding = require('./denizen-business-studio-funding');
const chain = require('./denizen-business-studio-chain');
const founderPack = require('./denizen-business-studio-founder-pack');
const paveMod = require('./denizen-business-studio-pave');
const sections = require('./denizen-business-studio-sections');
const denizenDb = require('./denizen-db');

const BUSINESS_STUDIO_TOOL_DEFINITIONS = [
  {
    name: 'business_studio_catalog',
    description:
      'READ-ONLY catalog of every Business Studio app (Funding Readiness, Lean Canvas, PAVE, Moat, Capital Pathway, '
      + 'Data Room, Discovery Lab, Phase 2 stubs, CRM/Calendar links). Call when the founder asks what an app is, '
      + 'what it is for, or which tool to use. Pass include_phase2=false to hide coming-soon apps.',
    inputSchema: {
      type: 'object',
      properties: {
        include_phase2: { type: 'boolean', description: 'Default true' },
      },
    },
  },
  {
    name: 'business_studio_section',
    description:
      'READ-ONLY: open one Business Studio section by id or label (e.g. leancanvas, "PAVE Workbook", moat). '
      + 'Returns what/used_for, capability, tools, and a live snapshot so ChatGPT can help based on where the founder is. '
      + 'Phase 2 sections return coming_soon guidance instead of fake data.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Section id or label from the Business Studio menu / More sheet' },
        view: { type: 'string', description: 'Alias for section (UI ?view=)' },
      },
      required: ['section'],
    },
  },
  {
    name: 'business_studio_working_set',
    description:
      'READ-ONLY compact Business Studio working set for the current objective — not a dump of the company database. '
      + 'Returns current objective, E3 discovery X/Y qualifying interviews, primary assumption status, '
      + 'funding readiness customer_discovery, blocking milestone, and recommended next action with WHY. Call first. '
      + 'Optional section/view adds section-aware help for the app the founder has open.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string' },
        section: { type: 'string' },
        view: { type: 'string' },
      },
    },
  },
  {
    name: 'business_studio_brief',
    description:
      'Short founder brief derived from qualifying evidence: working-set objective summary + top next actions with WHY.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_explain',
    description: 'Explain a status (program or category:<id>). Returns rule, evidence, missing, recommended action.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'program | category:customer_discovery | experiment:<id>' },
      },
      required: ['subject'],
    },
  },
  {
    name: 'business_studio_list_programs',
    description: 'List Business Studio programs and templates available.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_apply_program_template',
    description: 'Apply a program template (e.g. i2e-e3-pave) into the workspace. Founder-controlled.',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        business_name: { type: 'string' },
        founder_name: { type: 'string' },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'business_studio_apply_founder_pack',
    description:
      'Fill the org Business Studio with Dolonia / DENIZEN living materials: business profile, '
      + 'E3 PAVE (Dana customer), Lean Canvas (campus mesh / strategic brief), moat, mentor advisor, '
      + 'and document evidence. Use when the founder asks to update their account from E3 docs. '
      + 'Requires crm_write. Does not invent interview outcomes.',
    inputSchema: {
      type: 'object',
      properties: {
        business_name: { type: 'string' },
        founder_name: { type: 'string' },
        fill_lean_canvas: { type: 'boolean', description: 'Default true' },
        fill_pave: { type: 'boolean', description: 'Default true' },
        fill_moat: { type: 'boolean', description: 'Default true' },
        fill_evidence: { type: 'boolean', description: 'Default true' },
      },
    },
  },
  {
    name: 'business_studio_add_evidence',
    description:
      'Attach real evidence (interview, document, meeting, metric, manual). Never fabricate. '
      + 'Interviews auto-link discovery experiment + requirement + Funding Readiness customer_discovery when an E3 program is active. '
      + 'Optional contact_id stores a CRM relation without inventing CRM data.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        experiment_id: { type: 'string' },
        requirement_key: { type: 'string' },
        assumption_key: { type: 'string' },
        funding_key: { type: 'string' },
        funding_keys: { type: 'array', items: { type: 'string' } },
        contact_id: { type: 'string' },
        contact_name: { type: 'string' },
        persona: { type: 'string' },
        insight_tags: { type: 'array', items: { type: 'string' } },
        stance: {
          type: 'string',
          description: 'supports | contradicts | neutral relative to linked assumption — never auto-validates',
        },
      },
      required: ['title', 'type'],
    },
  },
  {
    name: 'business_studio_revoke_evidence',
    description:
      'Revoke (soft-delete) evidence. Downstream experiment/requirement/milestone/goal/funding counts recalculate from remaining qualifying evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        evidence_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['evidence_id'],
    },
  },
  {
    name: 'business_studio_chain_status',
    description:
      'READ-ONLY end-to-end chain + compact working_set: discovery counts, program %, milestone/goal, '
      + 'Funding Readiness customer_discovery, assumption stance, and recommended next action. '
      + 'Use after attaching evidence to explain what changed. Counts come only from qualifying evidence.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_task',
    description: 'Create or update a Business Studio task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string' },
        due: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'business_studio_upsert_goal',
    description: 'Create or update a goal.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'business_studio_create_experiment',
    description: 'Create an experiment linked to an assumption. Does not auto-validate assumptions.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assumption_key: { type: 'string' },
        target_count: { type: 'number' },
        method: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'business_studio_funding_readiness',
    description:
      'READ-ONLY Funding Readiness checklist with evidence counts (complete / need work / not started), '
      + 'plus market sizing, moat, discovery patterns, data room, and capital pathway briefs. '
      + 'Never invent a mysterious readiness percentage.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_get_lean_canvas',
    description: 'READ-ONLY Lean Canvas nine boxes + filled count. Does not invent box text.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_lean_canvas',
    description:
      'Update Lean Canvas fields (partial merge). Pass any of the nine boxes as strings. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string' },
        customerSegments: { type: 'string' },
        uniqueValueProposition: { type: 'string' },
        solution: { type: 'string' },
        channels: { type: 'string' },
        revenueStreams: { type: 'string' },
        costStructure: { type: 'string' },
        keyMetrics: { type: 'string' },
        unfairAdvantage: { type: 'string' },
        canvas: { type: 'object', description: 'Optional full/partial canvas object' },
      },
    },
  },
  {
    name: 'business_studio_get_pave',
    description:
      'READ-ONLY PAVE workbook for the active (or named) program — sections, filled counts, sales-cycle diagram summary.',
    inputSchema: {
      type: 'object',
      properties: {
        program_id: { type: 'string' },
      },
    },
  },
  {
    name: 'business_studio_upsert_pave',
    description:
      'Patch PAVE fields via dotted paths (e.g. partA.customer, snapshot.company) or a nested fields object. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        program_id: { type: 'string' },
        fields: { type: 'object', description: 'Map of dotted.path → string value' },
        pave: { type: 'object', description: 'Partial pave object to deep-merge' },
      },
    },
  },
  {
    name: 'business_studio_list_evidence',
    description: 'READ-ONLY evidence ledger (id, title, type, links). Soft-revoked items excluded by default.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        include_revoked: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'business_studio_list_tasks',
    description: 'READ-ONLY Business Studio tasks (Founder OS — not Studio Board delivery).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'business_studio_list_goals',
    description: 'READ-ONLY goals list.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
    },
  },
  {
    name: 'business_studio_list_experiments',
    description: 'READ-ONLY experiments list with target/completed counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_get_moat',
    description: 'READ-ONLY Moat Builder evaluation (sources, primary claim, defensibility note).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_moat',
    description: 'Update moat primaryClaim and/or sources map. Requires crm_write. Does not invent evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        primaryClaim: { type: 'string' },
        sources: { type: 'object' },
        moat: { type: 'object' },
      },
    },
  },
  {
    name: 'business_studio_get_market_sizing',
    description: 'READ-ONLY market sizing inputs + calculated brief.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_market_sizing',
    description: 'Update market sizing inputs (TAM/SAM/SOM fields). Recalculates. Requires crm_write. Never invent numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        marketSizing: { type: 'object' },
      },
    },
  },
  {
    name: 'business_studio_capital_pathway',
    description: 'READ-ONLY capital pathway brief: plan, suggested types, gaps from readiness + unanswered investor Qs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_capital_plan',
    description: 'Update capitalPlan (stage, raise target, use of funds notes). Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        capitalPlan: { type: 'object' },
        stage: { type: 'string' },
        raise_target: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'business_studio_data_room',
    description: 'READ-ONLY Data Room readiness mirrored from Funding Readiness + investor share flags.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_set_data_room_share',
    description: 'Set sharedWithInvestors flags for funding keys in the Data Room. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        shared: { type: 'object', description: 'Map of funding_key → boolean' },
      },
      required: ['shared'],
    },
  },
  {
    name: 'business_studio_discovery_lab',
    description: 'READ-ONLY Discovery Lab: interview patterns, personas, hypothesis support, buyer signals.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_discovery_lab',
    description: 'Update discoveryLab personas and/or hypotheses arrays. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        personas: { type: 'array' },
        hypotheses: { type: 'array' },
        discoveryLab: { type: 'object' },
      },
    },
  },
  {
    name: 'business_studio_investor_stress',
    description: 'READ-ONLY Investor Stress-Test questions (answered + unanswered).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_answer_investor_question',
    description: 'Mark or add an investor stress-test answer. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'string' },
        question: { type: 'string' },
        answer: { type: 'string' },
        answered: { type: 'boolean' },
      },
    },
  },
  {
    name: 'business_studio_get_strategy',
    description: 'READ-ONLY strategy map nodes + edges.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_get_roadmap',
    description: 'READ-ONLY roadmap stages / milestones + program progress summary.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_list_advisors',
    description: 'READ-ONLY Business Studio mentors/advisors + open recommendations (not NPC mentor_* tools).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_get_settings',
    description: 'READ-ONLY business profile + config for Settings.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'business_studio_upsert_settings',
    description: 'Update business name / founder name (Settings). Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        business_name: { type: 'string' },
        founder_name: { type: 'string' },
      },
    },
  },
];

function hasBusinessStudioAccess(npcKey) {
  const key = String(npcKey || '').toLowerCase();
  if (!key || key === '_team') return true;
  const allowed = new Set([
    'abby', 'lucy', 'marcus', 'sarah', 'jenny', 'rob', 'josh', 'molly', 'dan',
    'edward', 'oscar', 'pier', 'roki', 'bob', 'alex', 'grok',
  ]);
  return allowed.has(key);
}

function toolsForNpc(npcKey) {
  if (!hasBusinessStudioAccess(npcKey)) return [];
  return [...BUSINESS_STUDIO_TOOL_DEFINITIONS];
}

function isBusinessStudioTool(name) {
  return BUSINESS_STUDIO_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function resolveOrgId(scope) {
  return scope?.orgId || scope?.org_id || denizenDb.orgId || null;
}

async function loadState(scope) {
  const orgId = resolveOrgId(scope);
  if (!orgId) {
    return { orgId: null, state: null, error: 'org_id unavailable' };
  }
  if (!denizenDb.enabled) {
    return { orgId, state: studioStore.emptyState(), local: true };
  }
  const row = await studioStore.getWorkspace(orgId);
  return { orgId, state: row?.state || studioStore.emptyState(), local: false, updated_at: row?.updated_at };
}

async function saveState(scope, state) {
  const orgId = resolveOrgId(scope);
  if (!orgId || !denizenDb.enabled) {
    return { ok: false, error: 'Database not configured — persist via Business Studio UI local mode' };
  }
  const saved = await studioStore.upsertWorkspace(orgId, state, scope?.identity_id || scope?.identityId || null);
  return { ok: true, updated_at: saved?.updated_at };
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function ensureFunding(state) {
  state.funding = {
    ...funding.emptyFundingState(),
    ...(state.funding || {}),
  };
  return state.funding;
}

function activeProgram(state, programId) {
  const programs = state.programs || [];
  if (programId) {
    return programs.find((p) => p.id === programId) || null;
  }
  return programs.find((p) => p.status === 'active') || programs[0] || null;
}

function sectionSnapshot(state, sectionId) {
  const meta = sections.getSectionMeta(sectionId);
  if (!meta) return null;
  const id = meta.id;
  const fund = state.funding || funding.emptyFundingState();
  const brief = chain.workingSetBrief(state);

  if (meta.capability === 'coming_soon') {
    return {
      status: 'coming_soon',
      message: `${meta.label} is Phase 2 — not shipped yet.`,
      fallback_tools: meta.read_tools,
      tip: meta.used_for,
    };
  }
  if (meta.capability === 'link') {
    return {
      status: 'link',
      link_url: meta.link_url,
      use_tools: [...meta.read_tools, ...meta.write_tools],
      tip: meta.used_for,
    };
  }

  switch (id) {
    case 'overview':
      return { status: 'live', working_set: brief };
    case 'funding':
      return {
        status: 'live',
        readiness: funding.evaluateFundingReadiness(state),
        tip: 'Attach evidence with business_studio_add_evidence — do not invent checklist ticks.',
      };
    case 'leancanvas': {
      const canvas = funding.sanitizeLeanCanvas(fund.leanCanvas);
      return {
        status: 'live',
        leanCanvas: canvas,
        filled: funding.leanCanvasFilledCount(canvas),
        substantial: funding.leanCanvasIsSubstantial(canvas),
      };
    }
    case 'pave': {
      const program = activeProgram(state);
      const pave = paveMod.sanitizePave(program?.pave || paveMod.emptyPave());
      return {
        status: 'live',
        program_id: program?.id || null,
        program_name: program?.name || null,
        filled: paveMod.paveFilledCount(pave),
        sections: (paveMod.PAVE_SECTIONS || []).map((s) => ({
          id: s.id,
          title: s.title,
          progress: paveMod.paveSectionProgress(pave, s.id),
        })),
        pave,
      };
    }
    case 'strategy':
      return {
        status: 'live',
        nodes: state.strategyNodes || [],
        edges: state.strategyEdges || [],
        node_count: (state.strategyNodes || []).length,
      };
    case 'roadmap':
      return {
        status: 'live',
        milestones: state.milestones || [],
        working_set: {
          program_percent: brief.program_percent,
          blocking_milestone: brief.blocking_milestone,
          recommended_next_action: brief.recommended_next_action,
        },
      };
    case 'goals':
      return { status: 'live', goals: state.goals || [], current_objective: brief.current_objective };
    case 'tasks':
      return { status: 'live', tasks: state.tasks || [], note: 'Task completion ≠ funding progress.' };
    case 'evidence':
      return {
        status: 'live',
        evidence: (state.evidence || []).filter((e) => !e.revokedAt && !e.revoked),
        count: (state.evidence || []).filter((e) => !e.revokedAt && !e.revoked).length,
      };
    case 'experiments':
      return { status: 'live', experiments: state.experiments || [] };
    case 'discovery':
      return { status: 'live', discovery: funding.discoveryPatterns(state), lab: fund.discoveryLab || {} };
    case 'programs':
      return {
        status: 'live',
        programs: state.programs || [],
        templates: e3.listProgramTemplates(),
      };
    case 'market':
      return {
        status: 'live',
        marketSizing: funding.calculateMarketSizing(fund.marketSizing || {}),
        inputs: fund.marketSizing || {},
      };
    case 'moat':
      return { status: 'live', moat: funding.evaluateMoat(state), raw: fund.moat || {} };
    case 'capital':
      return { status: 'live', capital: funding.capitalPathwayBrief(state) };
    case 'dataroom':
      return { status: 'live', dataRoom: funding.evaluateDataRoom(state) };
    case 'investorsim':
      return {
        status: 'live',
        questions: fund.unansweredInvestorQuestions || [],
        unanswered: (fund.unansweredInvestorQuestions || []).filter((q) => !q.answered),
      };
    case 'mentors':
      return {
        status: 'live',
        advisors: state.advisors || [],
        recommendations: (state.recommendations || []).filter((r) => r.status !== 'resolved').slice(0, 20),
      };
    case 'metrics':
      return { status: 'live', metrics: state.metrics || [], metricValues: state.metricValues || [] };
    case 'settings':
      return {
        status: 'live',
        business: state.business,
        config: state.config || {},
      };
    default:
      return { status: 'unknown' };
  }
}

async function callTool(scope, name, args = {}) {
  const key = scope?.npc_key;
  if (!hasBusinessStudioAccess(key) && scope?.scope_mode !== 'team') {
    return { ok: false, error: `Business Studio tools not available for ${key}` };
  }

  if (name === 'business_studio_catalog') {
    return sections.catalogForAgent({
      includePhase2: args.include_phase2 !== false && args.includePhase2 !== false,
    });
  }

  if (name === 'business_studio_section') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const raw = args.section || args.view || args.focus;
    const meta = sections.getSectionMeta(raw);
    if (!meta) {
      return {
        ok: false,
        error: `Unknown Business Studio section: ${raw}`,
        hint: 'Call business_studio_catalog for valid ids (funding, leancanvas, pave, moat, …).',
      };
    }
    return {
      ok: true,
      section: {
        id: meta.id,
        label: meta.label,
        group: meta.group,
        phase2: !!meta.phase2,
        what: meta.what,
        used_for: meta.used_for,
        capability: meta.capability,
        read_tools: meta.read_tools,
        write_tools: meta.write_tools,
        note: meta.note || null,
        link_url: meta.link_url || null,
      },
      snapshot: sectionSnapshot(loaded.state, meta.id),
      how_to_help:
        meta.capability === 'coming_soon'
          ? `Tell the founder ${meta.label} is Phase 2. Offer fallbacks: ${(meta.read_tools || []).join(', ')}.`
          : `You are helping inside ${meta.label}. ${meta.used_for} Start with: ${(meta.read_tools || []).slice(0, 3).join(', ')}.`,
    };
  }

  if (name === 'business_studio_working_set') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state, local } = loaded;
    const brief = chain.workingSetBrief(state);
    const sectionRaw = args.section || args.view || args.focus;
    const meta = sectionRaw ? sections.getSectionMeta(sectionRaw) : null;
    return {
      ok: true,
      local,
      business: state.business
        ? { id: state.business.id, name: state.business.name, founderName: state.business.founderName }
        : null,
      ...brief,
      section: meta
        ? {
          id: meta.id,
          label: meta.label,
          what: meta.what,
          used_for: meta.used_for,
          capability: meta.capability,
          read_tools: meta.read_tools,
          write_tools: meta.write_tools,
          snapshot: sectionSnapshot(state, meta.id),
        }
        : null,
      guidance:
        'Minimum authoritative context for the current objective. '
        + 'Do not invent metrics. Drill into evidence_ids only when needed. '
        + 'Empty workspace is OK. '
        + (meta ? `Founder focus: ${meta.label}.` : 'Pass section= to attach app-aware help.'),
    };
  }

  if (name === 'business_studio_brief') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const brief = chain.workingSetBrief(loaded.state);
    return {
      ok: true,
      ...brief,
      next_actions: [{
        action: brief.recommended_next_action,
        why: brief.reason,
      }],
      guidance: 'Task completion ≠ progress. Qualifying evidence meeting a requirement = progress.',
    };
  }

  if (name === 'business_studio_explain') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return { ok: true, explanation: progress.explainStatus(loaded.state, args.subject || 'program') };
  }

  if (name === 'business_studio_list_programs') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      programs: loaded.state.programs || [],
      templates: e3.listProgramTemplates(),
    };
  }

  if (name === 'business_studio_apply_program_template') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state, orgId } = loaded;
    const bundle = e3.applyProgramTemplate(args.template_id || args.templateId, {
      businessName: args.business_name || args.businessName,
      founderName: args.founder_name || args.founderName,
    });
    state.business = state.business || {
      id: uid('biz'),
      name: args.business_name || 'My Business',
      founderName: args.founder_name || 'Founder',
    };
    state.programs = [...(state.programs || []).filter((p) => p.templateId !== bundle.templateId), bundle.program];
    state.milestones = [...(state.milestones || []), ...bundle.milestones];
    state.tasks = [...(state.tasks || []), ...bundle.tasks];
    state.assumptions = [...(state.assumptions || []), ...bundle.assumptions];
    state.experiments = [...(state.experiments || []), ...bundle.experiments];
    state.goals = [...(state.goals || []), ...bundle.goals];
    state.metrics = [...(state.metrics || []), ...bundle.metrics];
    if (!(state.strategyNodes || []).length) {
      state.strategyNodes = bundle.strategyNodes;
      state.strategyEdges = bundle.strategyEdges;
    }
    const saved = await saveState(scope, state);
    return { ok: true, template: bundle.templateName, program_id: bundle.program.id, persist: saved, orgId };
  }

  if (name === 'business_studio_apply_founder_pack') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    let result;
    try {
      result = founderPack.applyFounderPack(state, {
        businessName: args.business_name || args.businessName,
        founderName: args.founder_name || args.founderName,
        fillLeanCanvas: args.fill_lean_canvas !== false && args.fillLeanCanvas !== false,
        fillPave: args.fill_pave !== false && args.fillPave !== false,
        fillMoat: args.fill_moat !== false && args.fillMoat !== false,
        fillEvidence: args.fill_evidence !== false && args.fillEvidence !== false,
      });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    const saved = await saveState(scope, result.state);
    return {
      ok: true,
      business: result.business,
      program_id: result.programId,
      lean_canvas_boxes: result.leanFilled,
      pave_fields: result.paveFilled,
      persist: saved,
      guidance:
        'Lean Canvas = campus mesh / education strategic brief. '
        + 'PAVE = Dana founder-operator for DENIZEN. Do not mix personas when summarizing.',
    };
  }

  if (name === 'business_studio_add_evidence') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    let result;
    try {
      result = chain.attachEvidence(state, {
        title: args.title,
        type: args.type,
        description: args.description,
        notes: args.description || args.notes,
        experimentId: args.experiment_id || args.experimentId,
        requirementKey: args.requirement_key || args.requirementKey,
        assumptionKey: args.assumption_key || args.assumptionKey,
        fundingKey: args.funding_key || args.fundingKey,
        fundingKeys: args.funding_keys || args.fundingKeys,
        contactId: args.contact_id || args.contactId,
        contactName: args.contact_name || args.contactName,
        persona: args.persona,
        insightTags: args.insight_tags || args.insightTags,
        stance: args.stance || args.hypothesis_stance,
        source: 'mcp',
      });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    const saved = await saveState(scope, state);
    return {
      ok: true,
      evidence: result.evidence,
      links: result.links,
      duplicate: !!result.duplicate,
      working_set: result.chain?.workingSet || chain.workingSetBrief(state),
      chain: result.chain,
      persist: saved,
    };
  }

  if (name === 'business_studio_revoke_evidence') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const result = chain.revokeAndResync(state, args.evidence_id || args.evidenceId, {
      reason: args.reason,
    });
    if (!result.ok) return result;
    const saved = await saveState(scope, state);
    return {
      ok: true,
      evidence: result.evidence,
      working_set: result.chain?.workingSet || chain.workingSetBrief(state),
      chain: result.chain,
      persist: saved,
    };
  }

  if (name === 'business_studio_chain_status') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const snap = chain.chainSnapshot(loaded.state);
    return {
      ok: true,
      working_set: snap.workingSet,
      chain: snap,
      guidance:
        'Counts come only from qualifying evidence. '
        + 'Program completion ≠ assumption validation. Do not invent counts.',
    };
  }

  if (name === 'business_studio_upsert_task') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    let task = (state.tasks || []).find((t) => t.id === args.id);
    if (task) {
      Object.assign(task, {
        title: args.title ?? task.title,
        status: args.status ?? task.status,
        priority: args.priority ?? task.priority,
        due: args.due ?? task.due,
        owner: args.owner ?? task.owner,
      });
    } else {
      task = {
        id: uid('task'),
        title: args.title,
        status: args.status || 'todo',
        priority: args.priority || 'medium',
        due: args.due || null,
        owner: args.owner || null,
        createdAt: new Date().toISOString(),
        source: 'mcp',
      };
      state.tasks = [task, ...(state.tasks || [])];
    }
    const saved = await saveState(scope, state);
    return { ok: true, task, persist: saved };
  }

  if (name === 'business_studio_upsert_goal') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    let goal = (state.goals || []).find((g) => g.id === args.id);
    if (goal) {
      Object.assign(goal, { title: args.title ?? goal.title, status: args.status ?? goal.status });
    } else {
      goal = {
        id: uid('goal'),
        title: args.title,
        status: args.status || 'active',
        createdAt: new Date().toISOString(),
      };
      state.goals = [goal, ...(state.goals || [])];
    }
    const saved = await saveState(scope, state);
    return { ok: true, goal, persist: saved };
  }

  if (name === 'business_studio_create_experiment') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const exp = {
      id: uid('exp'),
      title: args.title,
      assumptionKey: args.assumption_key || null,
      status: 'active',
      targetCount: Number(args.target_count) || 10,
      completedCount: 0,
      method: args.method || 'customer_interview',
      createdAt: new Date().toISOString(),
    };
    state.experiments = [exp, ...(state.experiments || [])];
    const saved = await saveState(scope, state);
    return { ok: true, experiment: exp, persist: saved, note: 'Assumptions are never auto-validated from task completion.' };
  }

  if (name === 'business_studio_funding_readiness') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    return {
      ok: true,
      readiness: funding.evaluateFundingReadiness(state),
      marketSizing: funding.calculateMarketSizing(state.funding?.marketSizing || {}),
      moat: funding.evaluateMoat(state),
      discovery: funding.discoveryPatterns(state),
      dataRoom: funding.evaluateDataRoom(state),
      capital: funding.capitalPathwayBrief(state),
      capitalPlan: state.funding?.capitalPlan || funding.emptyFundingState().capitalPlan,
      leanCanvas: {
        filled: funding.leanCanvasFilledCount(state.funding?.leanCanvas),
        substantial: funding.leanCanvasIsSubstantial(state.funding?.leanCanvas),
      },
      guidance: 'Never invent a funding-ready percentage. Use complete / need work / not started counts.',
    };
  }

  if (name === 'business_studio_get_lean_canvas') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const canvas = funding.sanitizeLeanCanvas(loaded.state.funding?.leanCanvas);
    return {
      ok: true,
      leanCanvas: canvas,
      fields: funding.LEAN_CANVAS_FIELDS,
      filled: funding.leanCanvasFilledCount(canvas),
      substantial: funding.leanCanvasIsSubstantial(canvas),
      plain_text: funding.leanCanvasPlainText(canvas),
    };
  }

  if (name === 'business_studio_upsert_lean_canvas') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    const allowed = new Set(funding.LEAN_CANVAS_FIELDS.map((f) => f.key));
    const patch = { ...(args.canvas && typeof args.canvas === 'object' ? args.canvas : {}) };
    for (const [k, v] of Object.entries(args)) {
      if (allowed.has(k) && typeof v === 'string') patch[k] = v;
    }
    fund.leanCanvas = funding.sanitizeLeanCanvas({
      ...fund.leanCanvas,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const saved = await saveState(scope, state);
    return {
      ok: true,
      leanCanvas: fund.leanCanvas,
      filled: funding.leanCanvasFilledCount(fund.leanCanvas),
      persist: saved,
    };
  }

  if (name === 'business_studio_get_pave') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const program = activeProgram(loaded.state, args.program_id || args.programId);
    if (!program) {
      return {
        ok: true,
        program: null,
        pave: paveMod.emptyPave(),
        guidance: 'No program yet — apply business_studio_apply_program_template (i2e-e3-pave) or founder pack.',
      };
    }
    const pave = paveMod.sanitizePave(program.pave || paveMod.emptyPave());
    return {
      ok: true,
      program_id: program.id,
      program_name: program.name || program.templateId,
      pave,
      filled: paveMod.paveFilledCount(pave),
      section_progress: (paveMod.PAVE_SECTIONS || []).map((s) => ({
        id: s.id,
        title: s.title,
        progress: paveMod.paveSectionProgress(pave, s.id),
      })),
    };
  }

  if (name === 'business_studio_upsert_pave') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    let program = activeProgram(state, args.program_id || args.programId);
    if (!program) {
      return { ok: false, error: 'No Business Studio program to update — apply a template first' };
    }
    program = paveMod.ensureProgramPave(program);
    let pave = paveMod.sanitizePave(program.pave);
    if (args.pave && typeof args.pave === 'object') {
      pave = paveMod.sanitizePave({ ...pave, ...args.pave });
    }
    const fields = args.fields && typeof args.fields === 'object' ? args.fields : {};
    for (const [path, value] of Object.entries(fields)) {
      paveMod.setNested(pave, path, value);
    }
    program.pave = paveMod.sanitizePave(pave);
    const idx = (state.programs || []).findIndex((p) => p.id === program.id);
    if (idx >= 0) state.programs[idx] = program;
    const saved = await saveState(scope, state);
    return {
      ok: true,
      program_id: program.id,
      pave: program.pave,
      filled: paveMod.paveFilledCount(program.pave),
      persist: saved,
    };
  }

  if (name === 'business_studio_list_evidence') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    let list = loaded.state.evidence || [];
    if (!args.include_revoked && !args.includeRevoked) {
      list = list.filter((e) => !e.revokedAt && !e.revoked);
    }
    if (args.type) list = list.filter((e) => e.type === args.type);
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
    return {
      ok: true,
      evidence: list.slice(0, limit).map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        fundingKeys: e.fundingKeys || (e.fundingKey ? [e.fundingKey] : []),
        experimentId: e.experimentId || null,
        createdAt: e.createdAt || e.recorded_at || null,
      })),
      total: list.length,
    };
  }

  if (name === 'business_studio_list_tasks') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    let list = loaded.state.tasks || [];
    if (args.status) list = list.filter((t) => t.status === args.status);
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
    return { ok: true, tasks: list.slice(0, limit), total: list.length, note: 'Task completion ≠ funding progress.' };
  }

  if (name === 'business_studio_list_goals') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    let list = loaded.state.goals || [];
    if (args.status) list = list.filter((g) => g.status === args.status);
    return { ok: true, goals: list };
  }

  if (name === 'business_studio_list_experiments') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return { ok: true, experiments: loaded.state.experiments || [] };
  }

  if (name === 'business_studio_get_moat') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      moat: funding.evaluateMoat(loaded.state),
      raw: loaded.state.funding?.moat || funding.emptyFundingState().moat,
      sources_catalog: funding.MOAT_SOURCES,
    };
  }

  if (name === 'business_studio_upsert_moat') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    const patch = args.moat && typeof args.moat === 'object' ? args.moat : {};
    fund.moat = {
      ...fund.moat,
      ...patch,
      primaryClaim: args.primaryClaim ?? patch.primaryClaim ?? fund.moat.primaryClaim,
      sources: {
        ...(fund.moat.sources || {}),
        ...(patch.sources || {}),
        ...(args.sources || {}),
      },
    };
    const saved = await saveState(scope, state);
    return { ok: true, moat: funding.evaluateMoat(state), persist: saved };
  }

  if (name === 'business_studio_get_market_sizing') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const inputs = loaded.state.funding?.marketSizing || {};
    return {
      ok: true,
      inputs,
      marketSizing: funding.calculateMarketSizing(inputs),
      guidance: 'Never invent TAM/SAM/SOM — only update numbers the founder provides.',
    };
  }

  if (name === 'business_studio_upsert_market_sizing') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    const patch = args.marketSizing || args.market_sizing || args;
    const next = { ...fund.marketSizing, ...patch };
    delete next.marketSizing;
    delete next.market_sizing;
    fund.marketSizing = {
      ...next,
      calculated: funding.calculateMarketSizing(next),
    };
    const saved = await saveState(scope, state);
    return { ok: true, marketSizing: fund.marketSizing, persist: saved };
  }

  if (name === 'business_studio_capital_pathway') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return { ok: true, capital: funding.capitalPathwayBrief(loaded.state) };
  }

  if (name === 'business_studio_upsert_capital_plan') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    const patch = args.capitalPlan || args.capital_plan || {};
    fund.capitalPlan = {
      ...fund.capitalPlan,
      ...patch,
      stage: args.stage ?? patch.stage ?? fund.capitalPlan.stage,
      raiseTarget: args.raise_target ?? args.raiseTarget ?? patch.raiseTarget ?? fund.capitalPlan.raiseTarget,
      notes: args.notes ?? patch.notes ?? fund.capitalPlan.notes,
    };
    const saved = await saveState(scope, state);
    return { ok: true, capital: funding.capitalPathwayBrief(state), persist: saved };
  }

  if (name === 'business_studio_data_room') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return { ok: true, dataRoom: funding.evaluateDataRoom(loaded.state) };
  }

  if (name === 'business_studio_set_data_room_share') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    fund.dataRoom = fund.dataRoom || { sharedWithInvestors: {} };
    fund.dataRoom.sharedWithInvestors = {
      ...(fund.dataRoom.sharedWithInvestors || {}),
      ...(args.shared || args.sharedWithInvestors || {}),
    };
    const saved = await saveState(scope, state);
    return { ok: true, dataRoom: funding.evaluateDataRoom(state), persist: saved };
  }

  if (name === 'business_studio_discovery_lab') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      discovery: funding.discoveryPatterns(loaded.state),
      lab: loaded.state.funding?.discoveryLab || {},
    };
  }

  if (name === 'business_studio_upsert_discovery_lab') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    const patch = args.discoveryLab || args.discovery_lab || {};
    fund.discoveryLab = {
      ...(fund.discoveryLab || {}),
      ...patch,
      personas: args.personas ?? patch.personas ?? fund.discoveryLab?.personas ?? [],
      hypotheses: args.hypotheses ?? patch.hypotheses ?? fund.discoveryLab?.hypotheses ?? [],
    };
    const saved = await saveState(scope, state);
    return { ok: true, lab: fund.discoveryLab, discovery: funding.discoveryPatterns(state), persist: saved };
  }

  if (name === 'business_studio_investor_stress') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const qs = loaded.state.funding?.unansweredInvestorQuestions || [];
    return {
      ok: true,
      questions: qs,
      unanswered: qs.filter((q) => !q.answered),
      answered: qs.filter((q) => q.answered),
    };
  }

  if (name === 'business_studio_answer_investor_question') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const fund = ensureFunding(state);
    fund.unansweredInvestorQuestions = fund.unansweredInvestorQuestions || [];
    const qid = args.question_id || args.questionId || args.id;
    let row = qid ? fund.unansweredInvestorQuestions.find((q) => q.id === qid) : null;
    if (!row && args.question) {
      row = fund.unansweredInvestorQuestions.find(
        (q) => String(q.question || '').toLowerCase() === String(args.question).toLowerCase(),
      );
    }
    if (!row) {
      row = {
        id: uid('iq'),
        question: args.question || 'Investor question',
        answered: false,
        answer: '',
        createdAt: new Date().toISOString(),
      };
      fund.unansweredInvestorQuestions.push(row);
    }
    if (args.answer != null) row.answer = String(args.answer);
    row.answered = args.answered !== false && !!(row.answer || args.answered);
    row.answeredAt = row.answered ? new Date().toISOString() : null;
    const saved = await saveState(scope, state);
    return { ok: true, question: row, capital: funding.capitalPathwayBrief(state), persist: saved };
  }

  if (name === 'business_studio_get_strategy') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      nodes: loaded.state.strategyNodes || [],
      edges: loaded.state.strategyEdges || [],
      guidance: 'Strategy map is seeded by apply_program_template when empty. Edit nodes in the UI.',
    };
  }

  if (name === 'business_studio_get_roadmap') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const brief = chain.workingSetBrief(loaded.state);
    return {
      ok: true,
      milestones: loaded.state.milestones || [],
      program_percent: brief.program_percent,
      blocking_milestone: brief.blocking_milestone,
      recommended_next_action: brief.recommended_next_action,
      reason: brief.reason,
    };
  }

  if (name === 'business_studio_list_advisors') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      advisors: loaded.state.advisors || [],
      recommendations: loaded.state.recommendations || [],
      note: 'Business Studio mentors ≠ NPC mentor_* mesh tools.',
    };
  }

  if (name === 'business_studio_get_settings') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      business: loaded.state.business,
      config: loaded.state.config || {},
    };
  }

  if (name === 'business_studio_upsert_settings') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    state.business = state.business || { id: uid('biz'), name: 'My Business', founderName: 'Founder' };
    if (args.business_name || args.businessName) {
      state.business.name = args.business_name || args.businessName;
    }
    if (args.founder_name || args.founderName) {
      state.business.founderName = args.founder_name || args.founderName;
    }
    const saved = await saveState(scope, state);
    return { ok: true, business: state.business, persist: saved };
  }

  return { ok: false, error: `Unknown Business Studio tool: ${name}` };
}

module.exports = {
  BUSINESS_STUDIO_TOOL_DEFINITIONS,
  hasBusinessStudioAccess,
  isBusinessStudioTool,
  toolsForNpc,
  callTool,
};
