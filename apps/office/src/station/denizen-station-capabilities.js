'use strict';

const SKILL_CAPABILITY = {
  'desktop-agent': 'screen_access',
  'screen-observe': 'screen_access',
  'browserclaw': 'screen_access',
  'web-search': 'screen_access',
  'research': 'screen_access',
  'coding-agent': 'screen_access',
  'github': 'run_code',
  'job-scraper': 'screen_access',
  'job-applier': 'screen_access',
  'file-read': 'read_files',
  'file-write': 'write_files',
  'run-code': 'run_code',
  'run_code': 'run_code',
};

const TASK_KIND_CAPABILITY = {
  desktop_agent: 'screen_access',
  screen_observe: 'screen_access',
  file_read: 'read_files',
  file_write: 'write_files',
  run_code: 'run_code',
};

function normalizeCaps(profile = {}) {
  const caps = profile.desktop_capabilities || profile.capabilities || {};
  return {
    read_files: !!caps.read_files,
    write_files: !!caps.write_files,
    run_code: !!caps.run_code,
    screen_access: !!caps.screen_access,
    contribute_compute: !!caps.contribute_compute,
    lm_studio: !!caps.lm_studio,
    shell_access: !!caps.shell_access,
    network_jobs: !!caps.network_jobs,
  };
}

function capabilityForSkill(skill) {
  return SKILL_CAPABILITY[String(skill || '').trim().toLowerCase()] || null;
}

function capabilityForTaskKind(kind) {
  return TASK_KIND_CAPABILITY[String(kind || '').trim().toLowerCase()] || null;
}

function hasCapability(profile, cap) {
  if (!cap) return true;
  const caps = normalizeCaps(profile);
  return !!caps[cap];
}

function assertCapability(profile, cap, { skill = null, kind = null } = {}) {
  const required = cap || capabilityForSkill(skill) || capabilityForTaskKind(kind);
  if (!required) return { ok: true, capability: null };
  if (!hasCapability(profile, required)) {
    const label = required.replace(/_/g, ' ');
    return {
      ok: false,
      capability: required,
      error: `${label} is disabled for this station. Enable it in the Denizen setup wizard.`,
    };
  }
  return { ok: true, capability: required };
}

function stationIsOnline(profile, maxAgeMs = 6 * 60 * 1000) {
  if (!profile?.desktop_install_id || !profile?.setup_wizard_completed) return false;
  const synced = profile.last_capability_sync_at || profile.desktop_linked_at;
  if (!synced) return false;
  const age = Date.now() - new Date(synced).getTime();
  return Number.isFinite(age) && age <= maxAgeMs;
}

module.exports = {
  SKILL_CAPABILITY,
  TASK_KIND_CAPABILITY,
  normalizeCaps,
  capabilityForSkill,
  capabilityForTaskKind,
  hasCapability,
  assertCapability,
  stationIsOnline,
};
