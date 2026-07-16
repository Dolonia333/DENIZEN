'use strict';

/**
 * Tools façade — Jelly is the only skill runtime.
 */

function createToolsFacade(deps = {}) {
  /**
   * Run a skill for an NPC through Jelly (or the server's runNpcSkill if bound).
   */
  async function runSkill(npcName, skill, skillParams = {}, ctx = {}) {
    const name = String(npcName || '').trim();
    const skillId = String(skill || '').trim();
    if (!name) return { ok: false, error: 'npc_required' };
    if (!skillId) return { ok: false, error: 'skill_required' };

    const runFn = deps.getRunNpcSkill?.() || deps.runNpcSkill;
    if (typeof runFn === 'function') {
      // Server runNpcSkill owns inject policy (station routes already inject).
      return runFn(name, skillId, skillParams, ctx);
    }

    const jelly = deps.getJelly?.() || deps.jelly;
    if (!jelly?.runSkill) {
      return { ok: false, error: 'jelly_not_bound' };
    }
    const result = await jelly.runSkill(name, skillId, skillParams, ctx);
    // Direct Jelly path: inject so next think() sees the result.
    if (deps.config?.learning?.inject_skill_results !== false) {
      try {
        const summary = result?.output || result?.summary || result?.error || '';
        deps.learning?.injectSkillResult?.(name, skillId, summary);
      } catch (_) {}
    }
    return result;
  }

  function listSkills() {
    const jelly = deps.getJelly?.() || deps.jelly;
    if (!jelly?.listSkills) return [];
    return jelly.listSkills();
  }

  function hasSkill(skill) {
    const list = listSkills();
    const want = String(skill || '').toLowerCase();
    return list.some((s) => {
      const id = String(s?.id || s?.name || s).toLowerCase();
      return id === want;
    });
  }

  return {
    runSkill,
    listSkills,
    hasSkill,
  };
}

module.exports = { createToolsFacade };
