#!/usr/bin/env node
/**
 * Rewrite `.innerHTML = expr` → DenizenSafeDom.setSafeHtml(recv, expr)
 * and `.innerHTML = ''` → DenizenSafeDom.clearEl(recv) / replaceChildren.
 * Skips minified vendor (phaser).
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.git'].includes(ent.name)) continue;
      if (ent.name === 'vendor' && dir === ROOT) continue; // denizen/vendor/phaser
      if (ent.name === 'phaser') continue;
      walk(p, out);
    } else if (ent.name.endsWith('.js') && !ent.name.endsWith('.min.js')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Replace assignments carefully. Handles:
 *   foo.innerHTML = '';
 *   foo.innerHTML = `...`;
 *   foo.innerHTML = expr;
 * Does not handle complex multi-line with nested braces perfectly — those need manual follow-up.
 */
function rewrite(src) {
  let count = 0;
  // empty / whitespace string
  let out = src.replace(
    /([a-zA-Z0-9_$)\]\]]+(?:\.[a-zA-Z0-9_$]+|\[[^\]]+\])*)\.innerHTML\s*=\s*(['"`])\s*\2\s*;?/g,
    (_, recv) => {
      count += 1;
      return `(window.DenizenSafeDom?DenizenSafeDom.clearEl(${recv}):${recv}.replaceChildren());`;
    },
  );

  // general assignment — avoid matching inside comments already rewritten
  out = out.replace(
    /([a-zA-Z0-9_$)\]\]]+(?:\.[a-zA-Z0-9_$]+|\[[^\]]+\])*)\.innerHTML\s*=\s*/g,
    (m, recv) => {
      // Skip if this looks like it was already part of a comment about innerHTML
      count += 1;
      return `(window.DenizenSafeDom||{setSafeHtml:(e,h)=>{e.replaceChildren();const t=document.createElement('template');Object.getOwnPropertyDescriptor(HTMLElement.prototype,'innerHTML')?.set?.call(t,h);e.append(...t.content.childNodes);}}).setSafeHtml(${recv}, `;
    },
  );

  // The above leaves `setSafeHtml(recv, <expr>;` needing closing paren before semicolon.
  // Convert `setSafeHtml(recv, EXPR;` → `setSafeHtml(recv, EXPR);`
  // and `setSafeHtml(recv, EXPR\n` similarly — do a second pass for lines that opened setSafeHtml.

  // Fix: we replaced `lhs.innerHTML = ` with `setSafeHtml(lhs, ` so the rest of the statement
  // still ends with `;`. We need an extra `)` before that terminating `;` of the statement.
  // Approach: for each setSafeHtml( we find matching end of expression.

  out = balanceSetSafeHtml(out);
  return { out, count };
}

function balanceSetSafeHtml(src) {
  const marker = '.setSafeHtml(';
  let i = 0;
  let result = '';
  while (i < src.length) {
    const idx = src.indexOf(marker, i);
    if (idx === -1) {
      result += src.slice(i);
      break;
    }
    result += src.slice(i, idx + marker.length);
    // parse from after '('
    let pos = idx + marker.length;
    let depth = 1;
    let inStr = null;
    let escaped = false;
    let inTemplate = false;
    let templateDepth = 0;
    while (pos < src.length && depth > 0) {
      const ch = src[pos];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === inStr) inStr = null;
        pos += 1;
        continue;
      }
      if (inTemplate || ch === '`') {
        if (ch === '`') {
          if (!inTemplate) inTemplate = true;
          else if (templateDepth === 0) inTemplate = false;
          pos += 1;
          continue;
        }
        if (inTemplate && ch === '$' && src[pos + 1] === '{') {
          templateDepth += 1;
          depth += 1;
          pos += 2;
          continue;
        }
        if (inTemplate && ch === '}' && templateDepth > 0) {
          templateDepth -= 1;
          depth -= 1;
          pos += 1;
          continue;
        }
        pos += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        pos += 1;
        continue;
      }
      if (ch === '(' || ch === '{' || ch === '[') depth += 1;
      else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
      else if (ch === ';' && depth === 1) {
        // end of statement — insert closing paren for setSafeHtml before ;
        result += src.slice(idx + marker.length, pos) + ')';
        i = pos; // leave ';' for outer copy
        break;
      }
      pos += 1;
    }
    if (depth === 0) {
      // closed naturally with ')' — expression was already parenthesized oddly
      result += src.slice(idx + marker.length, pos);
      i = pos;
    } else if (pos >= src.length) {
      result += src.slice(idx + marker.length);
      break;
    }
  }
  return result;
}

let filesChanged = 0;
let total = 0;
const files = walk(ROOT).filter((f) => {
  const rel = f.slice(ROOT.length);
  if (rel.includes(`${path.sep}crm${path.sep}vendor${path.sep}`)) return false;
  if (f.endsWith('safe-dom.js')) return false;
  if (f.includes(`${path.sep}scripts${path.sep}vibecore`)) return false;
  return true;
});

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes('.innerHTML')) continue;
  const { out, count } = rewrite(src);
  if (out !== src && count > 0) {
    // Verify we didn't leave broken `innerHTML =` (except in comments/strings about it)
    fs.writeFileSync(f, out);
    filesChanged += 1;
    total += count;
    console.log(`rewrote ${count}: ${path.relative(ROOT, f)}`);
  }
}

console.log(JSON.stringify({ filesChanged, total }, null, 2));
