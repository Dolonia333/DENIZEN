#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = path.join(root, 'mcps/_shared/tools');
const targets = [
  path.join(root, 'mcps/denizen-grok/tools'),
  path.join(root, 'mcps/denizen-team/tools'),
];
for (const name of fs.readdirSync(shared)) {
  if (!name.endsWith('.json')) continue;
  const src = path.join(shared, name);
  for (const dir of targets) {
    fs.copyFileSync(src, path.join(dir, name));
    console.log('synced', name, '→', path.relative(root, dir));
  }
}
