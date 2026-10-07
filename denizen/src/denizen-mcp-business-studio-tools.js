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
      + 'Phase 2 sections are personal records on this studio. Do not invent figures.',
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
      'Seed empty Business Studio sections only. Does not replace a saved PAVE, moat, capital plan, '
      + 'lean canvas, goal, experiment, or evidence item. Does not restore a buyer persona, a price, '
      + 'or a compliance or margin claim. Requires crm_write.',
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
      'Attach real evidence (document, meeting, metric, manual). Never fabricate. '
      + 'A customer interview must use business_studio_link_validated_interview with qualifying true and a contact_id. '
      + 'An unvalidated conversation is not evidence and is not counted.',
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
    name: 'business_studio_link_validated_interview',
    description:
      'Record one qualifying customer interview and connect it: CRM contact, Business Studio evidence, '
      + 'experiment count, funding readiness, and the next Studio Board task. '
      + 'Requires qualifying true, title, and an existing contact_id. Does not scan Gmail and does not invent funding checkmarks.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        contact_id: { type: 'string' },
        contact_name: { type: 'string' },
        qualifying: { type: 'boolean', description: 'Must be true' },
        description: { type: 'string' },
        experiment_id: { type: 'string' },
      },
      required: ['title', 'contact_id', 'qualifying'],
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
      'Update Lean Canvas fields. Snake_case, labels, and {text,body} values are accepted. '
      + 'Unrecognized boxes are rejected and nothing is saved. Requires crm_write.',
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
      'Overwrite PAVE fields. Use snapshot, partA, partB, partC, partD, and final, or dotted paths such as partA.problem. '
      + 'A section may be a string or {text,body}. Unrecognized keys are rejected and nothing is saved. Requires crm_write.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        program_id: { type: 'string' },
        fields: { type: 'object', description: 'Dotted paths, labels, or nested sections. Supplied keys overwrite.' },
        pave: { type: 'object', description: 'Nested PAVE object. Supplied keys overwrite stored keys.' },
        snapshot: { type: 'object' },
        partA: { type: 'object' },
        partB: { type: 'object' },
        partC: { type: 'object' },
        partD: { type: 'object' },
        final: { type: 'object' },
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
    description:
      'Overwrite moat fields. Supplied primaryClaim, primaryWhy, and sources replace the stored values. '
      + 'A call that matches no field is rejected and does not save. Requires crm_write.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        primaryClaim: { type: 'string' },
        primary_claim: { type: 'string' },
        primaryWhy: { type: 'string' },
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
    description:
      'Overwrite capital plan fields. Supplied notes, stage, amount, uses, and types replace the stored values. '
      + 'A call that matches no field is rejected and does not save. Requires crm_write.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        capitalPlan: { type: 'object' },
        capital_plan: { type: 'object' },
        stage: { type: 'string' },
        notes: { type: 'string' },
        amount_needed: { type: 'number' },
        raise_target: { type: 'string' },
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
    description:
      'Overwrite the workspace company name and founder. company_name, company, legal_name, name, and business_name all set the header name. Requires crm_write.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        business_name: { type: 'string' },
        company_name: { type: 'string' },
        company: { type: 'string' },
        name: { type: 'string' },
        founder_name: { type: 'string' },
        business: { type: 'object', description: 'Partial business profile. name and founderName overwrite.' },
        config: { type: 'object', description: 'Partial settings config' },
      },
    },
  },
  {
    name: 'business_studio_get_workspace',
    description:
      'The signed-in person’s Business Studio only. A connector cannot open another account by passing account. '
      + 'Team and Molly connectors open Angela’s studio. Returns business, programs, goals, milestones, tasks, '
      + 'strategy, evidence, experiments, funding, advisors, metrics, and phase 2 records.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'angela (default for the team connector) or founder' },
      },
    },
  },
  {
    name: 'business_studio_patch',
    description:
      'Update any Business Studio lists or objects. Pass only the keys to change: business, programs, goals, '
      + 'milestones, tasks, strategyNodes, strategyEdges, assumptions, experiments, evidence, metrics, '
      + 'metricValues, advisors, recommendations, comments, meetings, funding, activity, notifications, config. '
      + 'Objects merge. Arrays replace. Requires crm_write.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: { type: 'object', description: 'Partial workspace. Keys match the studio state.' },
      },
      required: ['patch'],
    },
  },
  {
    name: 'business_studio_upsert_strategy',
    description: 'Replace or merge the strategy map. Pass nodes and edges arrays.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array' },
        edges: { type: 'array' },
      },
    },
  },
  {
    name: 'business_studio_upsert_milestone',
    description: 'Create or update a roadmap milestone by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        stage: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'business_studio_upsert_advisor',
    description: 'Create or update a Business Studio advisor/mentor by id or email.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string' },
        share: { type: 'object' },
      },
    },
  },
  {
    name: 'business_studio_upsert_section',
    description:
      'Create or update a personal Business Studio record in templates, financials, diagrams, documents, reports, '
      + 'experiments, programs, or links (crm, calendar). Stores only what you send. Does not invent revenue, '
      + 'contract values, or market totals. Requires crm_write.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        section: { type: 'string', description: 'templates, financials, diagrams, documents, reports, experiments, programs, crm, calendar' },
        title: { type: 'string' },
        body: { type: 'string' },
        notes: { type: 'string' },
        amount: { type: 'string', description: 'Only a figure the founder supplied' },
        account: { type: 'string' },
      },
      required: ['section'],
    },
  },
  {
    name: 'business_studio_upsert_metric',
    description: 'Create or update a founder metric by id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        value: {},
        unit: { type: 'string' },
        notes: { type: 'string' },
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

function isTeamConnector(scope) {
  return scope?.npc_key === 'molly' || scope?.npc_key === '_team' || scope?.scope_mode === 'team';
}

function studioKeyFromAccount(raw) {
  const explicit = String(raw || '').trim().toLowerCase();
  if (!explicit) return undefined;
  if (['founder', 'org', 'zion', 'operator'].includes(explicit)) return studioStore.operatorStudioKey();
  if (explicit === 'angela' || explicit === '1921' || explicit.includes('angela')) return 'angela';
  if (explicit.includes('@')) return studioStore.studioKeyForProfile({ email: explicit });
  const cleaned = explicit.replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
  return cleaned || null;
}

async function profileFromScope(scope) {
  const profile = {
    email: scope?.email || scope?.session_email || null,
    display_name: scope?.display_name || scope?.displayName || null,
    username: scope?.username || null,
    identityId: scope?.identity_id || scope?.identityId || null,
  };
  if (!profile.email && !profile.display_name && scope?.session_id && denizenDb.enabled) {
    try {
      const session = await require('./denizen-visitor').getSession(scope.session_id);
      profile.email = session?.email || session?.metadata?.email || null;
      profile.display_name = session?.display_name || session?.metadata?.display_name || null;
      profile.username = session?.username || session?.metadata?.username || null;
      profile.identityId = profile.identityId || session?.identity_id || null;
    } catch (_) { /* personal routing still falls through */ }
  }
  return profile;
}

async function resolveStudioKey(scope, args = {}) {
  if (isTeamConnector(scope)) return 'angela';
  const ownKey = studioStore.studioKeyForProfile(await profileFromScope(scope));
  const requested = studioKeyFromAccount(
    args.account || args.studio || args.owner || args.studio_account,
  );
  if (requested && ownKey && requested !== ownKey) return ownKey;
  return ownKey || null;
}

async function loadOrgState(scope) {
  const orgId = resolveOrgId(scope);
  if (!orgId) {
    return { orgId: null, state: null, error: 'org_id unavailable' };
  }
  if (!denizenDb.enabled) {
    return { orgId, state: studioStore.emptyState(), local: true };
  }
  const isolated = await studioStore.loadIsolatedWorkspace(orgId, scope?.identity_id || scope?.identityId || null);
  return { orgId, state: isolated.state, local: false, updated_at: isolated.updated_at };
}

async function saveOrgState(scope, state) {
  const orgId = resolveOrgId(scope);
  if (!orgId || !denizenDb.enabled) {
    return { ok: false, error: 'Database not configured — persist via Business Studio UI local mode' };
  }
  const saved = await studioStore.upsertWorkspace(orgId, state, scope?.identity_id || scope?.identityId || null);
  return { ok: true, updated_at: saved?.updated_at };
}

async function loadState(scope) {
  const loaded = await loadOrgState(scope);
  if (loaded.error || !loaded.state) return loaded;
  if (!scope?.studioKey) {
    return {
      ...loaded,
      state: studioStore.emptyState(),
      studioKey: null,
      adopted: false,
    };
  }
  const selected = studioStore.selectPersonalState(loaded.state, scope.studioKey);
  return {
    ...loaded,
    state: selected.state,
    studioKey: selected.studioKey,
    adopted: false,
  };
}

async function saveState(scope, state) {
  const key = scope?.studioKey || null;
  if (!key) return { ok: false, error: 'This studio is personal. No shared workspace was written.' };
  const loaded = await loadOrgState(scope);
  if (loaded.error) return { ok: false, error: loaded.error };
  const next = studioStore.writePrivateStudio(loaded.state, key, state);
  const saved = await saveOrgState(scope, next);
  return { ...saved, studio: key };
}

const STUDIO_PATCH_KEYS = [
  'business', 'programs', 'goals', 'milestones', 'projects', 'tasks',
  'strategyNodes', 'strategyEdges', 'assumptions', 'experiments', 'evidence',
  'findings', 'decisions', 'metrics', 'metricValues', 'advisors', 'comments',
  'meetings', 'recommendations', 'relations', 'documents', 'workbooks',
  'funding', 'activity', 'notifications', 'config',
];

function applyStudioPatch(state, patch = {}) {
  const next = studioStore.sanitizeState(state);
  for (const key of STUDIO_PATCH_KEYS) {
    if (patch[key] === undefined) continue;
    if (key === 'business' || key === 'funding' || key === 'config') {
      const incoming = patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])
        ? patch[key]
        : {};
      next[key] = { ...(next[key] || {}), ...incoming };
      continue;
    }
    next[key] = patch[key];
  }
  if (next.config && next.config.privateStudios) {
    const config = { ...next.config };
    delete config.privateStudios;
    next.config = config;
  }
  return next;
}

