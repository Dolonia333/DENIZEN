'use strict';

const path = require('node:path');
const { JELLY } = require('./meta');
const { loadConfig } = require('./config-loader');
const {
  discoverNativeSkills,
  registerVendorSkills,
  registerLegacyOpenClawSkills,
} = require('./skill-registry');
const { ensureJellyDirs } = require('./paths');
const { SkillExecutor } = require('./skill-executor');

// Re-export intent classifiers — Denizen-native, not OpenClaw gateway.
const intents = require('../src/openclaw-dispatch');

/**
 * Create Jelly — Denizen's NPC-native skill runtime. 🪼
 * Replaces OpenClaw gateway/channels; keeps legacy skill scripts during migration.
 */
function createJelly(opts = {}) {
  const denizenRoot = opts.denizenRoot || path.join(__dirname, '..');
  ensureJellyDirs();
  const config = loadConfig(denizenRoot);
  const registry = discoverNativeSkills(path.join(__dirname, 'skills'));

  registerVendorSkills(registry);
  const fallbackOpenClaw = String(process.env.JELLY_OPENCLAW_FALLBACK || 'false').toLowerCase() === 'true';
  if (fallbackOpenClaw && opts.openclawRoot) {
    registerLegacyOpenClawSkills(registry, opts.openclawRoot);
  }

  if (opts.extraSkills) {
    for (const skill of opts.extraSkills) registry.register(skill);
  }

  const deps = {
    config,
    jelly: JELLY,
    ...opts.deps,
  };

  const executor = new SkillExecutor(registry, deps);

  return {
    jelly: JELLY,
    config,
    registry,
    executor,
    intents,

    listSkills() {
      return registry.list();
    },

    registerSkill(skill) {
      registry.register(skill);
      return this;
    },

    async runSkill(npcName, skill, skillParams = {}, ctx = {}) {
      const resolved = registry.resolve(skill);

      if (npcName === 'Lucy' && (skill === 'job-scraper' || skill === 'job-applier')) {
        return executor.run(npcName, 'job-pipeline', skillParams, ctx);
      }

      if (skill === 'web-search' && deps.runWebSearch) {
        const broadcast = ctx.broadcast || deps.broadcast || (() => {});
        deps.log?.info?.(JELLY.logTag, `${npcName} → web-search`);
        broadcast({ type: 'npc_skill_start', npcName, skill: 'web-search', skillParams, ts: Date.now() });
        const query = skillParams?.query || skillParams?.q || skillParams?.topic || '';
        const r = await deps.runWebSearch(npcName, query, {
          broadcast,
          headless: skillParams?.headless === true,
          browserMode: skillParams?.browserMode,
          openOnly: skillParams?.openOnly === true,
          directUrl: skillParams?.directUrl || skillParams?.url || null,
          jobBoard: skillParams?.jobBoard || null,
          quiet: false,
        });
        return { ok: r.ok, output: r.summary || 'Search complete', skill: 'web-search', npcName };
      }

      if (resolved?.source === 'native') {
        return executor.run(npcName, skill, skillParams, ctx);
      }

      if (registry.resolve(skill)?.run) {
        return executor.run(npcName, skill, skillParams, ctx);
      }

      return executor.run(npcName, skill, skillParams, {
        ...ctx,
        approvedSkillScripts: opts.approvedSkillScripts?.() || {},
      });
    },
  };
}

module.exports = {
  JELLY,
  createJelly,
  loadConfig,
  SkillExecutor,
  intents,
  paths: require('./paths'),
  configProvider: require('./config-provider'),
  skillContracts: (() => {
    try { return require('../src/denizen-skill-contracts'); } catch (_) { return null; }
  })(),
};
