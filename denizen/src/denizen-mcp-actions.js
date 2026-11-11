'use strict';

/**
 * Action handlers for NPC MCP — run skills, assign work, speak in the office.
 * Wired from server.js via configure().
 */

const npcCapabilities = require('./npc-capabilities');
const npcRoster = require('./npc-roster');
const skillJobs = require('./denizen-mcp-skill-jobs');
const studioSkills = require('./denizen-studio-skills');

let _deps = {};

const SKILL_TIMEOUT_MS = Number(process.env.DENIZEN_MCP_SKILL_TIMEOUT_MS || 180000);

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function displayNameForKey(npcKey) {
  const hit = (npcRoster.entries || []).find((e) => e.folder === npcKey);
  return hit?.display || npcKey;
}

function resolveTargetNpc(nameOrKey) {
  const q = String(nameOrKey || '').toLowerCase().trim();
  if (!q) return null;
  const byFolder = (npcRoster.entries || []).find((e) => e.folder === q);
  if (byFolder) return byFolder.display;
  const byDisplay = (npcRoster.entries || []).find((e) => e.display.toLowerCase() === q);
  return byDisplay?.display || null;
}

function normalizeSkillName(skill) {
  return String(skill || '').trim().toLowerCase().replace(/_/g, '-');
}

function listSkillsForNpc(npcKey) {
  const display = displayNameForKey(npcKey);
  const cap = npcCapabilities.getCapabilities(display);
  const skills = new Set(cap?.skills || []);
  let crmPersonas;
  try {
    // eslint-disable-next-line global-require
    crmPersonas = require('./denizen-crm-npc-personas');
  } catch (_) {
    crmPersonas = null;
  }
  if (crmPersonas) {
    const persona = crmPersonas.resolvePersona(display);
    const allowed = crmPersonas.NPC_ALLOWED_SKILLS?.[persona?.key];
    if (allowed) {
      for (const s of allowed) skills.add(s);
    } else if (skills.has('denizen-data')) {
      for (const s of crmPersonas.CRM_READ_SKILLS_LIST || []) skills.add(s);
      if (persona?.canWrite) {
        for (const s of crmPersonas.CRM_WRITE_SKILLS_LIST || []) skills.add(s);
      }
    }
  }
  // Studio Board + Business Studio — same dual path as CRM (MCP tools + run_skill aliases)
  for (const s of studioSkills.skillsForNpc(npcKey, { canWrite: true })) {
    skills.add(s);
  }
  return [...skills].sort();
}

function assertSkillAllowed(npcKey, skill) {
  const normalized = normalizeSkillName(skill);
  if (!normalized) return { ok: false, error: 'skill required' };
  let crmPersonas;
  try {
    // eslint-disable-next-line global-require
    crmPersonas = require('./denizen-crm-npc-personas');
  } catch (_) {
    crmPersonas = null;
  }
  const display = displayNameForKey(npcKey);
  const capSkills = new Set(
    (npcCapabilities.getCapabilities(display)?.skills || []).map(normalizeSkillName),
  );
  if (capSkills.has(normalized)) return { ok: true, skill: normalized };
  if (crmPersonas?.canNpcRunSkill(display, normalized)) return { ok: true, skill: normalized };
  if (studioSkills.isStudioSkill(normalized)) return { ok: true, skill: normalized };
  return {
    ok: false,
    error: `skill not allowed for ${display}: ${normalized}`,
    allowed: listSkillsForNpc(npcKey),
  };
}

function isChatgptClient(scope, args = {}) {
  const label = String(scope?.label || scope?.token_label || '').toLowerCase();
  const meta = scope?.metadata || scope?.meta || {};
  const clientType = String(
    meta.client_type || meta.clientType || args.client_type || args.client || '',
  ).toLowerCase();
  const from = String(args.from || '').toLowerCase();
  if (clientType.includes('chatgpt') || clientType === 'openai') return true;
  if (label.includes('chatgpt') || label.includes('openai-gpt')) return true;
  if (from.includes('chatgpt') || from.includes('via chatgpt')) return true;
  if (meta.chatgpt === true || meta.block_assign_task === true) return true;
  return false;
}

function assignTaskBlockedResponse() {
  return {
    ok: false,
    error: 'assign_task_blocked_for_chatgpt',
    message:
      'ChatGPT must execute work with run_skill (wait=false + poll get_skill_job). '
      + 'assign_task queues the slow local office brain — not allowed for cloud GPT.',
    use_instead: {
      tool: 'run_skill',
      wait: false,
      then: 'get_skill_job',
    },
  };
}

