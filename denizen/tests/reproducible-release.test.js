'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

it('source release normalizes both tar and gzip timestamps', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'build-reproducible-release.mjs'),
    'utf8',
  );
  assert.match(source, /`--mtime=\${commitDate}`/);
  assert.match(source, /createGzip\(\{[\s\S]*?mtime:\s*0/);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/);
});
