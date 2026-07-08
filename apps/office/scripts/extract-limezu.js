#!/usr/bin/env node
/**
 * extract-limezu.js
 *
 * Selectively unzips LimeZu asset packs into apps/office/assets/limezu/
 * based on data/limezu-manifest.json.
 *
 * Usage:
 *   node scripts/extract-limezu.js            # full extract
 *   node scripts/extract-limezu.js --dry-run  # list what would be extracted
 *   node scripts/extract-limezu.js gym        # only entries whose dest contains 'gym'
 *
 * The manifest supports // line comments (stripped before JSON.parse).
 * Entries with "glob": true extract an entire zip directory as a batch.
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '..');
const MANIFEST     = path.join(ROOT, 'data', 'limezu-manifest.json');
const DRY_RUN      = process.argv.includes('--dry-run');
// Any non-flag arg after the script path is treated as a category filter
const FILTER       = process.argv.slice(2).find(a => !a.startsWith('-')) || null;

// ── Load manifest (strip // comments — JSON doesn't support them natively) ───

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST, 'utf-8');
  // Strip single-line // comments (not inside strings — simple heuristic fine here)
  const stripped = raw
    .split('\n')
    .map(line => line.replace(/\s*\/\/.*$/, ''))
    .join('\n');
  return JSON.parse(stripped);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const IS_WIN = process.platform === 'win32';

/** Escape a path for use inside a PowerShell single-quoted string. */
function psq(s) {
  return String(s).replace(/'/g, "''");
}

function zipContainsEntry(zipPath, entry) {
  if (IS_WIN) {
    try {
      const ps = [
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$z=[IO.Compression.ZipFile]::OpenRead('${psq(zipPath)}')`,
        `$ok=($z.Entries | Where-Object { $_.FullName -eq '${psq(entry)}' }).Count -gt 0`,
        '$z.Dispose()',
        'if ($ok) { exit 0 } else { exit 1 }',
      ].join('; ');
      execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
      return true;
    } catch (_) {
      return false;
    }
  }
  try {
    const result = execSync(
      `unzip -l "${zipPath}" "${entry}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.includes(entry);
  } catch (_) {
    return false;
  }
}

/**
 * Extract a single file from a zip into destPath.
 * Uses PowerShell ZipFile on Windows; unzip -p elsewhere.
 */
function extractOne(zipPath, src, destPath) {
  ensureDir(path.dirname(destPath));
  if (IS_WIN) {
    try {
      const ps = [
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$z=[IO.Compression.ZipFile]::OpenRead('${psq(zipPath)}')`,
        `$e=$z.Entries | Where-Object { $_.FullName -eq '${psq(src)}' }`,
        'if (-not $e) { $z.Dispose(); exit 2 }',
        `[IO.Compression.ZipFileExtensions]::ExtractToFile($e,'${psq(destPath)}',$true)`,
        '$z.Dispose()',
      ].join('; ');
      execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
      return true;
    } catch (err) {
      console.error(`  ✗ failed: ${src} → ${err.message?.slice(0, 80)}`);
      return false;
    }
  }
  try {
    const data = execSync(`unzip -p "${zipPath}" "${src}"`, { maxBuffer: 50 * 1024 * 1024 });
    fs.writeFileSync(destPath, data);
    return true;
  } catch (err) {
    console.error(`  ✗ failed: ${src} → ${err.message?.slice(0, 80)}`);
    return false;
  }
}

/**
 * Extract an entire directory from a zip into destDir.
 * Uses `unzip -j` (junk paths) so files land flat in destDir.
 * Optional filter = only extract filenames containing the filter string.
 */
function extractDirWin(zipPath, srcDir, destDir, filter) {
  ensureDir(destDir);
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `limezu-extract-${process.pid}.ps1`);
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z = [IO.Compression.ZipFile]::OpenRead('${psq(zipPath)}')`,
    `$prefix = '${psq(srcDir)}'`,
    `$filter = '${psq(filter || '')}'`,
    '$n = 0',
    'foreach ($e in $z.Entries) {',
    '  if (-not $e.FullName.StartsWith($prefix)) { continue }',
    '  if (-not $e.FullName.EndsWith(".png")) { continue }',
    '  if ($filter -and $e.FullName -notlike "*$filter*") { continue }',
    `  $out = Join-Path '${psq(destDir)}' (Split-Path $e.FullName -Leaf)`,
    '  if (-not (Test-Path $out)) {',
    '    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $out, $false)',
    '  }',
    '  $n++',
    '}',
    '$z.Dispose()',
    'Write-Output $n',
  ].join('\n');
  try {
    fs.writeFileSync(tmp, script, 'utf8');
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`,
      { encoding: 'utf-8' }
    );
    const n = parseInt(String(out).trim().split(/\r?\n/).pop(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function extractDir(zipPath, srcDir, destDir, filter) {
  ensureDir(destDir);
  if (IS_WIN) {
    return extractDirWin(zipPath, srcDir, destDir, filter);
  }

  // unzip glob patterns must NOT be shell-quoted when passed via spawn-style exec,
  // but execSync uses /bin/sh so we need careful escaping.
  // Strategy: use `unzip -o -j zipfile 'srcDir*' -d destDir`
  // The single-quotes around the glob prevent shell expansion, letting unzip handle it.
  const pattern = filter
    ? `'${srcDir}*${filter}*'`
    : `'${srcDir}*'`;

  try {
    const cmd = [
      'unzip', '-o', '-j',
      `"${zipPath}"`,
      pattern,
      `-d "${destDir}"`,
    ].join(' ');

    execSync(cmd, { maxBuffer: 200 * 1024 * 1024, shell: '/bin/bash',
                    stdio: ['pipe', 'pipe', 'pipe'] });
    const files = fs.readdirSync(destDir).filter(f => f.endsWith('.png'));
    return files.length;
  } catch (err) {
    const msg = err.message?.slice(0, 100) || '';
    const stderr = (err.stderr || '').toString().slice(0, 100);
    // Exit code 11 = no files matched — not a real error
    if (err.status === 11) return 0;
    // Try alternate approach: pipe through grep to filter entries, then unzip each
    return extractDirFallback(zipPath, srcDir, destDir, filter);
  }
}

/**
 * Fallback directory extractor: list zip contents, filter to matching paths,
 * extract each file individually. Slower but works when glob quoting fails.
 */
function extractDirFallback(zipPath, srcDir, destDir, filter) {
  ensureDir(destDir);
  try {
    const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    const lines = listing.split('\n');
    const entries = lines
      .map(l => l.trim().split(/\s+/).slice(-1)[0])
      .filter(p => p && p.startsWith(srcDir) && p.endsWith('.png'))
      .filter(p => !filter || p.includes(filter));

    let count = 0;
    for (const entry of entries) {
      const filename = path.basename(entry);
      const destPath = path.join(destDir, filename);
      if (fs.existsSync(destPath)) { count++; continue; }
      try {
        const data = execSync(`unzip -p "${zipPath}" "${entry}"`,
          { maxBuffer: 10 * 1024 * 1024 });
        fs.writeFileSync(destPath, data);
        count++;
      } catch (_) {}
    }
    return count;
  } catch (_) {
    return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const manifest = loadManifest();
  const outBase  = path.join(ROOT, manifest.outputBase);
  const sources  = manifest.sources;

  console.log(`\n╔══ LimeZu Asset Extractor ══════════════════════════╗`);
  console.log(`║  Output: ${outBase}`);
  if (DRY_RUN)  console.log(`║  Mode:   DRY RUN — nothing written`);
  if (FILTER)   console.log(`║  Filter: "${FILTER}"`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);

  ensureDir(outBase);

  let ok = 0, skip = 0, fail = 0;
  const entries = manifest.extract.filter(e => {
    if (!FILTER) return true;
    return e.dest.toLowerCase().includes(FILTER.toLowerCase());
  });

  for (const entry of entries) {
    const zipPath = sources[entry.zip];
    if (!zipPath || !fs.existsSync(zipPath)) {
      console.warn(`  ⚠ zip not found: ${entry.zip} → ${zipPath}`);
      skip++;
      continue;
    }

    const destFull = path.join(outBase, entry.dest);

    // ── Directory / glob extract ──────────────────────────────────────────
    if (entry.glob) {
      const label = `[dir] ${entry.zip}:${entry.src}${entry.filter ? `*${entry.filter}*` : ''} → ${entry.dest}`;
      if (DRY_RUN) {
        console.log(`  » ${label}`);
        ok++;
        continue;
      }
      const count = extractDir(zipPath, entry.src, destFull, entry.filter || null);
      if (count > 0) {
        console.log(`  ✓ ${label} (${count} files)`);
        ok++;
      } else {
        console.warn(`  ⚠ ${label} (0 files — check path)`);
        skip++;
      }
      continue;
    }

    // ── Single file extract ───────────────────────────────────────────────
    const label = `${entry.zip}:${path.basename(entry.src)} → ${entry.dest}`;

    // Skip if already exists (use --dry-run to force a listing)
    if (!DRY_RUN && fs.existsSync(destFull)) {
      console.log(`  ─ exists  ${label}`);
      skip++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  » ${label}`);
      ok++;
      continue;
    }

    const success = extractOne(zipPath, entry.src, destFull);
    if (success) {
      const bytes = fs.statSync(destFull).size;
      const kb    = (bytes / 1024).toFixed(1);
      console.log(`  ✓ ${label}  (${kb} KB)`);
      ok++;
    } else {
      fail++;
    }
  }

  console.log(`\n── Summary ──────────────────────────────────────────`);
  console.log(`   ✓ extracted: ${ok}`);
  console.log(`   ─ skipped:   ${skip}`);
  console.log(`   ✗ failed:    ${fail}`);
  console.log(`────────────────────────────────────────────────────\n`);

  if (!DRY_RUN && ok > 0) {
    // Write an index of what landed so Phaser preloader can scan it
    writeIndex(outBase);
  }
}

/**
 * Write assets/limezu/index.json listing every extracted file
 * by category for easy Phaser preloading.
 */
function writeIndex(outBase) {
  const index = {};
  function scan(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel  = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) {
        scan(full, rel);
      } else if (name.endsWith('.png') || name.endsWith('.gif')) {
        const category = rel.split('/')[0];
        if (!index[category]) index[category] = [];
        index[category].push(rel);
      }
    }
  }
  scan(outBase, '');
  const indexPath = path.join(outBase, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  const total = Object.values(index).reduce((n, a) => n + a.length, 0);
  console.log(`  📋 index written: ${indexPath} (${total} assets across ${Object.keys(index).length} categories)\n`);
}

main();
