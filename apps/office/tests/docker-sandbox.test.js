'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const vmSandbox = require('../src/compute/vm-sandbox');

describe('vm-sandbox', () => {
  it('canCreateSandbox allows DevOps NPCs', () => {
    assert.equal(vmSandbox.canCreateSandbox('Oscar', {}), true);
    assert.equal(vmSandbox.canCreateSandbox('Roki', {}), false);
    assert.equal(vmSandbox.canCreateSandbox('Roki', { 'docker-sandbox': '/tmp/x.js' }), true);
  });

  it('listSandboxes returns empty when no store', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-sb-'));
    const list = vmSandbox.listSandboxes({ denizenRoot: tmp });
    assert.equal(list.ok, true);
    assert.equal(list.sandboxes.length, 0);
  });

  it('createSandbox rejects without approval for intern NPC', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-sb-'));
    const r = await vmSandbox.createSandbox({
      npcName: 'Roki',
      label: 'test',
      denizenRoot: tmp,
      approved: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /requires CEO/);
  });
});
