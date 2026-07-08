'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferCrmAction,
  inferBusinessAction,
  canNpcRunSkill,
  skillOwner,
  deferSkillPlan,
} = require('../src/crm/denizen-crm-npc-personas');

describe('denizen-crm-npc-personas extended skills', () => {
  it('infers qualify submission', () => {
    assert.equal(inferCrmAction('qualify the newest intake submission')?.skill, 'crm-qualify-submission');
  });

  it('infers draft email', () => {
    assert.equal(inferCrmAction('draft a follow-up email for Sarah Chen')?.skill, 'crm-draft-email');
  });

  it('infers pipeline brief', () => {
    assert.equal(inferCrmAction('give me a CRM pipeline brief')?.skill, 'crm-pipeline-brief');
  });

  it('infers business-context-brief for OMES cross-check', () => {
    const plan = inferCrmAction(
      'cross-check our CRM pipeline against the OMES EV00000919 bid — what is the blocker?',
    );
    assert.equal(plan?.skill, 'business-context-brief');
  });

  it('Marcus can run business-context-brief', () => {
    assert.equal(canNpcRunSkill('Marcus', 'business-context-brief'), true);
  });

  it('infers intake triage business action', () => {
    assert.equal(inferBusinessAction('triage new intake forms')?.skill, 'intake-triage');
  });

  it('Lucy can qualify submission', () => {
    assert.equal(canNpcRunSkill('Lucy', 'crm-qualify-submission'), true);
  });

  it('Alex defers qualify submission', () => {
    assert.equal(canNpcRunSkill('Alex', 'crm-qualify-submission'), false);
  });

  it('deferSkillPlan names owner', () => {
    const plan = deferSkillPlan('qualify intake', 'crm-qualify-submission');
    assert.equal(plan.skill, 'crm-setup-status');
    assert.equal(plan.params.deferTo, 'Lucy');
  });

  it('skillOwner maps generate quote to Sarah', () => {
    assert.equal(skillOwner('crm-generate-quote'), 'Sarah');
  });
});
