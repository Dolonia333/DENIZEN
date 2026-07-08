'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferCrmAction,
  canNpcRunSkill,
  skillOwner,
} = require('../src/crm/denizen-crm-npc-personas');
const { ALL_CRM_SKILLS, formatRunSkillLine } = require('../src/crm/denizen-crm-operator');
const { parseContactImportRows } = require('../src/crm/denizen-crm-skills');

describe('denizen-crm-operator', () => {
  it('lists all CRM skills', () => {
    assert.ok(ALL_CRM_SKILLS.length >= 45);
    assert.ok(ALL_CRM_SKILLS.includes('crm-portal-link'));
    assert.ok(formatRunSkillLine().includes('crm-portal-link'));
  });
});

describe('CRM parity infer routing', () => {
  it('infers portal link', () => {
    assert.equal(inferCrmAction('generate portal link for the Acme quote')?.skill, 'crm-portal-link');
  });

  it('infers calendar status', () => {
    assert.equal(inferCrmAction('connect google calendar to CRM')?.skill, 'crm-calendar-status');
  });

  it('infers add company', () => {
    assert.equal(inferCrmAction('add company Acme Corp')?.skill, 'crm-add-company');
  });

  it('infers analytics', () => {
    assert.equal(inferCrmAction('show CRM analytics and win rate')?.skill, 'crm-analytics-summary');
  });

  it('infers import contacts', () => {
    assert.equal(inferCrmAction('import contacts from csv')?.skill, 'crm-import-contacts');
  });

  it('Dan owns calendar sync', () => {
    assert.equal(skillOwner('crm-sync-calendar'), 'Dan');
    assert.equal(canNpcRunSkill('Dan', 'crm-sync-calendar'), true);
    assert.equal(canNpcRunSkill('Alex', 'crm-sync-calendar'), false);
  });
});

describe('parseContactImportRows', () => {
  it('parses simple csv', () => {
    const rows = parseContactImportRows({
      csv: 'name,email,company\nJane Doe,jane@acme.com,Acme',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'jane@acme.com');
  });
});
