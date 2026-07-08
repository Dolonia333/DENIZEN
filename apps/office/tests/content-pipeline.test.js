'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateGate, scanBrandRisks } = require('../src/content-gate');
const contentPipeline = require('../src/content-pipeline');
const taskChain = require('../src/task-chain');
const { TaskChainRunner } = taskChain;

describe('content-gate', () => {
  it('detects pitch rejection', () => {
    const r = evaluateGate('pitch', { save: 'Weak angle.\nVERDICT: REJECTED' });
    assert.equal(r.action, 'reject');
  });

  it('detects copy revise', () => {
    const r = evaluateGate('copy', { save: 'Tone off.\nVERDICT: REVISE' });
    assert.equal(r.action, 'revise');
  });

  it('blocks brand risks', () => {
    const risks = scanBrandRisks('This is defamation against the CEO');
    assert.ok(risks.length > 0);
    const r = evaluateGate('brand', { save: 'Draft with defamation claim' });
    assert.equal(r.action, 'block');
  });
});

describe('content-pipeline definition', () => {
  it('builds nine newsroom steps', () => {
    const steps = contentPipeline.buildSteps('AI trends');
    assert.equal(steps.length, 9);
    assert.equal(steps[0].npc, 'Bob');
    assert.equal(steps[1].gate, 'pitch');
    assert.equal(steps[steps.length - 1].npc, 'Lucy');
  });
});

describe('task-chain gates', () => {
  it('halts chain on pitch reject', () => {
    const runner = new TaskChainRunner();
    const tmpDir = path.join(__dirname, '..', 'reports', 'content-pitches');
    fs.mkdirSync(tmpDir, { recursive: true });
    const rel = 'reports/content-pitches/_test_reject.md';
    fs.writeFileSync(path.join(__dirname, '..', rel), 'VERDICT: REJECTED\n', 'utf8');

    const chain = runner.startChain({
      kind: 'content',
      name: 'test-reject',
      steps: [
        { id: 'a', npc: 'Bob', task: 'trend' },
        { id: 'b', npc: 'Sarah', task: 'pitch', gate: 'pitch' },
        { id: 'c', npc: 'Alex', task: 'write' },
      ],
    }, () => {}, () => {});

    runner.onStepComplete('Bob', 'reports/content-trends/bob.md', {}, () => {}, () => {});
    runner.onStepComplete('Sarah', rel, { save: 'VERDICT: REJECTED' }, () => {}, () => {});

    const status = runner.getChainStatus(chain.id);
    assert.equal(status.status, 'rejected');
    fs.unlinkSync(path.join(__dirname, '..', rel));
  });

  it('cancels a running chain', () => {
    const runner = new TaskChainRunner();
    const chain = runner.startChain({
      kind: 'content',
      name: 'test-cancel',
      steps: [
        { id: 'a', npc: 'Bob', task: 'trend' },
        { id: 'b', npc: 'Sarah', task: 'pitch' },
      ],
    }, () => {}, () => {});

    runner.cancelChain(chain.id, () => {});
    const status = runner.getChainStatus(chain.id);
    assert.equal(status.status, 'cancelled');
  });

  it('loops copy revise back to writer', () => {
    const runner = new TaskChainRunner();
    let lastTo = null;
    const chain = runner.startChain({
      name: 'test-revise',
      maxRevisions: 2,
      steps: [
        { id: 'draft-article', npc: 'Alex', task: 'draft' },
        { id: 'copy', npc: 'Jenny', task: 'edit', gate: 'copy', reviseGoto: 'draft-article' },
        { id: 'done', npc: 'Lucy', task: 'publish' },
      ],
    }, (to) => { lastTo = to; }, () => {});

    runner.onStepComplete('Alex', 'reports/content-drafts/a.md', {}, () => {}, () => {});
    runner.onStepComplete('Jenny', 'reports/content-edits/j.md', { save: 'VERDICT: REVISE' }, (to) => { lastTo = to; }, () => {});

    assert.equal(lastTo, 'Alex');
    const status = runner.getChainStatus(chain.id);
    assert.equal(status.status, 'running');
    assert.equal(status.revisionCount, 1);
  });
});
