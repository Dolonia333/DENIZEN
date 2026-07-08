#!/usr/bin/env node
/**
 * Run Denizen unit tests via node:test, excluding crm/vendor Vitest suites.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function collectTests(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (/\.test\.(js|cjs|mjs)$/.test(name)) out.push(p);
      continue;
    }
    if (name === 'node_modules' || name === 'e2e') continue;
    collectTests(p, out);
  }
  return out;
}

const files = [
  ...collectTests(join(root, 'tests')),
  ...collectTests(join(root, 'desktop', 'tests')),
].sort();

if (!files.length) {
  console.error('[run-tests] no test files found');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...files],
  { stdio: 'inherit', cwd: root, shell: false },
);

process.exit(result.status ?? 1);
