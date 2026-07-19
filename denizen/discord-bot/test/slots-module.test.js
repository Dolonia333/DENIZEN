'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSlots } = require('../src/modules/slots');
const { ConfigStore } = require('../src/core/config-store');
const { CommandRegistry } = require('../src/core/command-registry');

describe('seller slots module', () => {
  it('registers hub + user aliases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-slots-cfg-'));
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-slots-data-'));
    process.env.DISCORD_SLOTS_DIR = storeDir;
    const config = new ConfigStore({ dir });
    const registry = new CommandRegistry();
    const slots = createSlots({ config, client: null });
    slots.register(registry);
    for (const name of ['slots', 'myslot', 'slotinfo', 'slotping', 'screate', 'slotredeem']) {
      assert.ok(registry.get(name), `missing command ${name}`);
    }
    assert.equal(registry.get('slots').module, 'slots');
    assert.equal(typeof slots.onInteraction, 'function');
    assert.equal(typeof slots.startLoops, 'function');
  });

  it('default guild config includes slots block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-slots-cfg2-'));
    const config = new ConfigStore({ dir });
    const c = config.get('g1');
    assert.equal(c.slots.enabled, false);
    assert.equal(c.slots.defaultPingCount, 3);
  });
});
