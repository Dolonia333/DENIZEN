'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const chatActions = require('../src/crm/denizen-crm-chat-actions');

describe('denizen-crm-chat-actions', () => {
  it('shouldAutoOpenCrm detects open intent', () => {
    assert.equal(chatActions.shouldAutoOpenCrm('open the pipeline'), true);
    assert.equal(chatActions.shouldAutoOpenCrm('what is our CRM status'), false);
  });

  it('normalizeCrmActions defaults autoOpen false', () => {
    const out = chatActions.normalizeCrmActions([
      { type: 'open_tab', tab: 'contacts', label: 'Contacts' },
    ]);
    assert.equal(out[0].autoOpen, false);
  });

  it('copyLinkAction includes url', () => {
    const action = chatActions.copyLinkAction('https://example.com/intake', 'Copy intake');
    assert.equal(action.type, 'copy_link');
    assert.match(action.url, /intake/);
  });
});
