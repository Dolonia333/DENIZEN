#!/usr/bin/env node

/**
 * Build a deterministic Denizen source release from a clean Git commit.
 *
 * The archive never reads uncommitted working-tree content. It refuses a dirty
 * `denizen/` tree, archives the committed application tree, normalizes the gzip
 * timestamp, and writes a stable manifest plus SHA-256 checksum.
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createGzip, constants as zlibConstants } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || appRoot,
    encoding: options.encoding ?? 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const gitRoot = run('git', ['rev-parse', '--show-toplevel']);
const appPathspec = relative(gitRoot, appRoot).split(sep).join('/');
if (!appPathspec || appPathspec.startsWith('..')) {
  throw new Error(`Application root ${appRoot} is not inside Git root ${gitRoot}`);
}

const dirty = run('git', [
  'status', '--porcelain', '--untracked-files=all', '--', appPathspec,
], { cwd: gitRoot });
if (dirty) {
  console.error('[release] refusing to archive a dirty application tree:');
  console.error(dirty);
  console.error('[release] commit or stash the listed files, then run again.');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const commit = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot });
const shortCommit = commit.slice(0, 12);
const tree = run('git', ['rev-parse', `HEAD:${appPathspec}`], { cwd: gitRoot });
const commitDate = run('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: gitRoot });
const outputDir = resolve(argumentValue('--output-dir') || join(appRoot, 'out', 'releases'));
const releaseName = argumentValue('--name') || `denizen-v${pkg.version}-${shortCommit}`;
const tarPath = join(outputDir, `.${releaseName}.tar`);
const archivePath = join(outputDir, `${releaseName}.tar.gz`);
const manifestPath = join(outputDir, `${releaseName}.manifest.json`);
const checksumPath = join(outputDir, `${releaseName}.sha256`);

mkdirSync(outputDir, { recursive: true });
rmSync(tarPath, { force: true });
rmSync(archivePath, { force: true });

run('git', [
  'archive',
  '--format=tar',
  `--prefix=denizen/`,
  `--output=${tarPath}`,
  `${commit}:${appPathspec}`,
], { cwd: gitRoot });

await pipeline(
  createReadStream(tarPath),
  createGzip({
    level: zlibConstants.Z_BEST_COMPRESSION,
    mtime: 0,
  }),
  createWriteStream(archivePath),
);
rmSync(tarPath, { force: true });

const digest = await sha256(archivePath);
const manifest = {
  schema: 1,
  name: releaseName,
  version: pkg.version,
  commit,
  denizen_tree: tree,
  commit_date: commitDate,
  archive: `${releaseName}.tar.gz`,
  sha256: digest,
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(checksumPath, `${digest}  ${releaseName}.tar.gz\n`, 'utf8');

console.log(`[release] archive  ${archivePath}`);
console.log(`[release] manifest ${manifestPath}`);
console.log(`[release] sha256   ${digest}`);
console.log(`[release] source   ${commit} (${tree})`);
