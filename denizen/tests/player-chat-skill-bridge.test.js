'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/player-chat-skill-bridge');
const advisor = require('../src/task-resource-advisor');
const { roleCanApproveSkills } = require('../src/denizen-team-auth');

describe('player-chat-skill-bridge', () => {
  it('parses RUN_SKILL tags with JSON params', () => {
    const plans = bridge.parseRunSkillTags('On it. [RUN_SKILL:research:{"query":"denizen mesh","read":1}]');
    assert.equal(plans.length, 1);
    assert.equal(plans[0].skill, 'research');
    assert.equal(plans[0].params.query, 'denizen mesh');
  });

  it('infers research from natural language', () => {
    const plan = bridge.inferSkillFromMessage('Bob', 'research how tailscale works');
    assert.equal(plan.skill, 'research');
    assert.match(plan.params.query, /tailscale/i);
  });

  it('plans execution for claimed assistant on task-like messages', () => {
    const plan = bridge.planSkillExecution({
      npcName: 'Bob',
      message: 'research kubernetes ingress',
      responseText: 'Looking that up.',
      isAssistant: true,
      canUseRealWork: true,
    });
    assert.equal(plan.skill, 'research');
  });

  it('strips RUN_SKILL tags from display text', () => {
    const clean = bridge.stripRunSkillTags('Done [RUN_SKILL:github:{"task":"list prs"}]');
    assert.equal(clean, 'Done');
  });

  it('detects skill access requests for Lucy gate', () => {
    assert.equal(bridge.isSkillAccessRequest('I need a skill that scrapes RFPs'), true);
    assert.equal(bridge.isSkillAccessRequest('Can we enable browser automation for my team?'), true);
    assert.equal(bridge.isSkillAccessRequest('research kubernetes ingress'), false);
  });

  it('formats Lucy skill gate reply with display name', () => {
    const reply = bridge.lucySkillGateReply('Alex');
    assert.match(reply, /Alex/);
    assert.match(reply, /Dolonia/i);
  });
});

describe('task-resource-advisor', () => {
  it('flags saturated mesh when queue is deep', () => {
    const advice = advisor.advise({
      taskText: 'fix the auth bug in server.js',
      queuePending: 12,
      fleet: [{ role: 'host', gpu: { vram_total_mb: 16000 }, contributing: true }],
      lmStudioReachable: true,
    });
    assert.equal(advice.mesh_saturated, true);
    assert.ok(advice.mesh_eta_minutes >= 1);
    assert.ok(advice.suggested_spend_usd > 0);
  });

  it('recommends API keys when saturated without BYOK', () => {
    const advice = advisor.advise({
      taskText: 'implement user settings page',
      queuePending: 8,
      fleet: [],
      lmStudioReachable: false,
      hasVisitorAnthropicKey: false,
    });
    assert.equal(advice.needs_api, true);
    assert.match(advice.recommendation, /API key/i);
  });
});

describe('team-auth skill approval roles', () => {
  const teamAuth = require('../src/denizen-team-auth');

  it('allows owner and admin only', () => {
    assert.equal(roleCanApproveSkills('owner'), true);
    assert.equal(roleCanApproveSkills('admin'), true);
    assert.equal(roleCanApproveSkills('member'), false);
  });

  it('matches configured owner email', () => {
    const prev = process.env.DENIZEN_TEAM_OWNER_EMAIL;
    process.env.DENIZEN_TEAM_OWNER_EMAIL = 'CEO@Dolonia.Cloud';
    try {
      assert.equal(teamAuth.isConfiguredOwnerEmail('ceo@dolonia.cloud'), true);
      assert.equal(teamAuth.isConfiguredOwnerEmail('other@dolonia.cloud'), false);
    } finally {
      if (prev == null) delete process.env.DENIZEN_TEAM_OWNER_EMAIL;
      else process.env.DENIZEN_TEAM_OWNER_EMAIL = prev;
    }
  });

  it('treats configured owner and team owner role as one CEO login', () => {
    const prev = process.env.DENIZEN_TEAM_OWNER_EMAIL;
    process.env.DENIZEN_TEAM_OWNER_EMAIL = 'owner@dolonia.cloud';
    try {
      assert.equal(teamAuth.isTeamOwnerAccount({ email: 'owner@dolonia.cloud', role: 'member' }), true);
      assert.equal(teamAuth.isTeamOwnerAccount({ email: 'other@dolonia.cloud', role: 'owner' }), true);
      assert.equal(teamAuth.isTeamOwnerAccount({ email: 'other@dolonia.cloud', role: 'member' }), false);
    } finally {
      if (prev == null) delete process.env.DENIZEN_TEAM_OWNER_EMAIL;
      else process.env.DENIZEN_TEAM_OWNER_EMAIL = prev;
    }
  });
});
