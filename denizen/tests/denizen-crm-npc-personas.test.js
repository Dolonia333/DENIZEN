'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferCrmAction,
  resolvePersona,
  CRM_NPC_PERSONAS,
  isCrmRelatedMessage,
  isWriteSkill,
} = require('../src/denizen-crm-npc-personas');
const { inferSkillFromMessage } = require('../src/player-chat-skill-bridge');
const { computeOnboardingProgress, notificationNpcForKind, shouldNotify } = require('../src/denizen-crm-setup');
const industryBridge = require('../src/denizen-crm-industry-bridge');

describe('denizen-crm-npc-personas', () => {
  it('lists 16 office NPCs', () => {
    assert.equal(CRM_NPC_PERSONAS.length, 16);
  });

  it('resolves Marcus by display name', () => {
    assert.equal(resolvePersona('Marcus')?.key, 'conference_man');
  });

  it('infers pipeline read for CRM questions', () => {
    const plan = inferCrmAction('show me the pipeline');
    assert.equal(plan?.skill, 'crm-list-pipeline');
  });

  it('infers setup status for onboarding questions', () => {
    const plan = inferCrmAction('help me set up our CRM');
    assert.equal(plan?.skill, 'crm-setup-status');
  });

  it('infers industry list when vertical is ambiguous', () => {
    const plan = inferCrmAction('list industry templates for CRM');
    assert.equal(plan?.skill, 'crm-list-industries');
  });

  it('infers apply industry for saas', () => {
    const plan = inferCrmAction('apply saas industry template to our CRM');
    assert.equal(plan?.skill, 'crm-apply-industry');
    assert.equal(plan?.params?.templateId, 'saas');
  });

  it('detects CRM-related messages broadly', () => {
    assert.equal(isCrmRelatedMessage('any overdue tasks?'), true);
    assert.equal(isCrmRelatedMessage('fix the websocket bug'), false);
  });

  it('classifies write skills', () => {
    assert.equal(isWriteSkill('crm-add-contact'), true);
    assert.equal(isWriteSkill('crm-summary'), false);
  });
});

describe('player-chat-skill-bridge CRM routing', () => {
  it('routes Lucy CRM summary before generic search', () => {
    const plan = inferSkillFromMessage('Lucy', 'what does our CRM look like today');
    assert.equal(plan?.skill, 'crm-setup-status');
  });

  it('blocks write skills for read-only NPCs', () => {
    const plan = inferSkillFromMessage('Alex', 'add contact Jane at Acme');
    assert.equal(plan?.skill, 'crm-setup-status');
  });

  it('allows Lucy to add contacts', () => {
    const plan = inferSkillFromMessage('Lucy', 'add contact Jane Doe jane@acme.com');
    assert.equal(plan?.skill, 'crm-add-contact');
  });
});

describe('denizen-crm-setup', () => {
  it('computes onboarding progress', () => {
    const progress = computeOnboardingProgress({ contacts: [{ id: 1 }], deals: [] });
    assert.ok(progress.completed >= 1);
    assert.ok(progress.next);
  });

  it('respects notification prefs', () => {
    assert.equal(shouldNotify({ userPrefs: { notifications: { taskReminders: false } } }, 'task-overdue'), false);
    assert.equal(shouldNotify({}, 'task-overdue'), true);
  });

  it('routes notifications to NPCs', () => {
    assert.equal(notificationNpcForKind('task-overdue'), 'Marcus');
    assert.equal(notificationNpcForKind('deal-won'), 'Lucy');
  });
});

describe('denizen-crm-industry-bridge', () => {
  it('lists industries', () => {
    assert.ok(industryBridge.listIndustries().length >= 30);
  });

  it('resolves saas industry', () => {
    assert.equal(industryBridge.resolveIndustryId('saas'), 'saas');
    assert.equal(industryBridge.resolveIndustryId('Software as a Service'), 'saas');
  });
});
