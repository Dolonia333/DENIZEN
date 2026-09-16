'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const contextDrop = require('../src/context-drop');

describe('context-drop', () => {
  it('resolves roster names, folders, and unknown targets to Abby', () => {
    assert.equal(contextDrop.resolveNpcName('marcus'), 'Marcus');
    assert.equal(contextDrop.resolveNpcName('abby'), 'Abby');
    assert.equal(contextDrop.resolveNpcName('Lucy'), 'Lucy');
    assert.equal(contextDrop.resolveNpcName(''), 'Abby');
    assert.equal(contextDrop.resolveNpcName('not-a-person'), 'Abby');
  });

  it('builds a directive that includes instruction, transcript, and files', () => {
    const task = contextDrop.buildDirectiveTask({
      note: 'Fix the login button',
      transcript: 'The login button is broken on staging.',
      contextBlock: '## Files just shared with you in chat\n### screenshot.png',
      kind: 'screenshot',
      fromLabel: 'Shawnaya',
    });
    assert.match(task, /Buzz drop: screenshot/);
    assert.match(task, /from Shawnaya/);
    assert.match(task, /Fix the login button/);
    assert.match(task, /login button is broken/);
    assert.match(task, /Files attached to this Buzz drop/);
  });

  it('assigns an urgent directive and broadcasts a work-feed row', async () => {
    const assigned = [];
    const broadcast = [];
    const result = await contextDrop.handleContextDrop(
      {
        note: 'Look at this screenshot',
        kind: 'screenshot',
        from: 'Visitor',
        to: 'Abby',
        attachments: [{ name: 'shot.png' }],
      },
      {
        processAttachments: async () => ({
          ok: true,
          contextBlock: '## Files just shared with you in chat\n### shot.png',
          saved: [{ name: 'shot.png', url: '/uploads/shot.png', kind: 'image' }],
        }),
        assignDirective: (to, from, task, urgent) => {
          assigned.push({ to, from, task, urgent });
          return { id: 'dir_test' };
        },
        broadcast: (msg) => broadcast.push(msg),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.to, 'Abby');
    assert.equal(result.directiveId, 'dir_test');
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].to, 'Abby');
    assert.equal(assigned[0].urgent, true);
    assert.match(assigned[0].from, /Buzz/);
    assert.match(assigned[0].task, /Look at this screenshot/);
    assert.equal(broadcast[0].type, 'npc_work_output');
    assert.equal(broadcast[0].action, 'buzz_drop');
    assert.equal(broadcast[0].npcName, 'Abby');
  });

  it('returns attachment errors without assigning work', async () => {
    let assigned = 0;
    const result = await contextDrop.handleContextDrop(
      { note: 'hi', attachments: [{ name: 'x.png' }] },
      {
        processAttachments: async () => ({ ok: false, error: 'too large' }),
        assignDirective: () => { assigned += 1; return { id: 'nope' }; },
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /too large/);
    assert.equal(assigned, 0);
  });

  it('snapshots workbench directives and recent drops', async () => {
    await contextDrop.handleContextDrop(
      { note: 'Park this deal', kind: 'note', from: 'Visitor' },
      { assignDirective: () => ({ id: 'dir_snap' }) },
    );
    const snap = contextDrop.workbenchSnapshot({
      listDirectives: () => [{
        npc: 'Abby', from: 'Buzz (Visitor)', task: 'Park this deal', status: 'queued', urgent: true, ts: 1,
      }],
    });
    assert.equal(snap.ok, true);
    assert.equal(snap.orchestrator, 'Abby');
    assert.equal(snap.directives[0].npc, 'Abby');
    assert.ok(snap.drops.some((d) => d.note.includes('Park this deal')));
  });
});
