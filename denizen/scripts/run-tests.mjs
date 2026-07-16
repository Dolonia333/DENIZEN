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

const parsedTimeout = Number(process.env.DENIZEN_TEST_FILE_TIMEOUT_MS);
const fileTimeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
  ? parsedTimeout
  : 30_000;

function tapCount(output, label) {
  const matches = [...String(output || '').matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gm'))];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
const failures = [];
const startedAt = Date.now();

console.log(`[run-tests] ${files.length} files, serial isolation, ${fileTimeoutMs}ms/file timeout`);

for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const relative = file.slice(root.length + 1);
  const fileStartedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ['--test', file],
    {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: fileTimeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const elapsedMs = Date.now() - fileStartedAt;
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const ok = !timedOut && result.status === 0;

  for (const key of Object.keys(totals)) totals[key] += tapCount(output, key);

  const progress = `${String(index + 1).padStart(String(files.length).length, '0')}/${files.length}`;
  if (ok) {
    const count = tapCount(output, 'tests');
    console.log(`[${progress}] PASS ${relative} (${count} tests, ${elapsedMs}ms)`);
    continue;
  }

  const kind = timedOut ? `TIMEOUT>${fileTimeoutMs}ms` : `EXIT ${result.status ?? 'unknown'}`;
  failures.push({ relative, kind, output });
  console.error(`[${progress}] FAIL ${relative} (${kind}, ${elapsedMs}ms)`);
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n===== ${failure.relative} — ${failure.kind} =====\n`);
    console.error(failure.output.trim() || '(no test output)');
  }
}

const elapsedMs = Date.now() - startedAt;
console.log(
  `[run-tests] files=${files.length - failures.length}/${files.length} `
  + `tests=${totals.pass}/${totals.tests} failed=${totals.fail} `
  + `skipped=${totals.skipped} todo=${totals.todo} elapsed=${elapsedMs}ms`,
);

process.exit(failures.length ? 1 : 0);
