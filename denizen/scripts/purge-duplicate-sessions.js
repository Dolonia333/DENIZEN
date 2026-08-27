'use strict';

/**
 * Hard-purge duplicate denizen_visitor_sessions for zion.
 * Keeps one session per identity_id (or normalized display_name).
 *
 * Usage (in container):
 *   node /tmp/purge-duplicate-sessions.js           # dry-run
 *   node /tmp/purge-duplicate-sessions.js --apply   # delete losers
 *   node /tmp/purge-duplicate-sessions.js --apply --max-delete=200
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const INCLUDE_PROBES = process.argv.includes('--include-probes');
const maxArg = process.argv.find((a) => a.startsWith('--max-delete='));
const MAX_DELETE = maxArg ? Math.max(1, Number(maxArg.split('=')[1]) || 200) : 600;

const PROBE_RE = /^(\[purged\]\s*)?(test\s*user|testuser|probe|health\s*check|healthcheck|e2e|cypress|playwright|load\s*test|smoke\s*test)(\b|[_\-\d]|$)/i;
const OUT = '/app/data/crm-hygiene';

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function scoreSession(row, { primaryIds, assistantSessions }) {
  let score = 0;
  if (primaryIds.has(row.id)) score += 1000;
  if (assistantSessions.has(row.id)) score += 500;
  const seen = Date.parse(row.last_seen_at || '') || 0;
  score += Math.min(400, Math.floor(seen / 1e10)); // prefer recent
  if (row.identity_id) score += 50;
  if (row.session_token_hash) score += 10;
  return score;
}

async function main() {
  const denizenDb = require('/app/src/denizen-db.js');
  const init = await denizenDb.init();
  if (!init?.ok || !denizenDb.orgId) {
    throw new Error(`db init failed: ${JSON.stringify(init)}`);
  }
  const orgId = denizenDb.orgId;

  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=id,display_name,identity_id,last_seen_at,created_at,session_token_hash,metadata`
    + `&org_id=eq.${encodeURIComponent(orgId)}`
    + `&order=last_seen_at.desc.nullslast`
    + `&limit=2000`,
  ).catch(() => []);

  const identities = await denizenDb._get(
    `denizen_user_identities?select=id,primary_session_id,display_name`
    + `&org_id=eq.${encodeURIComponent(orgId)}`
    + `&limit=500`,
  ).catch(() => []);

  const primaryIds = new Set(
    (identities || []).map((i) => i.primary_session_id).filter(Boolean),
  );

  const assistants = await denizenDb._get(
    `denizen_user_assistants?select=session_id,npc_key&limit=2000`,
  ).catch(() => []);
  const assistantSessions = new Set(
    (assistants || []).map((a) => a.session_id).filter(Boolean),
  );

  const groups = new Map();
  let probeSkipped = 0;
  for (const row of rows || []) {
    const name = String(row.display_name || '');
    if (!INCLUDE_PROBES && PROBE_RE.test(name)) {
      probeSkipped += 1;
      continue;
    }
    const key = row.identity_id
      ? `id:${row.identity_id}`
      : `name:${normName(name) || row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const keepers = [];
  const losers = [];
  for (const [key, list] of groups.entries()) {
    if (list.length < 2) {
      if (list[0]) keepers.push({ key, session: list[0], alone: true });
      continue;
    }
    const ranked = [...list].sort(
      (a, b) => scoreSession(b, { primaryIds, assistantSessions })
        - scoreSession(a, { primaryIds, assistantSessions }),
    );
    const keeper = ranked[0];
    keepers.push({ key, session: keeper, alone: false, group_size: list.length });
    for (const loser of ranked.slice(1)) {
      losers.push({
        key,
        keeper_id: keeper.id,
        loser_id: loser.id,
        display_name: loser.display_name,
        identity_id: loser.identity_id,
        last_seen_at: loser.last_seen_at,
        score: scoreSession(loser, { primaryIds, assistantSessions }),
      });
    }
  }

  const toDelete = losers.slice(0, MAX_DELETE);
  const report = {
    apply: APPLY,
    org_id: orgId,
    scanned: (rows || []).length,
    groups: groups.size,
    probe_skipped: probeSkipped,
    keepers: keepers.filter((k) => !k.alone).length,
    alone: keepers.filter((k) => k.alone).length,
    losers_found: losers.length,
    will_delete: toDelete.length,
    max_delete: MAX_DELETE,
    sample_losers: toDelete.slice(0, 25).map((l) => ({
      name: l.display_name,
      loser: l.loser_id,
      keeper: l.keeper_id,
    })),
    remapped_primary: 0,
    remapped_assistants: 0,
    remapped_mcp_tokens: 0,
    deleted: 0,
    errors: [],
  };

  if (APPLY && toDelete.length) {
    // Remap identity primary_session_id away from losers
    for (const L of toDelete) {
      try {
        if (L.identity_id) {
          await denizenDb._patch(
            `denizen_user_identities?id=eq.${encodeURIComponent(L.identity_id)}`
            + `&primary_session_id=eq.${encodeURIComponent(L.loser_id)}`,
            { primary_session_id: L.keeper_id },
          );
          report.remapped_primary += 1;
        }
      } catch (err) {
        report.errors.push({ step: 'remap_primary', id: L.loser_id, error: String(err?.message || err) });
      }
      try {
        await denizenDb._patch(
          `denizen_user_assistants?session_id=eq.${encodeURIComponent(L.loser_id)}`,
          { session_id: L.keeper_id },
        );
        report.remapped_assistants += 1;
      } catch (_) { /* may be none */ }
      try {
        await denizenDb._patch(
          `denizen_mcp_tokens?session_id=eq.${encodeURIComponent(L.loser_id)}`,
          { session_id: L.keeper_id },
        );
        report.remapped_mcp_tokens += 1;
      } catch (_) { /* may be none */ }
    }

    // Delete one-by-one (PostgREST in.() encoding is brittle for UUID batches)
    for (const L of toDelete) {
      try {
        await denizenDb._delete(
          `denizen_visitor_sessions?id=eq.${encodeURIComponent(L.loser_id)}`,
        );
        report.deleted += 1;
      } catch (e2) {
        report.errors.push({ step: 'delete', id: L.loser_id, error: String(e2?.message || e2) });
      }
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUT, `PURGE_DUP_SESSIONS_${APPLY ? 'apply' : 'dry'}-${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'PURGE_DUP_SESSIONS_LATEST.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'PURGE_DUP_SESSIONS_DONE.txt'), `${APPLY ? 'apply' : 'dry'} ok deleted=${report.deleted}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
