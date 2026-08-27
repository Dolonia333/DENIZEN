'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('npc-jenny-durable-loop', () => {
  const prev = process.env.DENIZEN_JENNY_DURABLE;

  afterEach(() => {
    if (prev === undefined) delete process.env.DENIZEN_JENNY_DURABLE;
    else process.env.DENIZEN_JENNY_DURABLE = prev;
    delete require.cache[require.resolve('../src/npc-jenny-durable-loop')];
  });

  it('defaults enabled', () => {
    delete process.env.DENIZEN_JENNY_DURABLE;
    delete require.cache[require.resolve('../src/npc-jenny-durable-loop')];
    const mod = require('../src/npc-jenny-durable-loop');
    assert.equal(mod.enabled(), true);
  });

  it('can be disabled', () => {
    process.env.DENIZEN_JENNY_DURABLE = '0';
    delete require.cache[require.resolve('../src/npc-jenny-durable-loop')];
    const mod = require('../src/npc-jenny-durable-loop');
    assert.equal(mod.enabled(), false);
    const handle = mod.startJennyDurableLoop({ log: { info() {}, warn() {} } });
    assert.equal(handle.enabled, false);
  });

  it('tick holds presence and expires stale jenny directive', async () => {
    process.env.DENIZEN_JENNY_DURABLE = '1';
    delete require.cache[require.resolve('../src/npc-jenny-durable-loop')];
    const mod = require('../src/npc-jenny-durable-loop');

    let presence = 0;
    const completed = [];
    const brains = {
      listDirectives() {
        return [{
          npc: 'Jenny',
          ts: Date.now() - 48 * 60 * 60 * 1000,
          task: 'stale work',
        }];
      },
      completeDirective(npc, opts) {
        completed.push({ npc, ...opts });
        return { ok: true };
      },
      expireStaleDirectives() { return []; },
    };
    const teamTools = {
      touchMcpPresenceByNpc(key) {
        if (key === 'jenny') presence += 1;
      },
    };

    const handle = mod.startJennyDurableLoop({
      npcBrains: brains,
      mcpTeamTools: teamTools,
      intervalMs: 60_000,
      log: { info() {}, warn() {} },
    });
    assert.equal(handle.enabled, true);
    await handle.tick();
    handle.stop();

    assert.equal(presence, 1);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].npc, 'Jenny');
    assert.equal(completed[0].status, 'expired');
  });
});