function applySectionWrite(state, args = {}) {
  const section = sections.normalizeSectionId(args.section || args.view || args.app);
  if (!section) {
    return { ok: false, error: 'section required', received_keys: Object.keys(args || {}) };
  }
  const source = args.record && typeof args.record === 'object' && !Array.isArray(args.record)
    ? args.record
    : args;
  const title = source.title || source.name || '';
  const body = source.body || source.notes || source.text || source.description || '';
  const id = source.id || source.record_id || null;
  if (!String(title).trim() && !String(body).trim() && source.amount == null && !Array.isArray(source.rows) && source.notes == null) {
    return {
      ok: false,
      error: 'no section fields applied',
      section,
      hint: 'Send title or body. Nothing was saved.',
    };
  }
  const next = studioStore.sanitizeState(state);
  next.phase2 = studioStore.sanitizePhase2(next.phase2);

  if (section === 'financials') {
    const financials = next.phase2.financials;
    if (source.notes != null || body) financials.notes = String(source.notes != null ? source.notes : body);
    if (Array.isArray(source.rows)) financials.rows = source.rows;
    else if (String(title).trim() || source.amount != null) {
      const row = {
        id: id || uid('fin'),
        title: String(title || 'Financial note'),
        ...(body ? { notes: String(body) } : {}),
        ...(source.amount != null && source.amount !== '' ? { amount: source.amount } : {}),
        ...(source.source ? { source: String(source.source) } : {}),
      };
      financials.rows = upsertById(financials.rows, row, (item) => String(item?.id) === String(row.id) || (
        title && String(item?.title || '').toLowerCase() === String(title).toLowerCase()
      ));
    }
    return { ok: true, section, phase2: next.phase2, state: next };
  }

  const listKey = {
    templates: ['phase2', 'templates'],
    diagrams: ['phase2', 'diagrams'],
    reports: ['phase2', 'reports'],
    documents: ['documents'],
    experiments: ['experiments'],
    programs: ['programs'],
    crm: ['relations'],
    calendar: ['relations'],
    links: ['relations'],
  }[section];
  if (!listKey) {
    return {
      ok: false,
      error: `section ${section} has its own writer`,
      hint: 'Use that section’s write tool from business_studio_section.',
    };
  }
  const row = {
    id: id || uid(section.slice(0, 3)),
    title: String(title || section),
    ...(body ? { body: String(body), notes: String(body) } : {}),
    ...(source.amount != null && source.amount !== '' ? { amount: source.amount } : {}),
    ...(source.url ? { url: String(source.url) } : {}),
    ...(section === 'crm' || section === 'calendar' || section === 'links' ? { kind: section } : {}),
  };
  if (listKey[0] === 'phase2') {
    next.phase2[listKey[1]] = upsertById(next.phase2[listKey[1]], row, (item) => String(item?.id) === String(row.id) || (
      title && String(item?.title || '').toLowerCase() === String(title).toLowerCase()
    ));
  } else {
    next[listKey[0]] = upsertById(next[listKey[0]], row, (item) => String(item?.id) === String(row.id) || (
      title && String(item?.title || '').toLowerCase() === String(title).toLowerCase()
    ));
  }
  return { ok: true, section, record: row, state: next };
}

