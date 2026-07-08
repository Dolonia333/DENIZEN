'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const desktopPermissions = require('../src/desktop/denizen-desktop-permissions.js');
const {
  requestDesktopApprovalIfNeeded,
} = require('../src/compute/desktop-permission-bridge.js');

describe('desktop permission bridge', () => {
  it('auto-approves trusted and off without enqueue', () => {
    const trusted = requestDesktopApprovalIfNeeded({
      sessionId: 'sess-1',
      npcName: 'Lucy',
      capability: 'desktop-agent',
      detail: 'open notepad',
      permissionLevel: 'trusted',
    });
    assert.equal(trusted.pending, false);
    assert.equal(trusted.approved, true);
    assert.equal(desktopPermissions.getPending('sess-1'), null);

    const off = requestDesktopApprovalIfNeeded({
      sessionId: 'sess-1',
      npcName: 'Lucy',
      permissionLevel: 'off',
    });
    assert.equal(off.pending, false);
    assert.equal(off.approved, false);
    assert.equal(off.reason, 'permission_off');
  });

  it('enqueues ask-mode request for desktop poll', async () => {
    const sessionId = 'sess-ask-1';
    const result = requestDesktopApprovalIfNeeded({
      sessionId,
      npcName: 'Lucy',
      capability: 'desktop-agent',
      detail: 'fill the form',
      permissionLevel: 'ask',
    });
    assert.equal(result.pending, true);
    assert.ok(result.requestId);

    const pending = desktopPermissions.getPending(sessionId);
    assert.equal(pending.id, result.requestId);
    assert.equal(pending.npc, 'Lucy');
    assert.equal(pending.capability, 'desktop-agent');

    const waitPromise = desktopPermissions.waitForResponse(sessionId, result.requestId, {
      timeoutMs: 2000,
    });
    const responded = desktopPermissions.respond(sessionId, result.requestId, true);
    assert.equal(responded.ok, true);
    assert.equal(responded.approved, true);

    const decision = await waitPromise;
    assert.equal(decision.approved, true);
    assert.equal(desktopPermissions.getPending(sessionId), null);
  });
});
