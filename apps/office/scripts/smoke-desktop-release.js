'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_PKG = path.join(ROOT, 'desktop', 'package.json');
const WORKFLOW = path.resolve(ROOT, '..', '.github', 'workflows', 'desktop-release.yml');
const AUTO_UPDATER = path.join(ROOT, 'desktop', 'auto-updater.js');
const CRASH_REPORTER = path.join(ROOT, 'desktop', 'crash-reporter.js');
const FEEDBACK_SMOKE = path.join(__dirname, 'smoke-desktop-feedback.js');

function fail(reasons, msg) {
  reasons.push(msg);
  return false;
}

function checkPackageJson(reasons) {
  if (!fs.existsSync(DESKTOP_PKG)) {
    return fail(reasons, 'missing desktop/package.json');
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(DESKTOP_PKG, 'utf8'));
  } catch (err) {
    return fail(reasons, `desktop/package.json invalid JSON: ${err.message}`);
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['electron-updater']) {
    fail(reasons, 'desktop/package.json missing electron-updater dependency');
  }

  const scripts = pkg.scripts || {};
  if (!scripts['build:mac']) {
    fail(reasons, 'desktop/package.json missing scripts.build:mac');
  }
  if (!scripts['build:linux']) {
    fail(reasons, 'desktop/package.json missing scripts.build:linux');
  }

  const publish = pkg.build && pkg.build.publish;
  const publishList = Array.isArray(publish) ? publish : publish ? [publish] : [];
  const hasGithubRelease = publishList.some((entry) => {
    return entry?.provider === 'github'
      && entry?.owner === 'Dolonia333'
      && entry?.repo === 'DENIZEN';
  });
  if (!hasGithubRelease) {
    fail(reasons, 'desktop/package.json missing GitHub Releases publish configuration');
  }

  return true;
}

function checkFiles(reasons) {
  let ok = true;
  for (const [label, filePath] of [
    ['desktop-release workflow', WORKFLOW],
    ['auto-updater.js', AUTO_UPDATER],
    ['crash-reporter.js', CRASH_REPORTER],
  ]) {
    if (!fs.existsSync(filePath)) {
      fail(reasons, `missing ${label}: ${path.relative(ROOT, filePath)}`);
      ok = false;
    }
  }
  return ok;
}

function checkWorkflow(reasons) {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  for (const job of ['build-win:', 'build-linux:', 'build-mac:']) {
    if (!workflow.includes(job)) fail(reasons, `desktop release workflow missing ${job.slice(0, -1)} job`);
  }
  if (!workflow.includes("- 'v0.*'")) {
    fail(reasons, 'desktop release workflow must use semver-compatible desktop v0.* tags');
  }
  if (!workflow.includes('merge-multiple: true')) {
    fail(reasons, 'desktop release workflow does not merge platform artifacts');
  }
  if ((workflow.match(/--publish never/g) || []).length !== 3) {
    fail(reasons, 'desktop release workflow must prevent electron-builder from publishing inside build jobs');
  }
}

function runFeedbackSmoke(reasons) {
  const baseUrl = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';
  const child = spawnSync(process.execPath, [FEEDBACK_SMOKE], {
    cwd: ROOT,
    env: { ...process.env, DENIZEN_URL: baseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (child.error) {
    fail(reasons, `feedback smoke spawn error: ${child.error.message}`);
    return false;
  }
  if (child.status !== 0) {
    const tail = (child.stdout || child.stderr || '').trim().split(/\r?\n/).slice(-6).join('\n');
    fail(reasons, `feedback smoke failed (exit ${child.status})${tail ? `\n${tail}` : ''}`);
    return false;
  }
  return true;
}

function main() {
  const reasons = [];
  checkPackageJson(reasons);
  if (checkFiles(reasons)) checkWorkflow(reasons);
  runFeedbackSmoke(reasons);

  const ready = reasons.length === 0;
  for (const reason of reasons) {
    console.log(`FAIL ${reason}`);
  }
  console.log(`RELEASE_READY ${ready}`);
  process.exit(ready ? 0 : 1);
}

main();
