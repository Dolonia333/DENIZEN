#!/usr/bin/env node
/** Fix require/import paths after src/ reorganization (handles extensionless requires). */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..', '..');

/** old basename (no .js) -> new path under src/ (no leading ./) */
const MAP = new Map();

function walkSrc(dir, prefix = 'src') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walkSrc(p, `${prefix}/${name}`);
      continue;
    }
    if (!name.endsWith('.js')) continue;
    const base = name.replace(/\.js$/, '');
    const newPath = `${prefix}/${base}`;
    const oldPath = `src/${base}`;
    if (newPath !== oldPath) MAP.set(oldPath, newPath);
  }
}

walkSrc(join(ROOT, 'src'));

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist-build', 'dist'].includes(name)) continue;
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) walkFiles(p, out);
      else if (/\.(js|mjs|cjs|html|md)$/.test(name)) out.push(p);
    } catch {}
  }
  return out;
}

const files = [
  ...walkFiles(ROOT),
  ...walkFiles(REPO),
];

let total = 0;
for (const file of files) {
  let text = readFileSync(file, 'utf8');
  const orig = text;
  const entries = [...MAP.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldP, newP] of entries) {
    const reps = [
      [`'./${oldP}'`, `'./${newP}'`],
      [`"./${oldP}"`, `"./${newP}"`],
      [`'../${oldP}'`, `'../${newP}'`],
      [`"../${oldP}"`, `"../${newP}"`],
      [`'../../${oldP}'`, `'../../${newP}'`],
      [`"../../${oldP}"`, `"../../${newP}'`],
      [`./${oldP}.js`, `./${newP}.js`],
      [`'./${oldP}.js'`, `'./${newP}.js'`],
      [`"./${oldP}.js"`, `"./${newP}.js"`],
    ];
    for (const [from, to] of reps) {
      if (text.includes(from)) text = text.split(from).join(to);
    }
  }
  if (text !== orig) {
    writeFileSync(file, text);
    total++;
  }
}
console.log(`[fix-src-paths] updated ${total} files, ${MAP.size} module mappings`);
