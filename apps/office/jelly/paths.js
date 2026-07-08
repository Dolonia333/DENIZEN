'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JELLY_ROOT = __dirname;
const DENIZEN_ROOT = path.join(JELLY_ROOT, '..');
const VENDOR_SKILLS = path.join(JELLY_ROOT, 'vendor', 'skills');
const SERVICES_DIR = path.join(JELLY_ROOT, 'services');

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function jellyHome() {
  return process.env.JELLY_HOME || path.join(homeDir(), '.denizen');
}

function browserDir() {
  return path.join(jellyHome(), 'browser');
}

function canvasDir() {
  return path.join(jellyHome(), 'canvas');
}

function workspaceDir() {
  return path.join(jellyHome(), 'workspace');
}

function lucyCloseFlag() {
  return path.join(browserDir(), 'lucy-close.flag');
}

function ensureJellyDirs() {
  for (const dir of [jellyHome(), browserDir(), canvasDir(), workspaceDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Skill scripts vendored from OpenClaw into Jelly (your tech, not upstream). */
const VENDOR_SCRIPT_MAP = {
  'web-search': 'web-search/web-search.mjs',
  'job-scraper': 'job-scraper/job-scraper.mjs',
  'job-applier': 'job-applier/job-applier.mjs',
  'resume-generator': 'resume-generator/resume-generator.mjs',
  'pdf-generator': 'pdf-generator/pdf-generator.mjs',
  'browserclaw': 'browserclaw/browserclaw.mjs',
  'canvas-render': 'canvas-render/canvas-render.mjs',
  'lm-studio': 'lm-studio/scripts/lms_status.py',
  'supabase-bridge': 'supabase-bridge/supabase-bridge.mjs',
  'screen-capture': 'screen-capture/screen-capture.mjs',
};

function vendorScriptPath(skillName) {
  const rel = VENDOR_SCRIPT_MAP[skillName];
  if (!rel) return null;
  const full = path.join(VENDOR_SKILLS, rel);
  return fs.existsSync(full) ? full : null;
}

function browserHelpersPath() {
  const jelly = path.join(VENDOR_SKILLS, 'job-apply-shared', 'browser-helpers.mjs');
  if (fs.existsSync(jelly)) return jelly;
  const legacy = path.join(DENIZEN_ROOT, '..', 'openclaw', 'skills', 'job-apply-shared', 'browser-helpers.mjs');
  return fs.existsSync(legacy) ? legacy : jelly;
}

function supabaseBridgeService() {
  return path.join(SERVICES_DIR, 'supabase-bridge', 'secure-bridge.py');
}

function browserclawService() {
  return path.join(SERVICES_DIR, 'browserclaw', 'server.mjs');
}

function resolveSkillScripts() {
  const scripts = {};
  for (const name of Object.keys(VENDOR_SCRIPT_MAP)) {
    const p = vendorScriptPath(name);
    if (p) scripts[name] = p;
  }
  return scripts;
}

module.exports = {
  JELLY_ROOT,
  DENIZEN_ROOT,
  VENDOR_SKILLS,
  SERVICES_DIR,
  jellyHome,
  browserDir,
  canvasDir,
  workspaceDir,
  lucyCloseFlag,
  ensureJellyDirs,
  vendorScriptPath,
  browserHelpersPath,
  supabaseBridgeService,
  browserclawService,
  resolveSkillScripts,
  VENDOR_SCRIPT_MAP,
};
