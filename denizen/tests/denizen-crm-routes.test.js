'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { mountCrmRoutes } = require('../src/denizen-crm-routes');

function mockReadJsonBody(body) {
  return async () => body;
}

describe('denizen-crm-routes', () => {
  it('POST /api/crm/assist is registered', async () => {
    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        session: { org_id: 'org-test', identity_id: 'id1' },
      }),
      readJsonBody: mockReadJsonBody({
        session_id: 'sess-1',
        message: 'hi',
        state: { contacts: [], deals: [], tasks: [] },
      }),
      npcBrains: null,
      broadcastToOffice: null,
    });

    const server = http.createServer(async (req, res) => {
      await handler(req, res);
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'sess-1', message: 'hi', state: {} }),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.ok, true);
      assert.ok(data.reply);
    } finally {
      server.close();
    }
  });

  it('GET /api/crm/session returns team_role and approval flags', async () => {
    const teamAuth = require('../src/denizen-team-auth');
    const origCan = teamAuth.canApproveSkillsForSession;
    const origUpgrade = teamAuth.maybeUpgradeSessionCeoPrincipal;
    const origResolve = teamAuth.resolveCeoPrincipalForSession;
    teamAuth.canApproveSkillsForSession = async () => ({ allowed: true, role: 'owner' });
    teamAuth.maybeUpgradeSessionCeoPrincipal = async () => null;
    teamAuth.resolveCeoPrincipalForSession = async () => ({ ceo: true, tier: 'ceo' });

    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        tier: 'ceo',
        session: { org_id: 'org-test', identity_id: 'id1', display_name: 'Owner' },
      }),
      readJsonBody: mockReadJsonBody({}),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => { await handler(req, res); });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/session`, {
        headers: { 'X-Session-Id': 'sess-owner' },
      });
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.team_role, 'owner');
      assert.equal(data.can_approve_skills, true);
      assert.equal(data.is_owner, true);
      assert.equal(data.crm_scope, 'org');
    } finally {
      teamAuth.canApproveSkillsForSession = origCan;
      teamAuth.maybeUpgradeSessionCeoPrincipal = origUpgrade;
      teamAuth.resolveCeoPrincipalForSession = origResolve;
      server.close();
    }
  });

  it('POST /api/crm/team/invite rejects non-approvers', async () => {
    const teamAuth = require('../src/denizen-team-auth');
    const origCan = teamAuth.canApproveSkillsForSession;
    const origResolve = teamAuth.resolveCeoPrincipalForSession;
    teamAuth.canApproveSkillsForSession = async () => ({ allowed: false, role: 'member' });
    teamAuth.resolveCeoPrincipalForSession = async () => null;

    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        session: { org_id: 'org-test', identity_id: 'id2' },
      }),
      readJsonBody: mockReadJsonBody({ email: 'new@example.com' }),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => { await handler(req, res); });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/team/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'sess-member' },
        body: JSON.stringify({ email: 'new@example.com' }),
      });
      const data = await res.json();
      assert.equal(res.status, 403);
      assert.equal(data.ok, false);
      assert.match(data.error, /owners and admins/i);
    } finally {
      teamAuth.canApproveSkillsForSession = origCan;
      teamAuth.resolveCeoPrincipalForSession = origResolve;
      server.close();
    }
  });

  it('GET /api/crm/health lists assist route', async () => {
    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({}),
      readJsonBody: mockReadJsonBody({}),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => {
      await handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/health`);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.routes.some((r) => r.includes('/api/crm/assist')));
      assert.ok(data.routes.some((r) => r.includes('/api/crm/assist/execute')));
      assert.ok(data.routes.some((r) => r.includes('/api/crm/my-day')));
      assert.ok(data.routes.some((r) => r.includes('/api/crm/team/activity')));
      assert.ok(data.routes.some((r) => r.includes('/api/crm/intake/form')));
      assert.ok(data.routes.some((r) => r.includes('/api/crm/deals/:dealId/studio-tasks')));
      assert.ok(data.routes.some((r) => r.includes('studio-tasks/unlink')));
    } finally {
      server.close();
    }
  });

  it('GET /api/crm/deals/:id/studio-tasks uses agency bridge', async () => {
    const agencyBridge = require('../src/denizen-agency-bridge');
    const orig = agencyBridge.listTasksForDeal;
    agencyBridge.listTasksForDeal = async (orgId, dealId) => ({
      ok: true,
      deal_id: String(dealId),
      org: orgId,
      tasks: [{ id: 't1', title: 'Delivery' }],
      board_url: `/studio-board/?deal=${dealId}`,
    });

    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        session: { org_id: 'org-test', identity_id: 'id1', display_name: 'Owner' },
      }),
      readJsonBody: mockReadJsonBody({}),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => { await handler(req, res); });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/deals/42/studio-tasks`, {
        headers: { 'X-Session-Id': 'sess-1' },
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.deal_id, '42');
      assert.equal(data.tasks[0].id, 't1');
    } finally {
      agencyBridge.listTasksForDeal = orig;
      server.close();
    }
  });

  it('POST /api/crm/deals/:id/studio-tasks/unlink uses agency bridge', async () => {
    const agencyBridge = require('../src/denizen-agency-bridge');
    const orig = agencyBridge.unlinkDealTask;
    let seen = null;
    agencyBridge.unlinkDealTask = async (orgId, args) => {
      seen = { orgId, ...args };
      return { ok: true, summary: 'unlinked', deal_id: String(args.dealId), studio_task_id: args.taskId };
    };

    const handler = mountCrmRoutes({
      verifyVisitorSession: async () => ({
        orgId: 'org-test',
        orgSlug: 'zion',
        session: { org_id: 'org-test', identity_id: 'id1', display_name: 'Owner' },
      }),
      readJsonBody: mockReadJsonBody({ studio_task_id: 't9' }),
      npcBrains: null,
      broadcastToOffice: null,
    });
    const server = http.createServer(async (req, res) => { await handler(req, res); });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/crm/deals/7/studio-tasks/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'sess-1' },
        body: JSON.stringify({ studio_task_id: 't9' }),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.ok, true);
      assert.equal(seen.dealId, '7');
      assert.equal(seen.taskId, 't9');
    } finally {
      agencyBridge.unlinkDealTask = orig;
      server.close();
    }
  });
});
