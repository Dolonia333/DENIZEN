#!/usr/bin/env node
/**
 * Fix __dirname-relative paths to app root (data/, npcs/, jelly/, etc.)
 * after modules moved from src/ into src/<subdir>/.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const APP_ROOT_CHILDREN = [
  'data', 'npcs', 'jelly', 'config', 'scripts', 'reports', 'desktop',
  'infra', 'assets', 'crm', 'supabase', 'companion-extension', 'mcp-ui-inspect',
];

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function depthFromSrc(file) {
  const rel = relative(SRC, dirname(file));
  if (!rel || rel === '.') return 0;
  return rel.split(/[/\\]/).length;
}

function fixFile(file) {
  const depth = depthFromSrc(file);
  if (depth === 0) return false;

  let text = readFileSync(file, 'utf8');
  const orig = text;

  // require('../jelly/...') from subdirs → ../../jelly/
  text = text.replace(/require\((['"])\.\.\/jelly\//g, "require($1../../jelly/");

  for (const child of APP_ROOT_CHILDREN) {
    // path.join(__dirname, '..', 'data' → path.join(__dirname, '..', '..', 'data'
    const re = new RegExp(
      `path\\.join\\(__dirname, '\\.\\.', '${child}'`,
      'g',
    );
    text = text.replace(re, `path.join(__dirname, '..', '..', '${child}'`);

  // path.join(__dirname, '..', 'npcs', folder → extra ..
    const re2 = new RegExp(
      `path\\.join\\(__dirname, '\\.\\.', '${child}',`,
      'g',
    );
    text = text.replace(re2, `path.join(__dirname, '..', '..', '${child}',`);

    // denizenRoot || path.join(__dirname, '..') when in subdir
  }

  // denizenRoot fallback in subdirs
  if (depth > 0) {
    text = text.replace(
      /denizenRoot \|\| path\.join\(__dirname, '\.\.'\)/g,
      "denizenRoot || path.join(__dirname, '..', '..')",
    );
  }

  // Broken regex from denizen/ → apps/office/ rewrite
  text = text.replace(/\/technical\|apps\/office\/i/g, '/technical|denizen/i');

  if (text !== orig) {
    writeFileSync(file, text);
    return true;
  }
  return false;
}

let n = 0;
for (const f of walkJs(SRC)) {
  if (fixFile(f)) {
    n++;
    console.log('fixed', relative(ROOT, f));
  }
}
console.log(`[fix-app-root-paths] ${n} files`);
