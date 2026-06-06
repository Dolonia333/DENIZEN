'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKILL_FILE = 'index.js';

function parseSkillMd(skillMdPath) {
  try {
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const meta = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return meta;
  } catch (_) {
    return {};
  }
}

class SkillRegistry {
  constructor() {
    /** @type {Map<string, {meta: object, run: Function, source: string}>} */
    this._skills = new Map();
    /** @type {Map<string, string>} */
    this._aliases = new Map();
  }

  register(skill) {
    const name = skill?.meta?.name;
    if (!name || typeof skill.run !== 'function') {
      throw new Error('Skill must export meta.name and run()');
    }
    this._skills.set(name, {
      meta: { ...skill.meta },
      run: skill.run,
      source: skill.source || 'native',
    });
    for (const alias of skill.meta.aliases || []) {
      this._aliases.set(alias, name);
    }
    return this;
  }

  registerLegacy(name, scriptPath, meta = {}) {
    this._skills.set(name, {
      meta: { name, mode: 'subprocess', ...meta },
      run: null,
      scriptPath,
      source: 'legacy',
    });
    return this;
  }

  resolve(name) {
    const key = this._aliases.get(name) || name;
    return this._skills.get(key) || null;
  }

  list() {
    return [...this._skills.values()].map(s => ({
      name: s.meta.name,
      description: s.meta.description || '',
      mode: s.meta.mode || (s.source === 'legacy' ? 'subprocess' : 'native'),
      source: s.source,
    }));
  }

  has(name) {
    return this.resolve(name) != null;
  }
}

function discoverNativeSkills(skillsDir) {
  const registry = new SkillRegistry();
  if (!fs.existsSync(skillsDir)) return registry;

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, SKILL_FILE);
    if (!fs.existsSync(skillPath)) continue;
    const skill = require(skillPath);
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    const mdMeta = fs.existsSync(skillMd) ? parseSkillMd(skillMd) : {};
    skill.meta = { name: entry.name, ...mdMeta, ...skill.meta };
    skill.source = 'native';
    registry.register(skill);
  }
  return registry;
}

const { vendorScriptPath, VENDOR_SCRIPT_MAP } = require('./paths');

function registerVendorSkills(registry) {
  for (const name of Object.keys(VENDOR_SCRIPT_MAP)) {
    if (registry.has(name)) continue;
    const scriptPath = vendorScriptPath(name);
    if (scriptPath) {
      registry.registerLegacy(name, scriptPath, { description: `Jelly vendor: ${name}` });
    }
  }
  return registry;
}

/** @deprecated Use registerVendorSkills. OpenClaw fallback only if vendor missing. */
function registerLegacyOpenClawSkills(registry, openclawRoot) {
  registerVendorSkills(registry);
  if (!openclawRoot) return registry;

  const legacy = {
    'web-search': 'skills/web-search/web-search.mjs',
    'job-scraper': 'skills/job-scraper/job-scraper.mjs',
    'job-applier': 'skills/job-applier/job-applier.mjs',
    'resume-generator': 'skills/resume-generator/resume-generator.mjs',
    'pdf-generator': 'skills/pdf-generator/pdf-generator.mjs',
    'browserclaw': 'skills/browserclaw/browserclaw.mjs',
    'canvas-render': 'skills/canvas-render/canvas-render.mjs',
    'lm-studio': 'skills/lm-studio/scripts/lms_status.py',
    'supabase-bridge': 'skills/supabase-bridge/supabase-bridge.mjs',
    'screen-capture': 'skills/screen-capture/screen-capture.mjs',
  };

  for (const [name, rel] of Object.entries(legacy)) {
    if (registry.has(name)) continue;
    const scriptPath = path.join(openclawRoot, rel);
    if (fs.existsSync(scriptPath)) {
      registry.registerLegacy(name, scriptPath, { description: `OpenClaw fallback: ${name}` });
    }
  }
  return registry;
}

module.exports = {
  SkillRegistry,
  discoverNativeSkills,
  registerVendorSkills,
  registerLegacyOpenClawSkills,
};