const SKILL_HINTS = Object.freeze({
  research: {
    category: 'research',
    required_params: ['query'],
    example_params: { query: '1921 GovCon pipeline competitors' },
    wait_recommended: true,
  },
  'crm-draft-email': {
    category: 'crm',
    required_params: ['to', 'subject'],
    example_params: { to: 'lead@example.com', subject: 'Follow-up', context: 'After demo' },
    wait_recommended: true,
  },
  'crm-summary': {
    category: 'crm',
    required_params: [],
    example_params: {},
    wait_recommended: true,
  },
  'coding-agent': {
    category: 'dev',
    required_params: ['task'],
    example_params: { task: 'Fix flaky MCP handoff test' },
    wait_recommended: false,
  },
  github: {
    category: 'dev',
    required_params: ['task'],
    example_params: { task: 'Open PR summary for handoff wake' },
    wait_recommended: true,
  },
  'canvas-render': {
    category: 'design',
    required_params: ['prompt'],
    example_params: { prompt: 'Office floor map thumbnail' },
    wait_recommended: true,
  },
});

function enrichSkillList(names) {
  return (names || []).map((name) => {
    const hint = SKILL_HINTS[name] || null;
    return {
      name,
      category: hint?.category || null,
      required_params: hint?.required_params || null,
      example_params: hint?.example_params || null,
      wait_recommended: hint?.wait_recommended ?? true,
    };
  });
}

async function toolListSkills(scope, args = {}) {
  const mcpResponse = require('./denizen-mcp-response');
  const display = displayNameForKey(scope.npc_key);
  const cap = npcCapabilities.getCapabilities(display);
  const allSkills = listSkillsForNpc(scope.npc_key);
  const mode = mcpResponse.modeOf(args, 'summary');
  const page = mcpResponse.paginate(allSkills, args, { defaultLimit: mode === 'full' ? 40 : 200, maxLimit: 500 });

  const base = {
    ok: true,
    npc_key: scope.npc_key,
    display_name: display,
    role: cap?.role || null,
    mode,
    skills: page.items,
    count: page.total,
    offset: page.offset,
    limit: page.limit,
    next_offset: page.next_offset,
    has_more: page.has_more,
    next_step: 'run_skill with skill + params; wait=false + get_skill_job for long jobs',
  };

  if (!page.total) {
    return {
      ...base,
      ...mcpResponse.emptyHealthy({
        kind: 'skills',
        create_with: 'npc capabilities / CRM persona assignment',
      }),
    };
  }

  if (mode === 'names') {
    return mcpResponse.softCap(base, { dropKeys: ['skill_details'] });
  }

  // summary: only skills with real param hints (avoids duplicating the whole roster)
  // full: enrich every skill on this page
  const detailsSource = mode === 'full'
    ? page.items
    : page.items.filter((name) => SKILL_HINTS[name]);
  const skill_details = enrichSkillList(detailsSource);
  return mcpResponse.softCap({
    ...base,
    skill_details,
    skill_details_note: mode === 'summary'
      ? 'summary mode returns details only for skills with known param hints — use mode=full (+ offset/limit) for every skill'
      : null,
  }, { dropKeys: mode === 'full' ? [] : [] });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toolRunSkill(scope, args) {
  const gate = assertSkillAllowed(scope.npc_key, args?.skill);
  if (!gate.ok) return gate;
  if (typeof _deps.runNpcSkill !== 'function' && !studioSkills.isStudioSkill(gate.skill)) {
    return { ok: false, error: 'skill runner not configured on server' };
  }

  const display = displayNameForKey(scope.npc_key);
  const params = args?.params && typeof args.params === 'object' ? args.params : {};
  const wait = args?.wait !== false;
  const maxWaitMsRaw = Number(args?.max_wait_ms);
  const maxWaitMs = Number.isFinite(maxWaitMsRaw) && maxWaitMsRaw > 0
    ? Math.min(maxWaitMsRaw, SKILL_TIMEOUT_MS)
    : null;
  const broadcast = _deps.broadcast || (() => {});

  const job = skillJobs.createJob({
    orgId: scope.org_id,
    npcKey: scope.npc_key,
    skill: gate.skill,
    params,
    tokenId: scope.token_id || null,
    sessionId: scope.session_id || null,
  });

  const runSkillBody = studioSkills.isStudioSkill(gate.skill)
    ? () => studioSkills.runStudioSkill(scope, gate.skill, params)
    : () => _deps.runNpcSkill(display, gate.skill, params, {
      broadcast,
      sessionId: scope.session_id || null,
    });

  const promise = Promise.resolve()
    .then(runSkillBody)
    .then((result) => {
      skillJobs.completeJob(job.id, result || {});
      return result;
    })
    .catch((err) => {
      skillJobs.failJob(job.id, err);
      throw err;
    });

  // Fire-and-forget / ChatGPT poll path
  if (!wait) {
    const softWait = maxWaitMs || 0;
    if (softWait > 0) {
      const done = await Promise.race([
        promise.then(() => skillJobs.getJob(job.id)).catch(() => skillJobs.getJob(job.id)),
        sleep(softWait).then(() => null),
      ]);
      if (done && (done.status === 'done' || done.status === 'failed')) {
        return skillJobs.publicJobView(done);
      }
    } else {
      promise.catch((err) => console.warn('[MCP run_skill]', err?.message || err));
    }
    return {
      ok: true,
      started: true,
      job_id: job.id,
      skill: gate.skill,
      npc_key: scope.npc_key,
      display_name: display,
      status: 'running',
      mode: 'async',
      hint: 'Poll get_skill_job with this job_id until status is done or failed',
      poll: { tool: 'get_skill_job', job_id: job.id },
    };
  }

  const timeout = Math.min(
    SKILL_TIMEOUT_MS,
    Number(args?.timeout_ms) || SKILL_TIMEOUT_MS,
  );
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`skill timeout after ${timeout}ms`)),
      timeout,
    );
  });
  let result;
  try {
    result = await Promise.race([promise, timeoutPromise]).catch((err) => ({
      ok: false,
      output: err?.message || String(err),
      skill: gate.skill,
    }));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const finished = skillJobs.getJob(job.id);
  return {
    ok: result?.ok !== false,
    job_id: job.id,
    skill: gate.skill,
    npc_key: scope.npc_key,
    output: result?.output || result?.summary || finished?.output || null,
    data: result?.data || finished?.data || null,
    error: finished?.error || null,
    status: finished?.status || (result?.ok !== false ? 'done' : 'failed'),
    routed: result?.routed,
  };
}

