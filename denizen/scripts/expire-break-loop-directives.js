'use strict';

/**
 * Expire cloud-supervisor "BREAK LOOP" / stale ping directives that stack
 * without close-out. Safe to run anytime (archive + outcome receipts).
 *
 * Usage (in container):
 *   node /tmp/expire-break-loop-directives.js [--apply]
 */

const APPLY = process.argv.includes('--apply');
const fs = require('fs');

const BREAK_RE = /BREAK LOOP|cross-NPC ping|Grok ping test|Cloud supervisor/i;

function main() {
  // Prefer live brains from require path that server uses
  let brains;
  try {
    // When run inside denizen-server via docker exec, load through a tiny bridge
    // that server.js does not export — fall back to reading persisted file.
    brains = null;
  } catch (_) {
    brains = null;
  }

  const path = require('path');
  const directivesPath = '/app/data/npc-directives.json';
  const archivePath = '/app/data/npc-directives-archive.jsonl';
  const ledgerPath = '/app/data/outcome-ledger.jsonl';

  if (!fs.existsSync(directivesPath)) {
    console.log(JSON.stringify({ ok: true, message: 'no directives file', apply: APPLY }));
    return;
  }

  const raw = JSON.parse(fs.readFileSync(directivesPath, 'utf8'));
  const entries = raw?.directives && typeof raw.directives === 'object' ? raw.directives : {};
  const kept = {};
  const expired = [];
  const now = Date.now();

  for (const [npc, d] of Object.entries(entries)) {
    const task = String(d?.task || '');
    const from = String(d?.from || '');
    const ageH = (now - (Number(d?.ts) || 0)) / 3600000;
    const isBreak = BREAK_RE.test(task) || BREAK_RE.test(from);
    const staleUrgent = !!d?.urgent && ageH >= 6;
    if (isBreak || staleUrgent) {
      expired.push({
        npc,
        from,
        task: task.slice(0, 120),
        age_h: Math.round(ageH * 10) / 10,
        reason: isBreak ? 'break_loop_or_supervisor' : 'stale_urgent_6h',
      });
      if (APPLY) {
        const closed = {
          ...d,
          status: 'expired',
          completed_at: now,
          result_note: isBreak
            ? 'expired: BREAK LOOP / cloud supervisor spam cleared for clean slate'
            : `expired: stale urgent ${Math.round(ageH)}h`,
        };
        fs.appendFileSync(
          archivePath,
          `${JSON.stringify({ npc, ...closed, archived_at: now })}\n`,
        );
        try {
          const receipt = {
            id: `out_exp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            ts: new Date().toISOString(),
            actor: 'expire-break-loop',
            outcome_type: 'directive.expired',
            entity_type: 'npc_directive',
            entity_key: npc,
            value_text: closed.result_note,
            value_json: { task: task.slice(0, 200), from, reason: closed.result_note },
            source: 'expire-break-loop-directives',
            pass: true,
          };
          fs.appendFileSync(ledgerPath, `${JSON.stringify(receipt)}\n`);
        } catch (_) {}
      }
    } else {
      kept[npc] = d;
    }
  }

  const report = {
    apply: APPLY,
    before: Object.keys(entries).length,
    expired_count: expired.length,
    kept_count: Object.keys(kept).length,
    expired,
  };

  if (APPLY) {
    fs.writeFileSync(directivesPath, JSON.stringify({
      version: 1,
      updated_at: now,
      directives: kept,
    }, null, 2));
  }

  fs.mkdirSync('/app/data/crm-hygiene', { recursive: true });
  fs.writeFileSync('/app/data/crm-hygiene/EXPIRE_BREAK_LOOP.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('/app/data/crm-hygiene/EXPIRE_BREAK_LOOP_DONE.txt', `${APPLY ? 'apply' : 'dry'} ok\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
