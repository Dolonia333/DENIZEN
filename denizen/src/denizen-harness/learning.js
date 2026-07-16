'use strict';

/**
 * Unified learning injectors for the Denizen harness.
 * Skill results → pending think context; mentor lessons → MEMORY.md.
 */

const fs = require('node:fs');
const path = require('node:path');

function createLearningFacade(deps = {}) {
  const dataDir = deps.dataDir
    || path.join(deps.denizenRoot || path.join(__dirname, '..', '..'), 'data');
  const improveLog = path.join(dataDir, 'harness-learning.jsonl');

  function getBrains() {
    return deps.getNpcBrains?.() || deps.npcBrains || null;
  }

  /**
   * Inject skill output into next think() (brains pending map + wake).
   */
  function injectSkillResult(npcName, skill, result) {
    const brains = getBrains();
    if (brains?.injectSkillResult) {
      brains.injectSkillResult(npcName, skill, result);
      _log({ type: 'skill_result', npc: npcName, skill, preview: String(result || '').slice(0, 200) });
      return { ok: true, path: 'npc_brains.injectSkillResult' };
    }
    return { ok: false, error: 'npc_brains_not_bound' };
  }

  /**
   * Inject a mentor / telemetry lesson into MEMORY.md (+ optional DB).
   */
  function injectLesson(npcName, answer, opts = {}) {
    let memInject = null;
    try { memInject = require('../npc-memory-inject'); } catch (_) {}
    if (!memInject?.injectLesson) {
      return { ok: false, error: 'npc_memory_inject_unavailable' };
    }
    const r = memInject.injectLesson(npcName, answer, {
      topic: opts.topic || 'harness-lesson',
      source: opts.source || 'denizen-harness',
      prefix: opts.prefix || '[HARNESS LESSON]',
    });
    _log({
      type: 'lesson',
      npc: npcName,
      ok: !!r?.ok,
      topic: opts.topic || 'harness-lesson',
      preview: String(answer || '').slice(0, 200),
    });
    return r;
  }

  /**
   * Generic learning entry — routes by source.
   */
  function injectLearning(npcName, payload = {}) {
    const source = String(payload.source || 'generic').toLowerCase();
    const text = payload.text || payload.answer || payload.result || '';
    if (source === 'skill' || payload.skill) {
      return injectSkillResult(npcName, payload.skill || 'unknown', text);
    }
    return injectLesson(npcName, text, {
      topic: payload.topic,
      source: payload.source || 'denizen-harness',
      prefix: payload.prefix,
    });
  }

  function _log(rec) {
    try {
      fs.mkdirSync(path.dirname(improveLog), { recursive: true });
      fs.appendFileSync(
        improveLog,
        `${JSON.stringify({ at: new Date().toISOString(), ...rec })}\n`,
        'utf8',
      );
    } catch (_) {}
  }

  function recent(limit = 40) {
    try {
      const lines = fs.readFileSync(improveLog, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => {
        try { return JSON.parse(l); } catch (_) { return null; }
      }).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  return {
    injectSkillResult,
    injectLesson,
    injectLearning,
    recent,
  };
}

module.exports = { createLearningFacade };
