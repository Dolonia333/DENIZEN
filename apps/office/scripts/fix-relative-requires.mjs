#!/usr/bin/env node
/**
 * Fix relative require('./foo') paths inside src/ after folder moves.
 * Resolves by module basename across the whole src tree.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** basename (no ext) -> absolute path */
const MODULE_INDEX = new Map();

function indexDir(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      indexDir(p);
      continue;
    }
    if (!name.endsWith('.js')) continue;
    const key = name.replace(/\.js$/, '');
    if (!MODULE_INDEX.has(key)) MODULE_INDEX.set(key, p);
  }
}

indexDir(SRC);

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const REQ_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function fixFile(file) {
  let text = readFileSync(file, 'utf8');
  const dir = dirname(file);
  let changed = false;

  text = text.replace(REQ_RE, (full, rel) => {
    const target = join(dir, rel);
    const tryPaths = [target, `${target}.js`, join(target, 'index.js')];
    const exists = tryPaths.some((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (exists) return full;

    const base = basename(rel).replace(/\.js$/, '');
    const resolved = MODULE_INDEX.get(base);
    if (!resolved) return full;

    let newRel = relative(dir, resolved).replace(/\\/g, '/');
    if (!newRel.startsWith('.')) newRel = `./${newRel}`;
    newRel = newRel.replace(/\.js$/, '');
    changed = true;
    return `require('${newRel}')`;
  });

  if (changed) writeFileSync(file, text);
  return changed;
}

let n = 0;
for (const f of walkJs(SRC)) {
  if (fixFile(f)) {
    n++;
    console.log('fixed', relative(ROOT, f));
  }
}
// Also fix tests and server.js
for (const extra of [join(ROOT, 'server.js'), ...walkJs(join(ROOT, 'tests'))]) {
  if (fixFile(extra)) {
    n++;
    console.log('fixed', relative(ROOT, extra));
  }
}
console.log(`[fix-relative-requires] ${n} files`);
