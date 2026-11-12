'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const liveInfra = require('../src/live-infra-brief');
const {
  setupDirectWorktree,
  collectDirectDiff,
} = require('../src/coding-task-runner');

describe('live-infra-brief', () => {
  it('formatSnapshot includes LM and bridge lines', () => {
    const text = liveInfra.formatSnapshot({
      directSupabase: true,
      report: {
        ok: true,
        issues: [],
        sections: {
          lm_studio: { reachable: true, url: 'http://192.168.50.20:1234' },
          mesh: { fleet_nodes: 2, queue_pending: 0 },
        },
      },
    });
    assert.match(text, /reachable \(http:\/\/192\.168\.50\.20:1234\)/);
    assert.match(text, /direct Supabase PostgREST/);
    assert.match(text, /2 fleet node/);
  });
});

describe('coding-task-runner direct mode helpers', () => {
  it('collectDirectDiff detects edited copy', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const probeRel = 'reports/code-reviews/.direct-diff-probe.txt';
    const probeAbs = path.join(projectRoot, probeRel);
    fs.mkdirSync(path.dirname(probeAbs), { recursive: true });
    fs.writeFileSync(probeAbs, 'before\n', 'utf8');

    const wt = path.join(projectRoot, '.npc-worktrees', 'test-direct-diff');
    fs.rmSync(wt, { recursive: true, force: true });
    setupDirectWorktree(wt, [probeRel]);
    fs.writeFileSync(path.join(wt, probeRel), 'after\n', 'utf8');

    const { diff, changedFiles } = await collectDirectDiff(wt, [probeRel]);
    assert.ok(changedFiles.includes(probeRel));
    assert.match(diff, /after/);

    fs.rmSync(wt, { recursive: true, force: true });
    fs.unlinkSync(probeAbs);
  });
});
