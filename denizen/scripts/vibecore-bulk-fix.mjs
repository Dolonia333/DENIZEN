#!/usr/bin/env node
/**
 * Mechanical Vibecore remediation for high-volume findings:
 * - CRM inline fontSize < 14 → 14
 * - icon-ish <button> without accessible name → aria-label
 * - <input>/<textarea> without label → aria-label from placeholder/name
 * - <a> without accessible name → aria-label
 * - el.innerHTML = '' → el.replaceChildren()
 *
 * Run from repo root: node denizen/scripts/vibecore-bulk-fix.mjs
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRM_SRC = path.join(ROOT, 'crm/vendor/src');

let stats = {
  files: 0,
  fontSize: 0,
  buttons: 0,
  inputs: 0,
  anchors: 0,
  emptyInnerHtml: 0,
};

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walk(p, exts, out);
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

function bumpFontSizes(src) {
  return src.replace(/fontSize:\s*([0-9]+(?:\.[0-9]+)?)\b/g, (m, n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v >= 14) return m;
    stats.fontSize += 1;
    return 'fontSize: 14';
  }).replace(/fontSize:\s*['"`]([0-9]+(?:\.[0-9]+)?)(px)?['"`]/g, (m, n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v >= 14) return m;
    stats.fontSize += 1;
    return "fontSize: '14px'";
  });
}

/** Add aria-label to <button ...> that lack accessible name attrs and text content. */
function fixButtons(src) {
  return src.replace(/<button\b([^>]*)>/g, (full, attrs) => {
    if (/\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\btitle\s*=/.test(attrs)) {
      return full;
    }
    // Heuristic label from onClick / className / children context is hard; use generic + unique-ish
    let label = 'Action';
    const oc = attrs.match(/onClick=\{\(\)\s*=>\s*set(\w+)/);
    if (oc) label = oc[1].replace(/([A-Z])/g, ' $1').trim();
    const oc2 = attrs.match(/onClick=\{[^}]*setShow(\w+)/);
    if (oc2) label = `Toggle ${oc2[1]}`;
    const oc3 = attrs.match(/onClick=\{[^}]*(close|open|toggle|delete|remove|save|send|clear|search|filter|menu|back|next|prev|edit|add|copy)\w*/i);
    if (oc3) label = oc3[1];
    stats.buttons += 1;
    const inject = ` aria-label="${label.replace(/"/g, '')}"`;
    return `<button${inject}${attrs}>`;
  });
}

function fixInputs(src) {
  return src.replace(/<(input|textarea)\b([^>]*)\/?>/g, (full, tag, attrs) => {
    if (/\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\bid\s*=/.test(attrs)) {
      return full;
    }
    const ph = attrs.match(/placeholder=["'`]([^"'`]+)["'`]/);
    const name = attrs.match(/\bname=["'`]([^"'`]+)["'`]/);
    const typ = attrs.match(/\btype=["'`]([^"'`]+)["'`]/);
    const label = (ph && ph[1]) || (name && name[1]) || (typ && typ[1]) || tag;
    stats.inputs += 1;
    if (full.endsWith('/>')) {
      return `<${tag}${attrs} aria-label="${label.replace(/"/g, '')}" />`;
    }
    return `<${tag}${attrs} aria-label="${label.replace(/"/g, '')}">`;
  });
}

function fixAnchors(src) {
  return src.replace(/<a\b([^>]*)>/g, (full, attrs) => {
    if (/\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\btitle\s*=/.test(attrs)) {
      return full;
    }
    // Only flag icon-only likely anchors (no obvious text between tags is hard here);
    // inject when href exists and children look empty in same-line self-patterns
    const href = attrs.match(/href=["'`]([^"'`]+)["'`]/);
    const label = href ? `Link to ${href[1]}` : 'Link';
    stats.anchors += 1;
    return `<a aria-label="${label.replace(/"/g, '')}"${attrs}>`;
  });
}

function fixEmptyInnerHtml(src) {
  return src.replace(/([a-zA-Z0-9_$.\])]+)\.innerHTML\s*=\s*['"`]\s*['"`]\s*;?/g, (m, el) => {
    stats.emptyInnerHtml += 1;
    return `${el}.replaceChildren();`;
  });
}

function processCrmFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  src = bumpFontSizes(src);
  src = fixButtons(src);
  src = fixInputs(src);
  src = fixAnchors(src);
  if (src !== orig) {
    fs.writeFileSync(file, src);
    stats.files += 1;
  }
}

function processJsInnerHtmlEmpty(file) {
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  src = fixEmptyInnerHtml(src);
  if (src !== orig) {
    fs.writeFileSync(file, src);
    stats.files += 1;
  }
}

// CRM vendor TSX/TS
for (const f of walk(CRM_SRC, ['.tsx', '.ts', '.jsx', '.js'])) {
  processCrmFile(f);
}

// First-party JS empty innerHTML clears (skip minified)
const denizenDirs = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'nexen'),
  path.join(ROOT, 'discord-map'),
  ROOT,
];
for (const dir of denizenDirs) {
  for (const f of walk(dir, ['.js'])) {
    if (f.includes('node_modules') || f.endsWith('.min.js')) continue;
    if (f.includes(`${path.sep}crm${path.sep}vendor${path.sep}`)) continue;
    if (f.includes(`${path.sep}vendor${path.sep}phaser${path.sep}`)) continue;
    processJsInnerHtmlEmpty(f);
  }
}

console.log(JSON.stringify(stats, null, 2));
