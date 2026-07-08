'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  inferTargetFilesFromTask,
  inferSkillFilesFromTask,
} = require('../src/pipelines/coding-task-runner');

const ROOT = path.resolve(__dirname, '..');

describe('coding-task-runner inferTargetFilesFromTask', () => {
  it('infers canvas-render vendor script from task text', () => {
    const task = 'Debug and fix canvas-render prototype errors. Shape errors in rendering.';
    const files = inferTargetFilesFromTask(task, []);
    assert.ok(files.includes('jelly/vendor/skills/canvas-render/canvas-render.mjs'), files.join(', '));
  });

  it('infers explicit jelly path from task', () => {
    const files = inferTargetFilesFromTask(
      'Patch apps/office/jelly/lib/bridge-client.js for Supabase errors',
      [],
    );
    assert.ok(files.includes('jelly/lib/bridge-client.js'));
  });

  it('prefers explicit targetFiles when provided', () => {
    const files = inferTargetFilesFromTask('canvas-render fix', ['server.js']);
    assert.deepEqual(files, ['server.js']);
  });

  it('infers readme plus skill files', () => {
    const files = inferTargetFilesFromTask('Update readme and pdf-generator output', []);
    assert.ok(files.includes('README.md'));
    assert.ok(files.some((f) => f.includes('pdf-generator')));
  });

  it('inferSkillFilesFromTask only returns paths that exist', () => {
    for (const f of inferSkillFilesFromTask('canvas-render')) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    }
  });
});
