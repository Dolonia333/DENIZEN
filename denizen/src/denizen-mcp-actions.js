'use strict';

/**
 * Action handlers for NPC MCP — run skills, assign work, speak in the office.
 * Wired from server.js via configure().
 */

const npcCapabilities = require('./npc-capabilities');
const npcRoster = require('./npc-roster');

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
  return [...skills].sort();
}

function assertSkillAllowed(npcKey, skill) {
  const normalized = String(skill || '').trim().toLowerCase();
  if (!normalized) return { ok: false, error: 'skill required' };
  let crmPersonas;
  try {
    // eslint-disable-next-line global-require
    crmPersonas = require('./denizen-crm-npc-personas');
  } catch (_) {
    crmPersonas = null;
  }
  const display = displayNameForKey(npcKey);
  const capSkills = new Set(npcCapabilities.getCapabilities(display)?.skills || []);
  if (capSkills.has(normalized)) return { ok: true, skill: normalized };
  if (crmPersonas?.canNpcRunSkill(display, normalized)) return { ok: true, skill: normalized };
  return {
    ok: false,
    error: `skill not allowed for ${display}: ${normalized}`,
    allowed: listSkillsForNpc(npcKey),
  };
}

async function toolListSkills(scope) {
  const display = displayNameForKey(scope.npc_key);
  const cap = npcCapabilities.getCapabilities(display);
  return {
    ok: true,
    npc_key: scope.npc_key,
    display_name: display,
    role: cap?.role || null,
    skills: listSkillsForNpc(scope.npc_key),
  };
}

async function toolRunSkill(scope, args) {
  const gate = assertSkillAllowed(scope.npc_key, args?.skill);
  if (!gate.ok) return gate;
  if (typeof _deps.runNpcSkill !== 'function') {
    return { ok: false, error: 'skill runner not configured on server' };
  }

  const display = displayNameForKey(scope.npc_key);
  const params = args?.params && typeof args.params === 'object' ? args.params : {};
  const wait = args?.wait !== false;
  const broadcast = _deps.broadcast || (() => {});

  const promise = _deps.runNpcSkill(display, gate.skill, params, {
    broadcast,
    sessionId: scope.session_id || null,
  });

  if (!wait) {
    promise.catch((err) => console.warn('[MCP run_skill]', err?.message || err));
    return {
      ok: true,
      started: true,
      skill: gate.skill,
      npc_key: scope.npc_key,
      display_name: display,
      mode: 'async',
      hint: 'Poll get_status or watch office WS for npc_skill_result',
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
    // A successful fast skill used to leave the full 180s rejection timer
    // alive. That kept tests and short-lived CLI/MCP processes from exiting.
    if (timeoutId) clearTimeout(timeoutId);
  }

  return {
    ok: result?.ok !== false,
    skill: gate.skill,
    npc_key: scope.npc_key,
    output: result?.output || result?.summary || null,
    routed: result?.routed,
  };
}

async function toolAssignTask(scope, args) {
  const task = String(args?.task || '').trim().slice(0, 2000);
  if (!task) return { ok: false, error: 'task required' };
  if (!_deps.npcBrains?.assignDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const display = displayNameForKey(scope.npc_key);
  const from = String(args?.from || 'MCP teammate').slice(0, 80);
  const urgent = !!args?.urgent;
  _deps.npcBrains.assignDirective(display, from, task, urgent);
  return { ok: true, assigned_to: display, task, urgent };
}

async function toolDelegateTask(scope, args) {
  const task = String(args?.task || '').trim().slice(0, 2000);
  const target = resolveTargetNpc(args?.to_npc || args?.to);
  if (!task) return { ok: false, error: 'task required' };
  if (!target) return { ok: false, error: 'to_npc required (display name or folder key)' };
  if (!_deps.npcBrains?.assignDirective) {
    return { ok: false, error: 'npc brains not configured' };
  }
  const from = displayNameForKey(scope.npc_key);
  const urgent = !!args?.urgent;
  _deps.npcBrains.assignDirective(target, `${from} (MCP)`, task, urgent);
  return { ok: true, from_npc: from, to_npc: target, task, urgent };
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
  toolListSkills,
  toolRunSkill,
  toolAssignTask,
  toolDelegateTask,
  toolAnnounce,
};