async function toolGetSkillJob(scope, args) {
  const id = args?.job_id || args?.id;
  if (!id) return { ok: false, error: 'job_id required' };
  const job = skillJobs.getJobForScope(id, scope);
  if (!job) return { ok: false, error: 'job_not_found', job_id: id };
  return skillJobs.publicJobView(job);
}

async function toolAssignTask(scope, args, opts = {}) {
  if (opts.restChatgptPath || isChatgptClient(scope, args)) {
    if (!args?.allow_local_queue) {
      return assignTaskBlockedResponse();
    }
  }
  const task = String(args?.task || '').trim().slice(0, 2000);
  if (!task) return { ok: false, error: 'task required' };
  if (!_deps.npcBrains?.assignDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const display = displayNameForKey(scope.npc_key);
  const from = String(args?.from || 'MCP teammate').slice(0, 80);
  const urgent = !!args?.urgent;
  const entry = _deps.npcBrains.assignDirective(display, from, task, urgent);
  return {
    ok: true,
    assigned_to: display,
    task,
    urgent,
    directive: entry ? {
      id: entry.id || null,
      npc: display,
      status: entry.status || 'queued',
      task: entry.task || task,
      urgent: !!entry.urgent,
      expires_at: entry.expires_at || null,
    } : { npc: display, status: 'queued', task, urgent },
    next_step: ['list_directives', 'complete_directive'],
  };
}

async function toolDelegateTask(scope, args) {
  if (isChatgptClient(scope, args)) {
    return assignTaskBlockedResponse();
  }
  const task = String(args?.task || '').trim().slice(0, 2000);
  const target = resolveTargetNpc(args?.to_npc || args?.to);
  if (!task) return { ok: false, error: 'task required' };
  if (!target) return { ok: false, error: 'to_npc required (display name or folder key)' };
  if (!_deps.npcBrains?.assignDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const from = displayNameForKey(scope.npc_key);
  const urgent = !!args?.urgent;
  const entry = _deps.npcBrains.assignDirective(target, `${from} (MCP)`, task, urgent);
  return {
    ok: true,
    from_npc: from,
    to_npc: target,
    task,
    urgent,
    directive: entry ? {
      id: entry.id || null,
      npc: target,
      status: entry.status || 'queued',
      task: entry.task || task,
      urgent: !!entry.urgent,
      expires_at: entry.expires_at || null,
    } : { npc: target, status: 'queued', task, urgent },
    next_step: ['list_directives', 'complete_directive'],
  };
}

async function toolAnnounce(scope, args) {
  const text = String(args?.message || args?.text || '').trim().slice(0, 500);
  if (!text) return { ok: false, error: 'message required' };
  if (typeof _deps.broadcast !== 'function') {
    return { ok: false, error: 'broadcast not configured' };
  }
  const display = displayNameForKey(scope.npc_key);
  _deps.broadcast({
    type: 'npc_response',
    npcName: display,
    fromName: 'MCP teammate',
    text,
    turn: 1,
    ts: Date.now(),
  });
  return { ok: true, npc_key: scope.npc_key, display_name: display, announced: text };
}

module.exports = {
  configure,
  listSkillsForNpc,
  assertSkillAllowed,
  isChatgptClient,
  toolListSkills,
  toolRunSkill,
  toolGetSkillJob,
  toolAssignTask,
  toolDelegateTask,
  toolAnnounce,
};
