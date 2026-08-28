#!/usr/bin/env node
/**
 * Merge per-sheet vision labels into a flat registry + update limezu-labels hints.
 *
 *   node scripts/merge-limezu-visual-catalog.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CAT = path.join(ROOT, 'data', 'limezu-visual-catalog');
const OUT_JSONL = path.join(CAT, 'registry.jsonl');
const OUT_SUMMARY = path.join(CAT, 'registry-summary.json');

function main() {
  const sheetsDir = path.join(CAT, 'sheets');
  const rows = [];
  const bySheet = {};

  for (const name of fs.readdirSync(sheetsDir).sort()) {
    const labelsPath = path.join(sheetsDir, name, 'labels.json');
    if (!fs.existsSync(labelsPath)) continue;
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    const objects = Array.isArray(labels.objects) ? labels.objects : [];
    bySheet[name] = {
      sheet: labels.sheet || name,
      pack: labels.pack || null,
      object_count: objects.length,
      categories: {},
    };
    for (const obj of objects) {
      const cat = obj.category || 'unknown';
      bySheet[name].categories[cat] = (bySheet[name].categories[cat] || 0) + 1;
      rows.push({
        ...obj,
        sheet: labels.sheet || name,
        pack: labels.pack || 'limezu_modern_exteriors',
      });
    }
  }

  fs.writeFileSync(OUT_JSONL, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const summary = {
    generated_at: new Date().toISOString(),
    sheet_count: Object.keys(bySheet).length,
    object_count: rows.length,
    by_sheet: bySheet,
    by_category: rows.reduce((acc, r) => {
      const c = r.category || 'unknown';
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {}),
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(`wrote ${rows.length} objects from ${summary.sheet_count} sheets`);
  console.log('categories', summary.by_category);
}

main();
