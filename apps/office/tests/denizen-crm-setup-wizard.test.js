'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const wizard = require('../src/denizen-crm-setup-wizard');
const { proposeSetupActions, buildCrmUrl, navAction } = wizard;

describe('denizen-crm-setup-wizard', () => {
  it('buildCrmUrl includes tab and sub params', () => {
    const url = buildCrmUrl('sales', { subTab: 'pipeline' });
    assert.match(url, /\/crm\/\?tab=sales&sub=pipeline/);
  });

  it('navAction produces open_tab with url', () => {
    const action = navAction('contacts', 'Add contacts');
    assert.equal(action.type, 'open_tab');
    assert.equal(action.tab, 'contacts');
    assert.match(action.url, /tab=contacts/);
  });

  it('proposeSetupActions suggests next onboarding tab', () => {
    const setup = {
      onboarding: {
        next: { id: 'contact', label: 'Add your first contact', tab: 'contacts', owner: 'Lucy' },
      },
    };
    const actions = proposeSetupActions(setup, 'help me with CRM setup');
    assert.ok(actions.some((a) => a.tab === 'contacts'));
  });

  it('proposeSetupActions handles intake keyword', () => {
    const actions = proposeSetupActions({}, 'share the intake form');
    assert.ok(actions.some((a) => a.tab === 'intake'));
  });
});
