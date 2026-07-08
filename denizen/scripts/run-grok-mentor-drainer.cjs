#!/usr/bin/env node
'use strict';

/**
 * CLI entry for grok-mentor-drainer (dry-run by default).
 *
 *   node scripts/run-grok-mentor-drainer.mjs           # dry run
 *   node scripts/run-grok-mentor-drainer.mjs --run     # answer + inject + mark
 *   node scripts/run-grok-mentor-drainer.mjs --run --limit 3
 */

const drainer = require('../src/grok-mentor-drainer');

const args = process.argv.slice(2);
const run = args.includes('--run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 5;

drainer.drainConsultQueue({ run, limit }).then((summary) => {
  const mode = summary.dryRun ? 'DRY RUN' : 'RUN';
  console.log(`[grok-mentor-drainer] ${mode} — pending seen: ${summary.pending}, processed: ${summary.processed}, skipped: ${summary.skipped}`);
  for (const d of summary.details) {
    console.log(`  ${d.npc || '?'}: ${d.status}${d.reason ? ` (${d.reason})` : ''}${d.preview ? ` — ${d.preview}` : ''}`);
  }
  process.exit(0);
}).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