function upsertById(list, row, match) {
  const items = Array.isArray(list) ? [...list] : [];
  const idx = items.findIndex(match);
  if (idx >= 0) items[idx] = { ...items[idx], ...row, id: items[idx].id };
  else items.push(row);
  return items;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const HOLDING_SERVICE_LINES = Object.freeze([
  'Government and institutional awards',
  'Consulting and capture',
  'Compliance and operations',
  'IT and cyber partner delivery',
  'Logistics',
  'DENIZEN commercialization',
]);

function asNodeList(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function strategyReplacement(args = {}) {
  const nested = args.strategy && typeof args.strategy === 'object' ? args.strategy : {};
  const map = args.map && typeof args.map === 'object' ? args.map : {};
  const nodes = asNodeList(args.nodes, args.strategy_nodes, args.strategyNodes, nested.nodes, map.nodes);
  const edges = asNodeList(args.edges, args.strategy_edges, args.strategyEdges, nested.edges, map.edges);
  const applied = [];
  if (nodes) applied.push('nodes');
  if (edges) applied.push('edges');
  return { nodes, edges, applied };
}

function milestoneList(args = {}) {
  const nested = args.roadmap && typeof args.roadmap === 'object' ? args.roadmap : {};
  return asNodeList(args.milestones, args.roadmap_milestones, nested.milestones);
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
      links: (state.relations || []).filter((item) => !item.kind || item.kind === id || item.kind === 'links'),
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
    case 'templates':
    case 'diagrams':
    case 'reports':
      return { status: 'live', items: (state.phase2 && state.phase2[sectionId]) || [] };
    case 'financials':
      return { status: 'live', financials: state.phase2?.financials || { notes: '', rows: [] } };
    case 'documents':
      return { status: 'live', documents: state.documents || [] };
    case 'crm':
    case 'calendar':
      return {
        status: 'live',
        links: (state.relations || []).filter((item) => !item.kind || item.kind === sectionId || item.kind === 'links'),
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
  scope = { ...scope, studioKey: await resolveStudioKey(scope, args) };

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
    const mcpActor = require('./denizen-mcp-actor');
    const actor = mcpActor.actorFromMcpScope(scope);
    return {
      ok: true,
      local,
      data_scope: mcpActor.isOrgWideScope(scope) ? 'org' : 'own',
      viewer: {
        identity_id: actor.identityId || null,
        user: actor.user || null,
        role: actor.role || null,
      },
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
    const templateId = args.template_id || args.templateId || 'i2e-e3-pave';
    const existing = (state.programs || []).find((p) => p.templateId === templateId);
    if (existing && args.force !== true) {
      return {
        ok: true,
        preserved: true,
        template: existing.name || existing.templateId,
        program_id: existing.id,
        guidance: 'This program is already saved. PAVE, goals, and experiments were kept.',
      };
    }
    const bundle = e3.applyProgramTemplate(templateId, {
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
    const { state, orgId } = loaded;
    // Personal Dolonia founder materials must not land in other teams.
    if (orgId && denizenDb.orgId && String(orgId) !== String(denizenDb.orgId)) {
      return {
        ok: false,
        error:
          'Founder pack is operator-only. New teams start with an empty Business Studio — do not import another org\'s living materials.',
      };
    }
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
      preserved: result.preserved,
      guidance:
        'Saved PAVE, moat, capital notes, and lean canvas stay in place. '
        + 'Update them with business_studio_upsert_pave, business_studio_upsert_moat, '
        + 'and business_studio_upsert_capital_plan. This pack does not restore a template.',
    };
  }

  if (name === 'business_studio_add_evidence') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const evidenceType = String(args.type || '').trim().toLowerCase();
    if (evidenceType === 'interview' || evidenceType === 'discovery_interview') {
      return {
        ok: false,
        error: 'Use business_studio_link_validated_interview with qualifying true and contact_id. An unvalidated conversation is not counted.',
      };
    }
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

  if (name === 'business_studio_link_validated_interview') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state, orgId } = loaded;
    let result;
    try {
      result = chain.linkValidatedInterview(state, {
        title: args.title,
        contactId: args.contact_id || args.contactId,
        contactName: args.contact_name || args.contactName,
        qualifying: args.qualifying === true || args.validated === true,
        description: args.description,
        notes: args.description || args.notes,
        experimentId: args.experiment_id || args.experimentId,
        source: 'mcp',
      });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    const saved = await saveState(scope, state);
    let boardTask = null;
    if (orgId && result.duplicate !== true) {
      try {
        const board = require('./denizen-studio-board-mutations');
        boardTask = await board.upsertTask(orgId, {
          title: result.nextTask.title,
          contact_id: result.nextTask.contactId,
          notes: `Qualifying interview evidence ${result.evidence.id}.`,
        }, scope?.identity_id || null, { name: 'evidence-chain' });
      } catch (err) {
        boardTask = { ok: false, error: err?.message || String(err) };
      }
      try {
        require('./denizen-outcome-ledger').appendOutcome({
          org_id: orgId,
          actor: scope?.identity_id || 'business-studio',
          outcome_type: 'interview.validated',
          entity_type: 'evidence',
          entity_key: String(result.evidence.id),
          value_text: `Validated interview "${result.evidence.title}" linked to contact ${result.evidence.contactId}.`,
          value_json: {
            evidence_id: result.evidence.id,
            contact_id: result.evidence.contactId,
            experiment_id: result.evidence.experimentId || null,
          },
          source: 'evidence-chain',
        });
      } catch (_) { /* receipt is best-effort */ }
    }
    return {
      ok: true,
      evidence: result.evidence,
      next_task: result.nextTask,
      board_task: boardTask,
      counted: result.counted,
      duplicate: !!result.duplicate,
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
    const mcpActor = require('./denizen-mcp-actor');
    const actor = mcpActor.actorFromMcpScope(scope);
    let task = (state.tasks || []).find((t) => t.id === args.id);
    if (task) {
      Object.assign(task, {
        title: args.title ?? task.title,
        status: args.status ?? task.status,
        priority: args.priority ?? task.priority,
        due: args.due ?? task.due,
        owner: args.owner ?? task.owner,
      });
      if (!task.ownerIdentityId && actor.identityId) task.ownerIdentityId = actor.identityId;
    } else {
      task = {
        id: uid('task'),
        title: args.title,
        status: args.status || 'todo',
        priority: args.priority || 'medium',
        due: args.due || null,
        owner: args.owner || actor.user || null,
        ownerIdentityId: actor.identityId || scope?.identity_id || null,
        createdBy: actor.user || null,
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
    const written = funding.applyLeanCanvasFields(fund.leanCanvas, args || {});
    if (!written.applied.length || written.ignored.length) {
      return {
        ok: false,
        error: written.applied.length
          ? 'unrecognized lean canvas fields were not saved'
          : 'no lean canvas fields applied',
        applied: written.applied,
        ignored: written.ignored,
        fields: funding.LEAN_CANVAS_FIELDS.map((f) => f.key),
        hint: 'Send the nine boxes by name. Snake_case and {text,body} values are kept. Nothing was saved.',
      };
    }
    fund.leanCanvas = written.canvas;
    const saved = await saveState(scope, state);
    return {
      ok: true,
      applied: written.applied,
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
    const written = paveMod.applyPaveFields(program.pave, args || {});
    if (!written.applied.length || written.ignored.length) {
      return {
        ok: false,
        error: written.applied.length
          ? 'unrecognized pave fields were not saved'
          : 'no pave fields applied',
        applied: written.applied,
        ignored: written.ignored,
        fields: written.fields,
        received_keys: Object.keys(args || {}),
        hint: 'Send snapshot, partA, partB, partC, partD, or final, or dotted paths such as partA.problem. Nothing was saved.',
      };
    }
    program.pave = written.pave;
    const idx = (state.programs || []).findIndex((p) => p.id === program.id);
    if (idx >= 0) state.programs[idx] = program;
    const saved = await saveState(scope, state);
    return {
      ok: true,
      program_id: program.id,
      applied: written.applied,
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
    const written = funding.applyMoatFields(fund.moat, args || {});
    if (!written.applied.length) {
      return {
        ok: false,
        error: 'no moat fields applied',
        received_keys: Object.keys(args || {}),
        hint: 'Send primaryClaim, primaryWhy, or sources. Supplied fields overwrite stored ones. Nothing was saved.',
      };
    }
    fund.moat = written.moat;
    const saved = await saveState(scope, state);
    return { ok: true, applied: written.applied, moat: funding.evaluateMoat(state), raw: fund.moat, persist: saved };
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
    const patch = { ...(args.marketSizing || args.market_sizing || {}) };
    for (const key of ['tamOrgs', 'samOrgs', 'somPct', 'acv', 'geography', 'buyerWho']) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    const next = { ...fund.marketSizing, ...patch };
    delete next.marketSizing;
    delete next.market_sizing;
    const serviceLines = asNodeList(args.service_lines, args.serviceLines, patch.service_lines, patch.serviceLines);
    if (serviceLines) {
      next.serviceLines = serviceLines.map((line) => ({
        id: line?.id || uid('line'),
        name: String(line?.name || line?.line || ''),
        tam: line?.tam == null || line.tam === '' ? null : Number(line.tam),
        sam: line?.sam == null || line.sam === '' ? null : Number(line.sam),
        som: line?.som == null || line.som === '' ? null : Number(line.som),
        source: String(line?.source || ''),
      }));
    }
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
    const written = funding.applyCapitalFields(fund.capitalPlan, args || {});
    if (!written.applied.length) {
      return {
        ok: false,
        error: 'no capital fields applied',
        received_keys: Object.keys(args || {}),
        hint: 'Send notes, stage, or capitalPlan. Supplied fields overwrite stored ones. Nothing was saved.',
      };
    }
    fund.capitalPlan = written.capitalPlan;
    const saved = await saveState(scope, state);
    return { ok: true, applied: written.applied, capital: funding.capitalPathwayBrief(state), persist: saved };
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
    state.business = state.business || { id: uid('biz'), name: '', founderName: '' };
    const written = studioStore.applyBusinessProfile(state.business, args || {});
    if (!written.applied.length && !(args.config && typeof args.config === 'object')) {
      return {
        ok: false,
        error: 'no settings fields applied',
        received_keys: Object.keys(args || {}),
        hint: 'Send company_name or name for the header, and founder_name for the founder. Nothing was saved.',
      };
    }
    state.business = { ...state.business, ...written.business, id: state.business.id || uid('biz') };
    if (state.business.structure === 'holding' || state.business.structure === 'portfolio') {
      for (const program of state.programs || []) {
        if (program && program.templateId === 'i2e-e3-pave') program.scope = 'product';
      }
      if (studioStore.strategyMapIsE3Template(state.strategyNodes)) {
        state.strategyNodes = [];
        state.strategyEdges = [];
      }
      state.funding = state.funding || funding.emptyFundingState();
      state.funding.marketSizing = state.funding.marketSizing || funding.emptyFundingState().marketSizing;
      if (!Array.isArray(state.funding.marketSizing.serviceLines) || !state.funding.marketSizing.serviceLines.length) {
        state.funding.marketSizing.serviceLines = HOLDING_SERVICE_LINES.map((line) => ({
          id: uid('line'),
          name: line,
          tam: null,
          sam: null,
          som: null,
          source: '',
        }));
      }
    }
    if (args.config && typeof args.config === 'object') {
      const config = { ...(state.config || {}), ...args.config };
      delete config.privateStudios;
      state.config = config;
    }
    const saved = await saveState(scope, state);
    return {
      ok: true,
      applied: written.applied,
      business: state.business,
      config: state.config || {},
      persist: saved,
    };
  }

  if (name === 'business_studio_get_workspace') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    return {
      ok: true,
      studio: loaded.studioKey || 'founder',
      adopted: !!loaded.adopted,
      updated_at: loaded.updated_at || null,
      state: studioStore.stripPrivateStudios(loaded.state),
    };
  }

  if (name === 'business_studio_patch') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const patch = args.patch && typeof args.patch === 'object' ? args.patch : args;
    const next = applyStudioPatch(loaded.state, patch);
    const saved = await saveState(scope, next);
    return { ok: true, persist: saved, state: studioStore.stripPrivateStudios(next) };
  }

  if (name === 'business_studio_upsert_strategy') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const written = strategyReplacement(args || {});
    if (!written.applied.length) {
      return {
        ok: false,
        error: 'no strategy fields applied',
        received_keys: Object.keys(args || {}),
        hint: 'Send nodes (or strategy_nodes) to replace the strategy map. Nothing was saved.',
      };
    }
    if (written.nodes) state.strategyNodes = written.nodes;
    if (written.edges) state.strategyEdges = written.edges;
    const saved = await saveState(scope, state);
    return {
      ok: true,
      applied: written.applied,
      nodes: state.strategyNodes || [],
      edges: state.strategyEdges || [],
      persist: saved,
    };
  }

  if (name === 'business_studio_upsert_milestone') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const replacement = milestoneList(args || {});
    if (replacement) {
      state.milestones = replacement;
      const saved = await saveState(scope, state);
      return { ok: true, applied: ['milestones'], milestones: state.milestones, persist: saved };
    }
    const id = args.id || uid('ms');
    const row = {
      id,
      title: args.title || args.name || 'Milestone',
      ...(args.status != null ? { status: String(args.status) } : {}),
      ...(args.stage != null ? { stage: String(args.stage) } : {}),
      ...(args.notes != null ? { notes: String(args.notes) } : {}),
    };
    state.milestones = upsertById(state.milestones, row, (item) => String(item?.id) === String(id) || (
      args.title && String(item?.title || '').toLowerCase() === String(args.title).toLowerCase()
    ));
    const saved = await saveState(scope, state);
    return { ok: true, milestone: state.milestones.find((item) => String(item.id) === String(id)), persist: saved };
  }

  if (name === 'business_studio_upsert_advisor') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const email = String(args.email || '').trim().toLowerCase();
    const id = args.id || uid('adv');
    const row = {
      id,
      name: args.name || email || 'Advisor',
      ...(email ? { email } : {}),
      ...(args.role != null ? { role: String(args.role) } : {}),
      ...(args.share && typeof args.share === 'object' ? { share: args.share } : {}),
    };
    state.advisors = upsertById(state.advisors, row, (item) => (
      (args.id && String(item?.id) === String(args.id))
      || (email && String(item?.email || '').toLowerCase() === email)
    ));
    const saved = await saveState(scope, state);
    return { ok: true, advisors: state.advisors, persist: saved };
  }

  if (name === 'business_studio_upsert_section') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const written = applySectionWrite(loaded.state, args || {});
    if (!written.ok) return written;
    const saved = await saveState(scope, written.state);
    return {
      ok: true,
      studio: scope.studioKey || 'founder',
      section: written.section,
      record: written.record || null,
      phase2: written.state.phase2 || null,
      persist: saved,
    };
  }

  if (name === 'business_studio_upsert_metric') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const id = args.id || uid('met');
    const row = {
      id,
      name: args.name || 'Metric',
      ...(args.value != null ? { value: args.value } : {}),
      ...(args.unit != null ? { unit: String(args.unit) } : {}),
      ...(args.notes != null ? { notes: String(args.notes) } : {}),
    };
    state.metrics = upsertById(state.metrics, row, (item) => String(item?.id) === String(id) || (
      args.name && String(item?.name || '').toLowerCase() === String(args.name).toLowerCase()
    ));
    const saved = await saveState(scope, state);
    return { ok: true, metric: state.metrics.find((item) => String(item.id) === String(id)), persist: saved };
  }

  return { ok: false, error: `Unknown Business Studio tool: ${name}` };
}

module.exports = {
  BUSINESS_STUDIO_TOOL_DEFINITIONS,
  hasBusinessStudioAccess,
  applyStudioPatch,
  applySectionWrite,
  studioKeyFromAccount,
  resolveStudioKey,
  isBusinessStudioTool,
  toolsForNpc,
  callTool,
};
