#!/usr/bin/env node
/** Update test files that list flat src/*.js paths to use new folder layout. */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const INDEX = new Map();
function index(dir, prefix = '') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      index(p, prefix ? `${prefix}/${name}` : name);
      continue;
    }
    if (name.endsWith('.js')) INDEX.set(name, prefix ? `${prefix}/${name}` : name);
  }
}
index(SRC);

function resolve(basename) {
  const withJs = basename.endsWith('.js') ? basename : `${basename}.js`;
  return INDEX.get(withJs) || basename;
}

const testFile = join(ROOT, 'tests', 'visitor-complete.test.js');
let text = readFileSync(testFile, 'utf8');

// Add resolver helper after SRC constant
if (!text.includes('function resolveSrcModule')) {
  text = text.replace(
    "const SRC = path.join(ROOT, 'src');\n",
    `const SRC = path.join(ROOT, 'src');

/** Resolve module basename to path relative to src/ after folder reorg. */
const SRC_MODULE_INDEX = ${JSON.stringify(Object.fromEntries(INDEX), null, 2)};
function resolveSrcModule(file) {
  const base = file.endsWith('.js') ? file : file + '.js';
  return SRC_MODULE_INDEX[base] || file;
}
`,
  );
}

text = text.replace(
  /path\.join\(SRC, file\)/g,
  'path.join(SRC, resolveSrcModule(file))',
);

writeFileSync(testFile, text);
console.log('[fix-test-paths] updated visitor-complete.test.js');
