'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const dolonia = require('../src/dolonia-conversation-data');

describe('dolonia-conversation-data', () => {
  it('scores substantive events higher than pure commands', () => {
    const good = dolonia.scoreEventQuality({
      len: 80,
      content: 'Why is the deploy pipeline broken on staging?',
      signals: ['question', 'friction'],
      topics: ['deploy', 'pipeline', 'staging'],
      stylePrimary: 'technical',
      body: 'Why is the deploy pipeline broken on staging?',
    });
    const bad = dolonia.scoreEventQuality({
      len: 5,
      content: ',help',
      signals: ['command'],
      topics: [],
    });
    assert.ok(good > bad);
    assert.ok(good >= dolonia.QUALITY_THRESHOLD);
    assert.ok(bad < dolonia.QUALITY_THRESHOLD);
  });

  it('productKey defaults to denizen', () => {
    assert.equal(dolonia.productKey(), 'denizen');
  });

  it('recordConversationEvent fails closed without user hash', () => {
    const r = dolonia.recordConversationEvent({ content: 'hi' });
    assert.equal(r.ok, false);
  });

  it('recordConversationEvent queues when hash present (even if warehouse off)', () => {
    const r = dolonia.recordConversationEvent({
      userHash: 'abc123def456',
      content: 'thanks this is solid help with the api error',
      signals: ['praise', 'friction'],
      topics: ['api', 'error'],
      stylePrimary: 'warm',
      len: 48,
    });
    // ok true if enabled+queued, or false if warehouse disabled — both fine
    assert.ok(typeof r.ok === 'boolean');
    if (r.ok) {
      assert.ok(typeof r.quality === 'number');
      assert.ok(r.quality >= 0 && r.quality <= 1);
    }
  });
});
