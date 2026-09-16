'use strict';

/**
 * Business Studio MCP tools — founder OS working set + mutations.
 */

const studioStore = require('./denizen-business-studio-store');
const progress = require('./denizen-business-studio-progress');
const e3 = require('./denizen-business-studio-e3-template');
const funding = require('./denizen-business-studio-funding');
const denizenDb = require('./denizen-db');

const BUSINESS_STUDIO_TOOL_DEFINITIONS = [
  {
    name: 'business_studio_working_set',
    description:
      'READ-ONLY Business Studio working set: active program progress, health categories, open/overdue tasks, '
      + 'experiments needing evidence, recent evidence. Call first. Empty workspace is OK — do not invent metrics.',
    inputSchema: { type: 'object', properties: { focus: { type: 'string' } } },
  },
  {
    name: 'business_studio_brief',
    description: 'Short founder brief: program %, needs-attention categories, top next actions with WHY.',
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
    name: 'business_studio_add_evidence',
    description: 'Attach real evidence (interview, document, meeting, metric, manual). Never fabricate.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        experiment_id: { type: 'string' },
        requirement_key: { type: 'string' },
        assumption_key: { type: 'string' },
      },
      required: ['title', 'type'],
    },
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
      'READ-ONLY Funding Readiness checklist with evidence counts (complete / need work / not started). '
      + 'Never invent a mysterious readiness percentage.',
    inputSchema: { type: 'object', properties: {} },
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

async function callTool(scope, name, args = {}) {
  const key = scope?.npc_key;
  if (!hasBusinessStudioAccess(key) && scope?.scope_mode !== 'team') {
    return { ok: false, error: `Business Studio tools not available for ${key}` };
  }

  if (name === 'business_studio_working_set') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state, local } = loaded;
    const health = progress.businessHealth(state);
    return {
      ok: true,
      local,
      business: state.business,
      health,
      open_tasks: (state.tasks || []).filter((t) => t.status !== 'done').slice(0, 20),
      experiments: health.experiments,
      evidence_recent: (state.evidence || []).slice(0, 10),
      guidance: 'Empty workspace is OK. Do not invent revenue, interviews, or progress.',
    };
  }

  if (name === 'business_studio_brief') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const health = progress.businessHealth(loaded.state);
    const attn = (health.categories || []).filter((c) => c.status === 'needs_attention');
    return {
      ok: true,
      program: health.program,
      needs_attention: attn,
      next_actions: attn.map((c) => ({
        category: c.name,
        action: c.recommendedAction,
        why: c.reason,
      })),
      overdue_tasks: health.overdueTaskCount,
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

  if (name === 'business_studio_add_evidence') {
    const loaded = await loadState(scope);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { state } = loaded;
    const ev = {
      id: uid('ev'),
      title: String(args.title || '').trim(),
      type: String(args.type || 'manual').trim(),
      description: String(args.description || ''),
      createdAt: new Date().toISOString(),
      linkedExperimentIds: args.experiment_id ? [args.experiment_id] : [],
      experimentId: args.experiment_id || null,
      requirementKey: args.requirement_key || null,
      linkedAssumptionKeys: args.assumption_key ? [args.assumption_key] : [],
    };
    if (!ev.title) return { ok: false, error: 'title required' };
    state.evidence = [ev, ...(state.evidence || [])];
    const saved = await saveState(scope, state);
    return { ok: true, evidence: ev, persist: saved };
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
    return {
      ok: true,
      readiness: funding.evaluateFundingReadiness(loaded.state),
      marketSizing: funding.calculateMarketSizing(loaded.state.funding?.marketSizing || {}),
      moat: funding.evaluateMoat(loaded.state),
      discovery: funding.discoveryPatterns(loaded.state),
      guidance: 'Never invent a funding-ready percentage. Use complete / need work / not started counts.',
    };
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
