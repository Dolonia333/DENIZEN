'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let queue;
let tmpFile;

before(() => {
  tmpFile = path.join(os.tmpdir(), `research-queue-test-${Date.now()}.json`);
  process.env.RESEARCH_QUEUE_FILE = tmpFile;
  fs.writeFileSync(tmpFile, JSON.stringify({ topics: [] }), 'utf8');
  delete require.cache[require.resolve('../src/intelligence/research-queue.js')];
  queue = require('../src/intelligence/research-queue.js');
});

after(() => {
  try { fs.unlinkSync(tmpFile); } catch (_) {}
  delete process.env.RESEARCH_QUEUE_FILE;
});

describe('research queue', () => {
  it('adds and lists topics', () => {
    const created = queue.addTopic({
      topic: 'Market scan: AI browser agents',
      priority: 9,
      assignedTo: 'Lucy',
      notes: 'Track recent launches',
    });
    assert.equal(created.status, 'pending');
    assert.equal(created.priority, 9);

    const listed = queue.listTopics({ status: 'pending', limit: 10 });
    assert.ok(listed.some(x => x.id === created.id));
  });

  it('claims next pending by priority and marks in progress', () => {
    const low = queue.addTopic({ topic: 'Low priority item', priority: 1, assignedTo: 'Lucy' });
    const high = queue.addTopic({ topic: 'High priority item', priority: 10, assignedTo: 'Lucy' });
    assert.ok(low.id && high.id);

    const next = queue.getNextPending();
    assert.equal(next.id, high.id);
    assert.equal(next.status, 'in_progress');
    assert.ok(next.startedAt);
  });

  it('completes a topic with result path', () => {
    queue.addTopic({ topic: 'Draft competitor brief', priority: 7, assignedTo: 'Lucy' });
    const claimed = queue.getNextPending();
    const done = queue.completeTopic(claimed.id, 'reports/research/lucy_competitor_2026-06-05.md');

    assert.equal(done.id, claimed.id);
    assert.equal(done.status, 'done');
    assert.equal(done.resultPath, 'reports/research/lucy_competitor_2026-06-05.md');
    assert.ok(done.completedAt);
  });
});
