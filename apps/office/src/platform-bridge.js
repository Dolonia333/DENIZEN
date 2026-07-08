'use strict';

/**
 * Dolonia platform CRM bridge (migrations 000005–000014) requires cloud tables
 * (`clients`, `profiles`, `blog_posts`, …) that are not on NAS-only Supabase.
 */

function platformBridgeStatus(env = process.env) {
  const forced = String(env.DENIZEN_PLATFORM_BRIDGE || '').toLowerCase();
  if (forced === 'true' || forced === '1') {
    return { enabled: true, mode: 'forced', reason: null };
  }
  if (forced === 'false' || forced === '0') {
    return {
      enabled: false,
      mode: 'nas',
      reason: 'DENIZEN_PLATFORM_BRIDGE=false — CRM platform sync disabled on this host.',
    };
  }
  if (env.PLATFORM_CLIENTS_TABLE || env.PLATFORM_CMS_TABLE) {
    return { enabled: true, mode: 'env_tables', reason: null };
  }
  return {
    enabled: false,
    mode: 'nas',
    reason: 'Platform bridge migrations (000005–000014) need Dolonia cloud Supabase tables. '
      + 'On NAS-only installs, CRM runs Denizen-local; set DENIZEN_PLATFORM_BRIDGE=true on cloud.',
    skipVersions: ['20260606000005', '20260606000006', '20260606000012', '20260606000013', '20260606000014'],
  };
}

module.exports = { platformBridgeStatus };
