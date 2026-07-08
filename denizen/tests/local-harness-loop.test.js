'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorldState } = require('../src/world-state');
const awareness = require('../src/office-awareness');
const drainer = require('../src/grok-mentor-drainer');

describe('office-awareness', () => {
  let tmpDir;
  let queuePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-awareness-'));
    queuePath = path.join(tmpDir, 'queue.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('surfaces answered Grok mentor lessons for the asking NPC', () => {
    fs.writeFileSync(queuePath, [
      JSON.stringify({ npc: 'Bob', status: 'answered', question: 'How fix loops?', answer: 'Raise repeat_penalty to 1.15 for idle chat.' }),
      JSON.stringify({ npc: 'Josh', status: 'answered', question: 'x', answer: 'y' }),
    ].join('\n') + '\n');

    const lessons = awareness.mentorLessonsForNpc('Bob', awareness.readConsultQueue(queuePath));
    assert.equal(lessons.length, 1);
    assert.match(lessons[0], /repeat_penalty/);
  });

  it('buildLiveAwarenessBlock includes team snapshot and mentor lesson', () => {
    fs.writeFileSync(queuePath, JSON.stringify({
      npc: 'Bob', status: 'answered', question: 'stuck?', answer: 'Use consult-grok then apply the lesson.',
    }) + '\n');

    const ws = new WorldState();
    ws.updateNpc('Bob', { state: 'working', currentTask: 'fixing mesh', room: 'open_office' });
    ws.updateNpc('Josh', { state: 'walking', currentTask: 'heading to breakroom', room: 'breakroom' });

    const block = awareness.buildLiveAwarenessBlock({
      npcName: 'Bob',
      worldState: ws,
      officeContext: { meshStatus: '2 nodes idle', crmSummary: '3 deals open' },
      rt: { recentWork: [{ npc: 'Marcus', note: 'updated OMES deck' }] },
      queuePath,
    });

    assert.match(block, /Current Office Awareness/);
    assert.match(block, /Marcus/);
    assert.match(block, /Mesh: 2 nodes idle/);
    assert.match(block, /Real Grok taught you/);
    assert.match(block, /Josh: heading to breakroom/);
  });

  it('flags pending consult for the NPC', () => {
    fs.writeFileSync(queuePath, JSON.stringify({
      npc: 'Bob', status: 'pending', question: 'Why am I looping?',
    }) + '\n');
    const hint = awareness.pendingConsultHint('Bob', awareness.readConsultQueue(queuePath));
    assert.match(hint, /still waiting/);
    assert.match(hint, /looping/);
  });
});

describe('grok-mentor-drainer', () => {
  let tmpDir;
  let queuePath;
  let logPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-drainer-'));
    queuePath = path.join(tmpDir, 'queue.jsonl');
    logPath = path.join(tmpDir, 'improvement.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('dry-runs without mutating the queue', async () => {
    fs.writeFileSync(queuePath, JSON.stringify({
      npc: 'Bob', status: 'pending', question: 'How do I stop repeating?', context: 'idle chat',
    }) + '\n');

    const summary = await drainer.drainConsultQueue({ dryRun: true, queuePath, logPath });
    assert.equal(summary.dryRun, true);
    assert.equal(summary.processed, 0);
    assert.equal(summary.details[0].status, 'dry_run');

    const rows = drainer.readQueue(queuePath);
    assert.equal(rows[0].status, 'pending');
    assert.ok(!fs.existsSync(logPath));
  });

  it('answers, injects, marks answered, and logs when run=true', async () => {
    fs.writeFileSync(queuePath, JSON.stringify({
      npc: 'Bob', status: 'pending', question: 'Sampling help?', topic: 'harness',
    }) + '\n');

    const summary = await drainer.drainConsultQueue({
      run: true,
      queuePath,
      logPath,
      askGrok: async () => 'Use min_p 0.05 and repeat_penalty 1.1 for chat.',
      inject: async () => ({ ok: true, npc_key: 'bob' }),
    });

    assert.equal(summary.processed, 1);
    const rows = drainer.readQueue(queuePath);
    assert.equal(rows[0].status, 'answered');
    assert.match(rows[0].answer, /repeat_penalty/);
    const log = fs.readFileSync(logPath, 'utf8').trim();
    assert.match(log, /"injected":true/);
  });

  it('skips protected NPCs', async () => {
    fs.writeFileSync(queuePath, JSON.stringify({
      npc: 'Bouncer', status: 'pending', question: 'Threat?',
    }) + '\n');

    const summary = await drainer.drainConsultQueue({
      run: true,
      queuePath,
      logPath,
      askGrok: async () => 'should not run',
      inject: async () => ({ ok: true }),
    });

    assert.equal(summary.processed, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(drainer.readQueue(queuePath)[0].status, 'pending');
  });
});
