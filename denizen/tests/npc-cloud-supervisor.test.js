'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('npc-cloud-supervisor', () => {
  let inbox;
  let tmp;

  before(() => {
    inbox = require('../src/npc-cloud-supervisor-inbox.js');
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-inbox-'));
    // Point inbox at tmp by writing through append after monkeypatching path — use record APIs then mark
    // The module uses a fixed path under denizen/data — use appendEvent and clean via markHandled of all
  });

  it('records hallucination and chronos events', () => {
    const h = inbox.recordHallucination('Bob', [{ text: 'I fixed it', reason: 'no skill' }]);
    assert.ok(h?.id);
    assert.equal(h.type, 'hallucination');
    const c = inbox.recordChronos('Marcus', { action: 'wander' });
    assert.equal(c.type, 'chronos_loop');
    const snap = inbox.summarizeForCloud(40);
    assert.ok(snap.open_count >= 2);
    assert.ok(snap.by_type.hallucination >= 1);
    assert.ok(snap.by_type.chronos_loop >= 1);
    inbox.markHandled([h.id, c.id]);
  });

  it('supervisor assigns corrections for open events', async () => {
    const directives = [];
    const lessons = [];
    const supervisor = require('../src/npc-mcp-cloud-supervisor-loop.js');
    supervisor.stopNpcMcpCloudSupervisor();

    const h = inbox.recordHallucination('Bob', [{ text: 'tests pass', reason: 'no artifact' }]);
    const c = inbox.recordChronos('Lucy', { action: 'talk' });

    // Inject fake brains via start deps + runCycle
    const fakeBrains = {
      assignDirective: (to, from, task, urgent) => {
        directives.push({ to, from, task, urgent });
      },
    };
    // Patch memory inject by temporarily requiring after setting module cache is hard;
    // assignDirective alone is enough to prove guide path.
    supervisor.startNpcMcpCloudSupervisor({ npcBrains: fakeBrains });
    supervisor.stopNpcMcpCloudSupervisor(); // stop timer; keep deps
    // Re-set deps by starting briefly then stop — startNpc stores deps
    const r = supervisor.startNpcMcpCloudSupervisor({ npcBrains: fakeBrains });
    assert.equal(r.ok, true);
    const summary = await supervisor.runCycle();
    assert.ok(summary.hall >= 1 || summary.chronos >= 1 || directives.length >= 1);
    assert.ok(directives.some((d) => d.to === 'Bob' || d.to === 'Lucy'));
    supervisor.stopNpcMcpCloudSupervisor();
    inbox.markHandled([h.id, c.id]);
  });
});
