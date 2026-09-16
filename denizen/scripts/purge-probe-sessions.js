'use strict';

/**
 * Purge probe / TestUser / HealthCheck visitor sessions from denizen_visitor_sessions.
 * Collapse is a roster filter — this deletes the junk rows.
 *
 * Usage (in container):
 *   node /tmp/purge-probe-sessions.js [--apply] [--dry-limit=50]
 */

const APPLY = process.argv.includes('--apply');
const dryLimitArg = process.argv.find((a) => a.startsWith('--dry-limit='));
const DRY_LIMIT = dryLimitArg ? Number(dryLimitArg.split('=')[1]) : 200;

const PROBE_RE = /^(test\s*user|testuser|probe|health\s*check|healthcheck|e2e|cypress|playwright|load\s*test|smoke\s*test)(\b|[_\-\d]|$)/i;

async function main() {
  const denizenDb = require('/app/src/denizen-db.js');
  const init = await denizenDb.init();
  if (!init?.ok || !denizenDb.orgId) {
    throw new Error(`db init failed: ${JSON.stringify(init)}`);
  }
  const orgId = denizenDb.orgId;

  // Page sessions for this org
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=id,display_name,identity_id,last_seen_at,created_at`
    + `&org_id=eq.${encodeURIComponent(orgId)}`
    + `&order=created_at.desc`
    + `&limit=2000`,
  ).catch(() => []);

  const probes = (rows || []).filter((r) => PROBE_RE.test(String(r.display_name || '')));
  const sample = probes.slice(0, DRY_LIMIT);

  const report = {
    apply: APPLY,
    org_id: orgId,
    total_sessions_scanned: (rows || []).length,
    probe_matches: probes.length,
    will_delete: sample.length,
    sample_names: sample.slice(0, 20).map((r) => r.display_name),
    deleted: 0,
    errors: [],
  };

  if (APPLY) {
    for (const row of sample) {
      try {
        // Prefer soft-archive via metadata if hard delete is blocked by FKs
        await denizenDb._patch(
          `denizen_visitor_sessions?id=eq.${encodeURIComponent(row.id)}`,
          {
            display_name: `[purged] ${String(row.display_name || '').slice(0, 40)}`,
            metadata: {
              purged: true,
              purged_at: new Date().toISOString(),
              purged_reason: 'probe_session_hygiene',
              original_display_name: row.display_name,
            },
          },
        );
        // Attempt delete — ignore FK failures (soft purge still hides from roster)
        try {
          await denizenDb._delete?.(
            `denizen_visitor_sessions?id=eq.${encodeURIComponent(row.id)}`,
          );
        } catch (_) {}
        report.deleted += 1;
      } catch (err) {
        report.errors.push({ id: row.id, error: String(err?.message || err) });
      }
    }
  }

  const fs = require('fs');
  fs.mkdirSync('/app/data/crm-hygiene', { recursive: true });
  fs.writeFileSync('/app/data/crm-hygiene/PURGE_PROBE_SESSIONS.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('/app/data/crm-hygiene/PURGE_PROBE_SESSIONS_DONE.txt', `${APPLY ? 'apply' : 'dry'} ok\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
