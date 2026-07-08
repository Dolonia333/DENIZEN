'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const cloudVm = require('../src/compute/cloud-vm-provider');

describe('cloud-vm-provider', () => {
  it('canProvision allows DevOps NPCs and approved skills', () => {
    assert.equal(cloudVm.canProvision('Oscar', {}), true);
    assert.equal(cloudVm.canProvision('Roki', {}), false);
    assert.equal(cloudVm.canProvision('Roki', { 'cloud-vm': '/tmp/x.js' }), true);
  });

  it('listVms returns empty store in temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cvm-'));
    const list = cloudVm.listVms({ denizenRoot: tmp });
    assert.equal(list.ok, true);
    assert.equal(list.vms.length, 0);
  });

  it('createVm rejects without DevOps or approval', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-cvm-'));
    const r = await cloudVm.createVm({
      npcName: 'Roki',
      label: 'test',
      denizenRoot: tmp,
      approved: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /requires DevOps/);
  });
});
